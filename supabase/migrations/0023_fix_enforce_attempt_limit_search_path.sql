-- get_advisors flagged enforce_quiz_attempt_limit() (0022) for a mutable
-- search_path -- every other function in this schema pins it explicitly
-- (see student_attempt_count, check_and_record_rate_limit); this one was
-- missed. Pinning it, same as the others, closes a search_path-hijacking
-- vector even though this function isn't SECURITY DEFINER.
alter function public.enforce_quiz_attempt_limit() set search_path = public;
