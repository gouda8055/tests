-- Fixes "infinite recursion detected in policy for relation quiz_attempts"
-- (caught by tests/rls/quiz-answer-keys.test.ts) — present since the
-- original 0016 migration, just never exercised by a test until a second
-- successful attempt was inserted for a quiz that already had a row.
--
-- quiz_attempts_insert_self's WITH CHECK counted existing rows via
-- `select count(*) from quiz_attempts qa2 where ...` directly inside
-- quiz_attempts' own INSERT policy. The moment there's at least one
-- existing row to actually apply row security to, Postgres can't safely
-- resolve a policy that subqueries its own table this way — exactly the
-- same class of circularity 0004_helper_functions.sql already solved for
-- profiles via a SECURITY DEFINER helper ("a plain SELECT ... under the
-- invoking user's own RLS context would need a policy that itself calls
-- this function to decide visibility — a circular dependency. Running as
-- the function owner ... breaks that cycle"). Same fix here.
create function public.student_attempt_count(p_quiz_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.quiz_attempts
  where quiz_id = p_quiz_id and student_id = auth.uid()
$$;

revoke all on function public.student_attempt_count(uuid) from public;
revoke execute on function public.student_attempt_count(uuid) from anon;
grant execute on function public.student_attempt_count(uuid) to authenticated;

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
    and (select public.student_attempt_count(quiz_id)) < (select max_attempts from public.quizzes where id = quiz_attempts.quiz_id)
  );
