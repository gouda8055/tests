-- Stage 9 (production readiness, SECURITY.md §11: "set statement
-- timeouts"). Scoped to the two roles PostgREST actually connects as for
-- every request this app makes (anon for unauthenticated calls like
-- signup/login rate-limit checks, authenticated for everything else) --
-- bounds a runaway or accidental cross-join without affecting migrations,
-- admin scripts, or anything else run as a different role. 8 seconds is
-- generous relative to the heaviest existing query (the gradebook CSV
-- export's full-attempt-list read).
alter role authenticated set statement_timeout = '8s';
alter role anon set statement_timeout = '8s';
