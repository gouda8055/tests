-- Quizzes: a timed quiz/exam attached to a course (optionally to one
-- lesson). duration_seconds/grace_seconds are snapshotted onto each
-- quiz_attempts row at start time, so a later edit here never retroactively
-- changes an attempt already in flight (SECURITY.md §4).
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes (id),
  course_id uuid not null references public.courses (id) on delete cascade,
  lesson_id uuid references public.lessons (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(btrim(title)) > 0),
  description text,
  status text not null default 'draft',
  archived_at timestamptz,
  duration_seconds int not null check (duration_seconds > 0),
  grace_seconds int not null default 30 check (grace_seconds >= 0),
  max_attempts int not null default 1 check (max_attempts > 0),
  randomize_questions boolean not null default true,
  randomize_options boolean not null default true,
  show_answers_after_submit boolean not null default false,
  created_at timestamptz not null default now(),
  constraint quizzes_status_check check (status in ('draft', 'published'))
);

comment on table public.quizzes is
  'A timed quiz/exam within a course. Visible to a student only once enrolled and published (like lessons, not browsable pre-enrollment).';

create index quizzes_institute_id_idx on public.quizzes (institute_id);
create index quizzes_course_id_idx on public.quizzes (course_id);

alter table public.quizzes enable row level security;

create policy "quizzes_select"
  on public.quizzes
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

create policy "quizzes_insert"
  on public.quizzes
  for insert
  with check (
    institute_id = (select public.auth_institute_id())
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.institute_id = quizzes.institute_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and c.created_by = (select auth.uid()))
        )
    )
  );

create policy "quizzes_update"
  on public.quizzes
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

-- No delete policy: archived_at is the removal mechanism.

-- Checks whether a published, non-archived quiz in a published,
-- non-archived course is accessible to the calling student (i.e. they're
-- enrolled). Reads quizzes/courses under the caller's own RLS — safe
-- because this is only ever called from quiz_questions/
-- quiz_question_options/quiz_attempts/quiz_attempt_answers policies, never
-- from quizzes' own policy, so there's no circular RLS dependency to break
-- (contrast with auth_institute_id(), which does need SECURITY DEFINER for
-- exactly that reason in 0004_helper_functions.sql).
create function public.quiz_is_accessible_to_student(p_quiz_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.quizzes q
    join public.courses c on c.id = q.course_id
    where q.id = p_quiz_id
      and q.status = 'published' and q.archived_at is null
      and c.status = 'published' and c.archived_at is null
      and public.is_enrolled(c.id)
  )
$$;

revoke all on function public.quiz_is_accessible_to_student(uuid) from public;
revoke execute on function public.quiz_is_accessible_to_student(uuid) from anon;
grant execute on function public.quiz_is_accessible_to_student(uuid) to authenticated;
