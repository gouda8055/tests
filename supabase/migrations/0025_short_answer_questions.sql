-- Short-answer question type (Stage 5): exact-match, case-insensitive,
-- trimmed text grading against one or more acceptable answers. A
-- short_answer question has no options at all, so the answer key and the
-- student's answer both need a text-shaped alternative alongside the
-- existing option-based columns.

alter table public.quiz_questions
  drop constraint quiz_questions_type_check;
alter table public.quiz_questions
  add constraint quiz_questions_type_check
  check (question_type in ('single_choice', 'multiple_choice', 'short_answer'));

-- correct_option_ids was `not null` -- a short_answer question's key has
-- no options, so it relaxes to nullable with exactly one of the two
-- populated, same invariant-via-check-constraint precedent as lessons'
-- `(video_provider is null) = (video_id is null)` from Stage 2.
alter table public.quiz_answer_keys
  alter column correct_option_ids drop not null;
alter table public.quiz_answer_keys
  drop constraint quiz_answer_keys_correct_option_ids_check;
alter table public.quiz_answer_keys
  add column correct_text_answers text[];
alter table public.quiz_answer_keys
  add constraint quiz_answer_keys_exactly_one_answer_shape check (
    num_nonnulls(correct_option_ids, correct_text_answers) = 1
    and (correct_option_ids is null or array_length(correct_option_ids, 1) > 0)
    and (correct_text_answers is null or array_length(correct_text_answers, 1) > 0)
  );

-- The student's submitted answer, text-shaped alternative to
-- selected_option_ids. App layer (not RLS) enforces that exactly one is
-- populated, matching the question's type -- same app-layer-atop-RLS
-- precedent several other shape invariants in this schema already use.
alter table public.quiz_attempt_answers
  add column text_answer text;
