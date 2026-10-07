-- One row per attempt. duration_seconds/grace_seconds/question_order/
-- option_order are snapshotted at start — later edits to the quiz never
-- change an attempt already in flight. The actual timeout boundary is
-- enforced by quiz_attempt_answers' RLS (0017), not by this table's status
-- column, which is only updated lazily — see src/lib/quizzes/grading.ts.
create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes (id),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'in_progress',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  duration_seconds int not null,
  grace_seconds int not null,
  question_order jsonb not null,
  option_order jsonb not null default '{}'::jsonb,
  seed bigint not null,
  score numeric,
  max_score numeric,
  created_at timestamptz not null default now(),
  constraint quiz_attempts_status_check check (status in ('in_progress', 'submitted', 'timed_out')),
  constraint quiz_attempts_submitted_at_check check (status = 'in_progress' or submitted_at is not null)
);

comment on table public.quiz_attempts is
  'One row per attempt. Snapshots duration/grace/order from the quiz at start time so a later edit never retroactively changes an attempt in flight. status is updated lazily on next touch, not by a cron — see src/lib/quizzes/grading.ts.';

create index quiz_attempts_institute_id_idx on public.quiz_attempts (institute_id);
create index quiz_attempts_quiz_id_idx on public.quiz_attempts (quiz_id);
create index quiz_attempts_student_id_idx on public.quiz_attempts (student_id);

alter table public.quiz_attempts enable row level security;

create policy "quiz_attempts_select"
  on public.quiz_attempts
  for select
  using (
    (select public.is_super_admin())
    or student_id = (select auth.uid())
    or (
      institute_id = (select public.auth_institute_id())
      and (select public.auth_role()) in ('institute_owner', 'instructor')
    )
  );

-- Student self-insert only. The max_attempts check here is belt-and-
-- suspenders (SECURITY.md §0.2) — the authoritative check is in the
-- startAttempt server action, which counts attempts and rejects before
-- ever reaching this insert.
create policy "quiz_attempts_insert_self"
  on public.quiz_attempts
  for insert
  with check (
    student_id = (select auth.uid())
    and (select public.auth_role()) = 'student'
    and institute_id = (select public.auth_institute_id())
    and public.quiz_is_accessible_to_student(quiz_id)
    and (
      select count(*) from public.quiz_attempts qa2
      where qa2.quiz_id = quiz_attempts.quiz_id and qa2.student_id = (select auth.uid())
    ) < (select max_attempts from public.quizzes where id = quiz_attempts.quiz_id)
  );

-- The owning student may update their own attempt only while it's still
-- in_progress (submit, or a lazy self-triggered finalize) — this does not
-- gate on the deadline itself; that gate lives on quiz_attempt_answers.
-- In practice, grading always writes through the service-role client
-- (src/lib/quizzes/grading.ts), so this policy mainly exists as the
-- documented, intentional access shape rather than a path the app relies on.
create policy "quiz_attempts_update_own_in_progress"
  on public.quiz_attempts
  for update
  using (student_id = (select auth.uid()) and status = 'in_progress')
  with check (student_id = (select auth.uid()));

-- No delete policy.
