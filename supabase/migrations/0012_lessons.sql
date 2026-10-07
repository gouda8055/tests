-- Lessons: ordered content within a course — markdown text and/or a Bunny
-- Stream video. Lessons have no created_by of their own; write access
-- follows the parent course's ownership (institute_owner any course,
-- instructor only their own course's lessons).
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes (id),
  course_id uuid not null references public.courses (id) on delete cascade,
  position int not null default 0,
  title text not null check (char_length(btrim(title)) > 0),
  content_format text not null default 'markdown',
  content text,
  video_provider text,
  video_id text,
  status text not null default 'draft',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint lessons_content_format_check check (content_format in ('markdown')),
  constraint lessons_status_check check (status in ('draft', 'published')),
  constraint lessons_video_provider_check check (video_provider in ('bunny')),
  constraint lessons_video_pair_check check ((video_provider is null) = (video_id is null)),
  constraint lessons_has_content_check check (content is not null or video_id is not null)
);

comment on table public.lessons is
  'Ordered content within a course: markdown text and/or a video_provider/video_id pair — never a raw hard-coded URL (SECURITY.md §6). Visible to a student only once enrolled in the parent course (unlike courses, which are browsable pre-enrollment).';

create index lessons_institute_id_idx on public.lessons (institute_id);
create index lessons_course_id_idx on public.lessons (course_id);

alter table public.lessons enable row level security;

create policy "lessons_select"
  on public.lessons
  for select
  using (
    (select public.is_super_admin())
    or (
      institute_id = (select public.auth_institute_id())
      and (
        (select public.auth_role()) in ('institute_owner', 'instructor')
        or (
          status = 'published'
          and archived_at is null
          and public.is_enrolled(course_id)
        )
      )
    )
  );

create policy "lessons_insert"
  on public.lessons
  for insert
  with check (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.institute_id = lessons.institute_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and c.created_by = (select auth.uid()))
        )
    )
  );

create policy "lessons_update"
  on public.lessons
  for update
  using (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.institute_id = lessons.institute_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and c.created_by = (select auth.uid()))
        )
    )
  )
  with check (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.institute_id = lessons.institute_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and c.created_by = (select auth.uid()))
        )
    )
  );

-- No delete policy: archived_at is the removal mechanism.
