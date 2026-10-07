-- Institutes: one row per tenant. Every other tenant-owned table hangs off
-- institutes.id via institute_id (SECURITY.md §1).
create extension if not exists pgcrypto;

create table public.institutes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  subdomain text not null unique,
  plan text not null default 'free',
  logo_url text,
  primary_color text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint institutes_status_check check (status in ('active', 'suspended')),
  -- Lowercase letters/digits, single hyphens, no leading/trailing hyphen
  -- (SECURITY.md §8: "Validate subdomain format").
  constraint institutes_subdomain_format check (
    subdomain ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  -- Belt-and-suspenders alongside the middleware check in Stage 1 task 3:
  -- a reserved name can never be stored even if an app-layer check is ever
  -- bypassed (SECURITY.md §8: "Reserve and block subdomains").
  constraint institutes_subdomain_not_reserved check (
    subdomain not in (
      'admin', 'api', 'www', 'app', 'login', 'auth', 'support',
      'mail', 'static', 'billing', 'security'
    )
  )
);

comment on table public.institutes is
  'One row per tenant institute. subdomain resolves the tenant from the request host.';
