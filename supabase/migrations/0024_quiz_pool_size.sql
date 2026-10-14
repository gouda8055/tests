-- "Pull N of M" question pools (Stage 5). When set and less than the
-- quiz's active question count, startAttempt samples pool_size random
-- questions instead of using every question. Everything downstream
-- (question_order, max_score derivation, the attempt UI, result review)
-- already operates purely off the persisted question_order list, so no
-- other table/policy needs to change for this to work correctly.
alter table public.quizzes
  add column pool_size int check (pool_size is null or pool_size > 0);
