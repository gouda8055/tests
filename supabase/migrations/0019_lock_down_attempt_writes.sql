-- Fixes a real privilege-escalation gap found during Stage 2 build review:
-- quiz_attempts_insert_self/quiz_attempts_update_own_in_progress only
-- checked *who* was writing, never *what* they could write. A student
-- calling PostgREST directly (bypassing the app's server actions
-- entirely) could INSERT or UPDATE a quiz_attempts row with
-- status='submitted' and an arbitrary score/max_score, or extend
-- duration_seconds/grace_seconds to push the quiz_attempt_answers
-- deadline check out indefinitely — exactly what SECURITY.md §4 says must
-- never be possible ("the client sends selected options, never scores...
-- the server owns the clock").

-- 1. No legitimate student update path exists in the app at all: every
-- status/score write to quiz_attempts goes through the service-role
-- client in src/lib/quizzes/grading.ts, which bypasses RLS entirely. Drop
-- the student update policy rather than trying to patch it — there's
-- nothing for it to legitimately allow.
drop policy "quiz_attempts_update_own_in_progress" on public.quiz_attempts;

-- 2. Pin every write-once column on insert to a safe, server-determined
-- value instead of trusting whatever the client sends. duration_seconds/
-- grace_seconds are forced to match the quiz's *current* values (the
-- snapshot the app performs is now also the only value the database will
-- accept for a brand-new row), status/submitted_at/score/max_score are
-- forced to their fresh-attempt defaults, and started_at is pinned to
-- "now" within a small clock-skew allowance rather than left fully
-- client-controlled. None of this affects an attempt already in
-- progress — there is no update path that can touch these columns.
drop policy "quiz_attempts_insert_self" on public.quiz_attempts;

create policy "quiz_attempts_insert_self"
  on public.quiz_attempts
  for insert
  with check (
    student_id = (select auth.uid())
    and (select public.auth_role()) = 'student'
    and institute_id = (select public.auth_institute_id())
    and public.quiz_is_accessible_to_student(quiz_id)
    and status = 'in_progress'
    and submitted_at is null
    and score is null
    and max_score is null
    and started_at between now() - interval '10 seconds' and now() + interval '10 seconds'
    and duration_seconds = (select duration_seconds from public.quizzes where id = quiz_attempts.quiz_id)
    and grace_seconds = (select grace_seconds from public.quizzes where id = quiz_attempts.quiz_id)
    and (
      select count(*) from public.quiz_attempts qa2
      where qa2.quiz_id = quiz_attempts.quiz_id and qa2.student_id = (select auth.uid())
    ) < (select max_attempts from public.quizzes where id = quiz_attempts.quiz_id)
  );

-- 3. quiz_attempt_answers didn't verify question_id actually belongs to
-- the attempt's own quiz — a forged row could reference a question from a
-- different quiz (even a different course) in the same institute. The
-- application's grading code already filters by quiz_id defensively, but
-- SECURITY.md §0.2 wants this enforced at the database layer too.
drop policy "quiz_attempt_answers_insert_within_deadline" on public.quiz_attempt_answers;
drop policy "quiz_attempt_answers_update_within_deadline" on public.quiz_attempt_answers;

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
        and exists (
          select 1 from public.quiz_questions qq
          where qq.id = quiz_attempt_answers.question_id and qq.quiz_id = a.quiz_id
        )
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
        and exists (
          select 1 from public.quiz_questions qq
          where qq.id = quiz_attempt_answers.question_id and qq.quiz_id = a.quiz_id
        )
    )
  );

-- Known accepted gap, not fixed here: two concurrent startAttempt calls
-- can both pass the "attempts so far < max_attempts" count check before
-- either commits, letting a student get one extra attempt. This is a
-- fairness/liveness issue, not a data-integrity or score-forging one —
-- every other column on the row is still pinned by the check above.
-- Closing it fully needs either serializable isolation or a unique
-- constraint on a server-assigned attempt sequence number; deferred as a
-- documented limitation, the same treatment Stage 1 gave the phone-OTP
-- gap. See HANDOFF.md.
