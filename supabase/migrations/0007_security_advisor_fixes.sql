-- Fixes two findings from `supabase--get_advisors --type security` run
-- after 0001-0006 (SECURITY.md §11: "Run Supabase Security Advisor...
-- after every schema change and fix findings").
--
-- 1. Supabase grants EXECUTE on every new `public` function to anon,
--    authenticated and service_role automatically at CREATE time via
--    project-level default privileges. The `revoke all ... from public`
--    in 0004_helper_functions.sql only revokes the implicit blanket grant
--    to the PUBLIC pseudo-role — it does nothing to an already-explicit
--    grant held by a named role like `anon`. That left these
--    SECURITY DEFINER helpers callable by unauthenticated requests via
--    PostgREST RPC. They read the caller's own profile via auth.uid(),
--    which is meaningless for anon (no session), so anon has no
--    legitimate use for them.
revoke execute on function public.auth_institute_id() from anon;
revoke execute on function public.auth_role() from anon;
revoke execute on function public.is_super_admin() from anon;

-- 2. The profiles role/institute lock trigger had no explicit search_path
-- (flagged as function_search_path_mutable). It isn't SECURITY DEFINER,
-- so this isn't the SECURITY.md §1 requirement itself, but there's no
-- reason to leave any function's search_path resolvable by the caller.
create or replace function public.prevent_profile_role_institute_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    raise exception
      'profiles.role is immutable once set; it cannot be changed by an UPDATE';
  end if;

  if new.institute_id is distinct from old.institute_id then
    raise exception
      'profiles.institute_id is immutable once set; it cannot be changed by an UPDATE';
  end if;

  return new;
end;
$$;
