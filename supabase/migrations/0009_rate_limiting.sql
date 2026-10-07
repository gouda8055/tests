-- Rate limiting for login/signup/OTP (SECURITY.md §3). Implemented in
-- Postgres rather than in-memory because the app deploys to Vercel
-- serverless functions — in-memory counters wouldn't be shared across
-- invocations and would give a false sense of protection.
create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  bucket_key text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_events_bucket_created_idx
  on public.rate_limit_events (bucket_key, created_at desc);

comment on table public.rate_limit_events is
  'Sliding-window rate limit counters, keyed by an action+identifier string (e.g. "login:1.2.3.4"). Written only via check_and_record_rate_limit().';

alter table public.rate_limit_events enable row level security;
-- No policies: this table is not directly readable or writable by anon or
-- authenticated through the API. The function below is SECURITY DEFINER
-- and does the only sanctioned read/write, so RLS being enabled with zero
-- policies is intentional (deny-by-default), not an oversight.

-- Atomically checks whether `p_bucket` is still within `p_max_events` over
-- the trailing `p_window_seconds`, and records this attempt regardless of
-- the outcome (so a sustained attacker's window keeps sliding forward).
-- SECURITY DEFINER with explicit search_path, like our other helpers —
-- justified because it must write to a table anon/authenticated have no
-- direct grants on.
create or replace function public.check_and_record_rate_limit(
  p_bucket text,
  p_max_events int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.rate_limit_events
  where bucket_key = p_bucket
    and created_at > now() - (p_window_seconds || ' seconds')::interval;

  if v_count >= p_max_events then
    return false;
  end if;

  insert into public.rate_limit_events (bucket_key) values (p_bucket);
  return true;
end;
$$;

-- Deliberately granted to anon (unlike our other helper functions): a
-- rate-limit check must run before we know who's calling — that's the
-- whole point for login/signup attempts. The function only increments a
-- counter and returns a boolean; it exposes no data.
revoke all on function public.check_and_record_rate_limit(text, int, int) from public;
grant execute on function public.check_and_record_rate_limit(text, int, int) to anon, authenticated;
