-- Profiles: one row per auth.users row, carrying the server-controlled
-- institute_id and role. Never store these in user_metadata (user-editable) —
-- this table (not app_metadata) is our source of truth (SECURITY.md §1).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  institute_id uuid references public.institutes (id) on delete restrict,
  role text not null,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  constraint profiles_role_check check (
    role in ('super_admin', 'institute_owner', 'instructor', 'student')
  ),
  -- Only the platform-level super_admin role is tenant-less.
  constraint profiles_institute_required_unless_super_admin check (
    (role = 'super_admin' and institute_id is null)
    or (role <> 'super_admin' and institute_id is not null)
  )
);

comment on table public.profiles is
  'Server-controlled role and tenant per auth user. role/institute_id are immutable after creation (see profiles_lock_role_and_institute trigger) — SECURITY.md §3.';

-- Users MUST NOT be able to change their own role or institute_id
-- (SECURITY.md §3). RLS alone can only validate the *new* row, not compare
-- it against the old one, so this invariant is enforced here with a
-- trigger instead: it fires for every UPDATE regardless of which Postgres
-- role performs it (including the service-role key), so changing a role
-- after creation requires a deliberate future migration, not a runtime
-- bypass.
create function public.prevent_profile_role_institute_change()
returns trigger
language plpgsql
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

create trigger profiles_lock_role_and_institute
  before update on public.profiles
  for each row
  execute function public.prevent_profile_role_institute_change();
