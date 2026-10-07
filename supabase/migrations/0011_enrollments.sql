-- Enrollments: a student joining a course. Self-enroll only in this stage —
-- no payment gate (Razorpay is out of scope; see HANDOFF.md gaps).
create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes (id),
  course_id uuid not null references public.courses (id),
  student_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'active',
  enrolled_at timestamptz not null default now(),
  constraint enrollments_status_check check (status in ('active')),
  constraint enrollments_course_student_unique unique (course_id, student_id)
);

comment on table public.enrollments is
  'One row per student enrolled in a course. Self-enroll only; no update/delete policy — unenroll is out of scope for this stage.';

create index enrollments_institute_id_idx on public.enrollments (institute_id);
create index enrollments_course_id_idx on public.enrollments (course_id);
create index enrollments_student_id_idx on public.enrollments (student_id);

alter table public.enrollments enable row level security;

create policy "enrollments_select"
  on public.enrollments
  for select
  using (
    (select public.is_super_admin())
    or (
      institute_id = (select public.auth_institute_id())
      and (
        student_id = (select auth.uid())
        or (select public.auth_role()) in ('institute_owner', 'instructor')
      )
    )
  );

-- Students self-enroll only: the row's student_id must be the caller, and
-- the course must be published and in the caller's own institute —
-- re-validated here even though the enrollInCourse action already checks
-- this (SECURITY.md §0.2: "the database is the last line of defense").
create policy "enrollments_insert_self"
  on public.enrollments
  for insert
  with check (
    student_id = (select auth.uid())
    and (select public.auth_role()) = 'student'
    and institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.institute_id = enrollments.institute_id
        and c.status = 'published'
        and c.archived_at is null
    )
  );

-- No update/delete policy: unenroll is out of scope for this stage.

-- Checks whether the calling user (a student) is enrolled in p_course_id.
-- Not SECURITY DEFINER: it only ever reads the caller's own enrollment
-- rows, which enrollments_select already grants them directly — no
-- circular RLS dependency to break here (contrast with auth_institute_id()
-- etc. in 0004_helper_functions.sql, which do need SECURITY DEFINER
-- because they're called from within profiles' own policies).
create function public.is_enrolled(p_course_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.enrollments e
    where e.course_id = p_course_id and e.student_id = auth.uid()
  )
$$;

revoke all on function public.is_enrolled(uuid) from public;
revoke execute on function public.is_enrolled(uuid) from anon;
grant execute on function public.is_enrolled(uuid) to authenticated;
