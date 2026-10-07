-- Helper functions used throughout RLS policies to resolve the calling
-- user's tenant and role from public.profiles.
--
-- Each is SECURITY DEFINER with an explicit search_path (SECURITY.md §1
-- requires both whenever SECURITY DEFINER is used). Justification: a plain
-- SELECT against profiles under the invoking user's own RLS context would
-- need a profiles SELECT policy that itself calls this function to decide
-- visibility — a circular dependency. Running as the function owner (whose
-- rights are not subject to the caller's RLS) breaks that cycle. The
-- explicit search_path prevents a malicious search_path override from
-- redirecting these lookups to an attacker-controlled table.
create function public.auth_institute_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select institute_id from public.profiles where id = auth.uid()
$$;

create function public.auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin'
  )
$$;

-- Only authenticated sessions need these; anonymous callers have no
-- auth.uid() and get null/false regardless, but we don't grant them the
-- function at all as a matter of least privilege.
revoke all on function public.auth_institute_id() from public;
revoke all on function public.auth_role() from public;
revoke all on function public.is_super_admin() from public;

grant execute on function public.auth_institute_id() to authenticated;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
