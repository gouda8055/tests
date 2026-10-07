-- Fixes findings from `get_advisors --type performance` run after
-- 0010-0017 (SECURITY.md §11). Three FK columns were missed when indexing
-- the rest of each table's foreign keys up front.
create index quiz_attempt_answers_question_id_idx on public.quiz_attempt_answers (question_id);
create index quizzes_created_by_idx on public.quizzes (created_by);
create index quizzes_lesson_id_idx on public.quizzes (lesson_id);

-- Not fixed: `unused_index` on every new index above and on Stage 1's
-- existing ones — expected, since none of these tables have real traffic
-- yet. The four `authenticated_security_definer_function_executable`
-- findings and `rls_enabled_no_policy` on rate_limit_events are pre-existing
-- Stage 1 findings, both already documented as intentional in
-- 0007_security_advisor_fixes.sql/0009_rate_limiting.sql. No new
-- SECURITY DEFINER function was introduced in Stage 2 — is_enrolled() and
-- quiz_is_accessible_to_student() are plain invoker-rights functions and do
-- not appear in the advisor output at all.
