# Multi-Tenant LMS & Exam SaaS

Next.js (App Router) + Supabase (Postgres, Auth, Storage, RLS) + Tailwind CSS +
shadcn/ui. One codebase, many institutes, each on its own subdomain.

Read `SECURITY.md` before touching auth, RLS policies, or anything
tenant-scoped — its rules are mandatory.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in your Supabase project values
pnpm dev
```

The app resolves the tenant from the request host. In local development,
use a `*.localtest.me` subdomain (resolves to `127.0.0.1`, no `/etc/hosts`
edits needed), e.g. `http://acme.localtest.me:3000`.

## Scripts

| Command                        | Purpose                     |
| ------------------------------ | --------------------------- |
| `pnpm dev`                     | Start the dev server        |
| `pnpm build`                   | Production build            |
| `pnpm lint`                    | ESLint                      |
| `pnpm typecheck`               | `tsc --noEmit`              |
| `pnpm format` / `format:check` | Prettier                    |
| `pnpm test`                    | Vitest (unit + RLS tests)   |
| `pnpm test:e2e`                | Playwright end-to-end tests |

## Database migrations

Versioned SQL lives in `supabase/migrations`. RLS is the enforced tenant
boundary — see `SECURITY.md` §1 for the required pattern and the
cross-tenant test every new table must have.

Dev Supabase project: `lms-exam-saas` (ref `uprhdpwfztdeifhktwww`,
`ap-south-1`), separate from any other project on the account per
SECURITY.md §2 ("Use separate Supabase projects and keys for development
and production"). Migrations 0001-0009 are already applied there.

**First login**: migration `0006_seed_super_admin.sql` seeds one
`super_admin` so there's a way into `/platform` before any UI exists to
create one:

- email: `superadmin@example.com`
- password: `ChangeMe!12345`

This password is a public placeholder committed to this repo — it is
**not a secret**. Sign in and rotate it immediately on any project this
migration is applied to beyond local development.

Get your `SUPABASE_SERVICE_ROLE_KEY` from the Supabase dashboard
(Project Settings → API → service_role secret key) and put it in
`.env.local` — it's required for signup/profile-provisioning server code
and the `/platform` screens, and is deliberately not something this
session can fetch for you.

## Auth

Email + password is the only live sign-in method. Tenant-scoped signup
(`/sign-up` on a tenant subdomain) always creates a `student` — there's
no self-serve way to become an instructor or owner.

Phone OTP is fully implemented and rate-limited
(`src/lib/auth/actions.ts`: `sendPhoneOtp` / `verifyPhoneOtp`) but not
wired into the sign-in UI yet, because this Supabase project has no SMS
provider configured — `signInWithOtp` will error until one is set up in
the dashboard (Authentication → Providers → Phone). Once configured,
adding it to the sign-in page is a small UI addition, not new server
logic.

Rate limits: 5 signups/hour and 10 logins/15 min per IP, 3 OTP
sends/hour per phone number (10/hour per IP) — see
`supabase/migrations/0009_rate_limiting.sql`.

## Running the RLS and end-to-end tests

`pnpm test` and `pnpm test:e2e` both include suites
(`tests/rls/tenant-isolation.test.ts`,
`e2e/signup-login-dashboard.spec.ts`) that create and delete real rows
against a live Supabase project. They skip automatically — not fail —
when `SUPABASE_SERVICE_ROLE_KEY` isn't set in `.env.local`, so
`pnpm test` stays green without it.

To run them for real, set a real `SUPABASE_SERVICE_ROLE_KEY` and run
`pnpm test` / `pnpm test:e2e` (the latter starts `pnpm dev` for you).
**Point these only at a development project, never production** — they
create and tear down test institutes and users on every run.
