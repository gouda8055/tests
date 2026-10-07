-- Fixes findings from `get_advisors --type performance` run after
-- 0001-0007 (SECURITY.md §11).
--
-- 1. Unindexed foreign keys: profiles.institute_id and
-- audit_logs.actor_id are looked up on nearly every request (tenant
-- resolution, audit attribution) and had no covering index.
create index profiles_institute_id_idx on public.profiles (institute_id);
create index audit_logs_actor_id_idx on public.audit_logs (actor_id);

-- 2. auth_rls_initplan: `auth.uid()` (and, by the same reasoning, our own
-- STABLE helper functions) were called unwrapped in policy expressions,
-- which Postgres can re-evaluate once per row instead of once per query.
-- Wrapping each call in `(select ...)` lets the planner hoist it into an
-- InitPlan evaluated once. Behavior is unchanged — only the evaluation
-- count is.
alter policy "institutes_select_own_or_super_admin"
  on public.institutes
  using (
    id = (select public.auth_institute_id())
    or (select public.is_super_admin())
  );

alter policy "institutes_insert_super_admin_only"
  on public.institutes
  with check ((select public.is_super_admin()));

alter policy "institutes_update_super_admin_only"
  on public.institutes
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

alter policy "profiles_select_self_or_super_admin"
  on public.profiles
  using (
    id = (select auth.uid())
    or (select public.is_super_admin())
  );

alter policy "profiles_update_self"
  on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy "audit_logs_insert_self_attributed"
  on public.audit_logs
  with check (
    actor_id = (select auth.uid())
    and (
      institute_id = (select public.auth_institute_id())
      or (institute_id is null and (select public.is_super_admin()))
    )
  );

alter policy "audit_logs_select_super_admin_or_owner"
  on public.audit_logs
  using (
    (select public.is_super_admin())
    or (
      (select public.auth_role()) = 'institute_owner'
      and institute_id = (select public.auth_institute_id())
    )
  );

-- Not fixed: `unused_index` on audit_logs_institute_id_created_at_idx and
-- `authenticated_security_definer_function_executable` on the three
-- auth_*/is_super_admin helpers are expected — the index is unused only
-- because the table has no rows yet, and the helpers are deliberately
-- callable by authenticated users (see 0004_helper_functions.sql). Both
-- are noted in the Stage 1 Definition of Done report rather than
-- "fixed" away.
