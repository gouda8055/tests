-- Append-only audit trail (SECURITY.md §10). No UPDATE or DELETE policy is
-- ever defined for this table (see 0005_rls_policies.sql) — with RLS
-- enabled and no such policy, every role except service_role is denied by
-- default, which is what makes this table append-only in practice.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid references public.institutes (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target text,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only audit trail. No update/delete policy exists for any role; only insert and select. SECURITY.md §10.';

create index audit_logs_institute_id_created_at_idx
  on public.audit_logs (institute_id, created_at desc);
