-- RLS is the enforced tenant boundary (SECURITY.md §0, §1). Every table in
-- `public` has RLS enabled; every INSERT/UPDATE policy has both USING and
-- WITH CHECK.

alter table public.institutes enable row level security;
alter table public.profiles enable row level security;
alter table public.audit_logs enable row level security;

-- institutes ----------------------------------------------------------

-- Members read their own institute (for branding/display); super_admin
-- reads every institute (platform screen).
create policy "institutes_select_own_or_super_admin"
  on public.institutes
  for select
  using (
    id = public.auth_institute_id()
    or public.is_super_admin()
  );

-- Only super_admin creates institutes (Stage 1 task 6: platform screen).
create policy "institutes_insert_super_admin_only"
  on public.institutes
  for insert
  with check (public.is_super_admin());

-- Only super_admin updates institutes (covers suspend/activate; no
-- self-service branding editor exists yet in Stage 1).
create policy "institutes_update_super_admin_only"
  on public.institutes
  for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- No delete policy: institutes cannot be deleted through the API by any
-- role, including super_admin. Offboarding (SECURITY.md §9) is a future,
-- deliberate process, not an RLS-permitted DELETE.

-- profiles --------------------------------------------------------------

-- Users can always see their own profile; super_admin sees every profile
-- (needed for the platform screen to assign/display institute owners).
create policy "profiles_select_self_or_super_admin"
  on public.profiles
  for select
  using (
    id = auth.uid()
    or public.is_super_admin()
  );

-- Users may update their own row (full_name, phone). role and
-- institute_id are excluded from this guarantee by the
-- profiles_lock_role_and_institute trigger (0002_profiles.sql), not by
-- this policy — RLS alone cannot compare old vs. new column values.
create policy "profiles_update_self"
  on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- No insert policy for anon/authenticated: every profile is created
-- server-side (service role, which bypasses RLS) as part of a controlled
-- flow — tenant signup or the super_admin platform screen — never as a
-- direct client insert. See SECURITY.md §1 ("Never accept institute_id
-- from request bodies... Derive it from the authenticated user's
-- profile" — there is no profile yet at signup time, so the server, not
-- the client, originates the row).
--
-- No delete policy: profiles are not deletable through the API in Stage 1.

-- audit_logs --------------------------------------------------------------

-- Every authenticated role may append an entry, but only one attributed to
-- themselves and their own institute (or, for super_admin platform-level
-- actions with no institute, a null institute_id). This lets every role
-- generate its own audit trail (e.g. a student's login) without being able
-- to forge entries for another user or tenant.
create policy "audit_logs_insert_self_attributed"
  on public.audit_logs
  for insert
  with check (
    actor_id = auth.uid()
    and (
      institute_id = public.auth_institute_id()
      or (institute_id is null and public.is_super_admin())
    )
  );

-- Students and instructors cannot read audit logs (SECURITY.md §10).
-- Only super_admin (platform-wide) and institute_owner (their own
-- institute) can.
create policy "audit_logs_select_super_admin_or_owner"
  on public.audit_logs
  for select
  using (
    public.is_super_admin()
    or (
      public.auth_role() = 'institute_owner'
      and institute_id = public.auth_institute_id()
    )
  );

-- No update or delete policy for any role: the log is append-only in
-- practice, enforceable even against a compromised application server
-- using the anon/authenticated keys (only the service-role key, used
-- solely for retention jobs per SECURITY.md §9, bypasses this).
