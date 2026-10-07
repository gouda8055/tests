-- A student's selected options for one question of one attempt — never a
-- score or correctness flag (grading happens separately, service-role
-- only, in src/lib/quizzes/grading.ts). unique(attempt_id, question_id) is
-- what makes autosave an idempotent upsert.
--
-- This table's RLS is the actual "server owns the clock" boundary
-- (SECURITY.md §4): Postgres itself rejects a write once now() passes the
-- attempt's deadline, regardless of what application code does.
create table public.quiz_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes (id),
  attempt_id uuid not null references public.quiz_attempts (id) on delete cascade,
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  selected_option_ids uuid[] not null default '{}',
  answered_at timestamptz not null default now(),
  constraint quiz_attempt_answers_attempt_question_unique unique (attempt_id, question_id)
);

comment on table public.quiz_attempt_answers is
  'A student''s answer to one question of one attempt. insert/update policies both require now() <= started_at + duration + grace on the parent attempt — the hard, database-level timeout enforcement (SECURITY.md §4).';

create index quiz_attempt_answers_institute_id_idx on public.quiz_attempt_answers (institute_id);
create index quiz_attempt_answers_attempt_id_idx on public.quiz_attempt_answers (attempt_id);

alter table public.quiz_attempt_answers enable row level security;

create policy "quiz_attempt_answers_select"
  on public.quiz_attempt_answers
  for select
  using (
    (select public.is_super_admin())
    or exists (
      select 1 from public.quiz_attempts a
      where a.id = attempt_id and a.student_id = (select auth.uid())
    )
    or (
      institute_id = (select public.auth_institute_id())
      and (select public.auth_role()) in ('institute_owner', 'instructor')
    )
  );

-- Insert and update (not "for all" — that would silently also grant
-- delete, which this table deliberately has no policy for) share the same
-- condition: the owning student, while the attempt is in_progress, and
-- only up to started_at + duration + grace.
create policy "quiz_attempt_answers_insert_within_deadline"
  on public.quiz_attempt_answers
  for insert
  with check (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.quiz_attempts a
      where a.id = attempt_id
        and a.student_id = (select auth.uid())
        and a.status = 'in_progress'
        and now() <= a.started_at + (a.duration_seconds + a.grace_seconds) * interval '1 second'
    )
  );

create policy "quiz_attempt_answers_update_within_deadline"
  on public.quiz_attempt_answers
  for update
  using (
    exists (
      select 1 from public.quiz_attempts a
      where a.id = attempt_id
        and a.student_id = (select auth.uid())
        and a.status = 'in_progress'
        and now() <= a.started_at + (a.duration_seconds + a.grace_seconds) * interval '1 second'
    )
  )
  with check (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.quiz_attempts a
      where a.id = attempt_id
        and a.student_id = (select auth.uid())
        and a.status = 'in_progress'
        and now() <= a.started_at + (a.duration_seconds + a.grace_seconds) * interval '1 second'
    )
  );

-- No delete policy.
