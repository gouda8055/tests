-- Courses: one row per course, scoped to an institute (Stage 2 task 1).
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes (id),
  created_by uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(btrim(title)) > 0),
  description text,
  status text not null default 'draft',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint courses_status_check check (status in ('draft', 'published'))
);

comment on table public.courses is
  'One course per row, scoped to an institute. status gates student visibility (browsable once published, regardless of enrollment); archived_at is a soft-delete — no table in this schema has a hard-delete policy.';

create index courses_institute_id_idx on public.courses (institute_id);
create index courses_created_by_idx on public.courses (created_by);

alter table public.courses enable row level security;

-- Staff (institute_owner/instructor) always see every course in their
-- institute, including drafts and archived ones. Students see only
-- published, non-archived courses in their own institute (browsable before
-- enrolling — unlike lessons/quizzes, which are enrollment-gated).
create policy "courses_select"
  on public.courses
  for select
  using (
    (select public.is_super_admin())
    or (
      institute_id = (select public.auth_institute_id())
      and (
        (select public.auth_role()) in ('institute_owner', 'instructor')
        or (status = 'published' and archived_at is null)
      )
    )
  );

-- Only institute_owner/instructor create courses, always stamped with
-- their own institute and their own id as creator (never from client
-- input — SECURITY.md §1).
create policy "courses_insert"
  on public.courses
  for insert
  with check (
    institute_id = (select public.auth_institute_id())
    and (select public.auth_role()) in ('institute_owner', 'instructor')
    and created_by = (select auth.uid())
  );

-- institute_owner may update any course in their institute; instructor only
-- the ones they created (confirmed scope: creator-only, owner overrides).
create policy "courses_update"
  on public.courses
  for update
  using (
    institute_id = (select public.auth_institute_id())
    and (
      (select public.auth_role()) = 'institute_owner'
      or ((select public.auth_role()) = 'instructor' and created_by = (select auth.uid()))
    )
  )
  with check (
    institute_id = (select public.auth_institute_id())
    and (
      (select public.auth_role()) = 'institute_owner'
      or ((select public.auth_role()) = 'instructor' and created_by = (select auth.uid()))
    )
  );

-- No delete policy: archived_at is the only removal mechanism.
