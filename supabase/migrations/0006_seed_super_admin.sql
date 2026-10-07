-- Seeds the first super_admin account. There is no self-serve signup path
-- for this role and no /platform UI yet to create one safely, so Stage 1
-- provisions it directly in a migration, per explicit instruction.
--
-- SECURITY WARNING: the password below is a public placeholder committed
-- to version control. It is NOT a secret and must never be treated as
-- one. Whoever applies this migration to a real project MUST sign in as
-- this account immediately and rotate the password (Supabase Auth
-- "update user" / password reset), or delete this user and create a
-- replacement via the Supabase Auth Admin API, before the project is used
-- for anything beyond local development.
--
-- Idempotent: skips silently if the email already exists, so re-running
-- migrations (e.g. in CI against a fresh database each time) is safe.
do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_identity_id uuid := gen_random_uuid();
  v_email text := 'superadmin@example.com';
  v_password text := 'ChangeMe!12345';
begin
  if exists (select 1 from auth.users where email = v_email) then
    raise notice 'Seed super_admin skipped: % already exists', v_email;
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    v_email, crypt(v_password, gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_identity_id, v_user_id::text, v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email', now(), now(), now()
  );

  insert into public.profiles (id, institute_id, role, full_name)
  values (v_user_id, null, 'super_admin', 'Platform Super Admin');

  raise notice
    'Seeded super_admin %. Rotate this password immediately — it is a public placeholder, not a secret.',
    v_email;
end $$;
