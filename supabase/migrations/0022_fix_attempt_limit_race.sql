-- Fixes the documented max_attempts concurrency race from
-- 0019_lock_down_attempt_writes.sql's closing comment: two simultaneous
-- startAttempt requests can both evaluate student_attempt_count() in
-- quiz_attempts_insert_self's `with check` before either commits, so both
-- can pass a max_attempts = 1 check and both insert. That function is
-- STABLE, evaluated against the single INSERT statement's snapshot --
-- blocking alone doesn't help under READ COMMITTED, since a blocked
-- statement resumes with the SAME snapshot it started with, not a fresh
-- one.
--
-- Fix: a BEFORE INSERT FOR EACH ROW trigger whose plpgsql body (a) takes
-- an advisory lock scoped to this (quiz, student) pair -- auto-released
-- at transaction end -- then (b) runs its own fresh COUNT query and
-- raises if the limit is already met. Queries inside a plpgsql function
-- body each get their own fresh READ COMMITTED snapshot (unlike the outer
-- statement), so the second transaction's count, taken after acquiring
-- the lock the first transaction just released, sees the first's
-- committed row. No SECURITY DEFINER needed: the inserting student's own
-- RLS select policy already lets them see their own quiz_attempts rows.
-- The existing RLS `with check` stays as a fast-path/defense-in-depth;
-- this trigger is the authoritative fix.
create function public.enforce_quiz_attempt_limit()
returns trigger
language plpgsql
as $$
declare
  v_max_attempts int;
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext(NEW.quiz_id::text), hashtext(NEW.student_id::text));

  select max_attempts into v_max_attempts
  from public.quizzes
  where id = NEW.quiz_id;

  select count(*) into v_count
  from public.quiz_attempts
  where quiz_id = NEW.quiz_id and student_id = NEW.student_id;

  if v_count >= v_max_attempts then
    raise exception 'Attempt limit reached for this quiz.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger quiz_attempts_enforce_limit
  before insert on public.quiz_attempts
  for each row
  execute function public.enforce_quiz_attempt_limit();
