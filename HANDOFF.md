# Stage 1 Handoff

Everything below reflects the state of `claude/security-multi-tenant-lms-e5198b`
as of commit `12f2ae1`. All 10 Stage 1 tasks from the original brief are
built, committed, and pushed. This file is the map; `README.md` has setup
steps, `SECURITY.md` is the mandatory rulebook, and code comments explain
individual decisions in place — this doc exists so a fresh session (yours
or another agent's) doesn't have to re-derive any of it.

## Access you'll need

- **Repo**: `gouda8055/tests`, branch `claude/security-multi-tenant-lms-e5198b`.
- **Supabase project**: `lms-exam-saas`, ref `uprhdpwfztdeifhktwww`, region
  `ap-south-1`. Separate from any other project on the account — see
  SECURITY.md §2.
- **`.env.local`** (gitignored, create it yourself): real `NEXT_PUBLIC_SUPABASE_URL`
  and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are in the README's Getting Started
  section. **`SUPABASE_SERVICE_ROLE_KEY` is not in the repo anywhere** — get
  it from the Supabase dashboard (Project Settings → API → service_role
  secret key). Nothing that touches auth, the platform screen, or the test
  suites works without it.
- **First login**: `superadmin@example.com` / `ChangeMe!12345` — a public
  placeholder committed in `supabase/migrations/0006_seed_super_admin.sql`,
  not a secret. Rotate it before this goes anywhere near production.

## What's built (Stage 1, all 10 tasks)

1. **Scaffold** — Next.js 16 App Router, TS strict, Tailwind v4, hand-built
   shadcn/ui (registry was network-blocked in the build sandbox), Zod env
   validation split into public (`src/lib/env.ts`) vs. secret
   (`src/lib/env.server.ts`, guarded by `server-only`).
2. **Schema** (`supabase/migrations/0001-0005`) — `institutes`, `profiles`
   (role/institute_id immutable post-creation via trigger, not just RLS),
   append-only `audit_logs`, RLS on all three, `auth_institute_id()` /
   `auth_role()` / `is_super_admin()` helper functions.
3. **Tenant resolution** (`src/proxy.ts`, `src/lib/tenant/`) — resolves the
   institute from the request Host, rejects reserved/malformed/unknown
   subdomains (404) and suspended institutes (403), passes the verified
   tenant down via headers the client can't forge.
4. **Auth** (`src/lib/auth/`) — email+password signup/login/logout as
   Server Actions, tenant-scoped signup (always creates a `student`,
   `institute_id` always server-resolved), phone OTP fully wired and
   rate-limited but **not in the UI** (no SMS provider configured — see
   README's Auth section).
5. **Route guards** (`src/lib/auth/guard.ts`) — `requireRole` /
   `requireTenantRole`, built alongside auth rather than after, so
   `/admin` `/student` `/platform` were never committed unguarded.
6. **Platform screen** (`src/lib/platform/`, `src/app/platform/`) — create
   institute, assign owner (random temp password shown once, no email
   delivery configured), suspend/activate.
7. **Branding** (`src/app/layout.tsx`, `src/components/tenant/`) — logo +
   name in a header, primary color as a CSS custom property every
   shadcn/ui component already reads from.
8. **Audit logging** (`src/lib/audit/log.ts`) — login/failed-login/signup/
   signout/institute-created/suspended/activated/owner-assigned all
   logged. **Gap**: no role-change event exists to log, because role is
   immutable by design (see gaps section below).
9. **Tests** — `tests/rls/tenant-isolation.test.ts` (Vitest, cross-tenant
   isolation + role/institute_id immutability) and
   `e2e/signup-login-dashboard.spec.ts` (Playwright, real signup→dashboard→
   logout→login flow). Both skip gracefully without
   `SUPABASE_SERVICE_ROLE_KEY` — **neither has been run end-to-end by me**,
   only verified structurally (lint/typecheck) plus the underlying RLS
   behavior proven manually via direct SQL during task 2. Run them for
   real once you have the key (see README's testing section).
10. **Definition of Done** — reported in chat at the end of the build;
    not duplicated here. Short version: everything's covered except two
    dashboard-only items (leaked-password-protection toggle, Pro-plan
    gated; see below) and things genuinely out of Stage 1 scope (rich
    text sanitization, payments — no features that need them exist yet).

## What I could never verify myself

This build sandbox's network egress policy doesn't allow `*.supabase.co`,
so I could never run anything that makes a live Supabase call — not
`pnpm dev` against real auth flows, not the RLS test suite, not the
Playwright test. Everything was verified as far as lint/typecheck/build/
unit-test-with-pure-functions allow, plus one proxy.ts resilience bug
I caught and fixed by testing _around_ the restriction (base-domain
request with a dummy key). **Treat the auth flows, platform screen, and
both test suites as code-reviewed but not yet execution-verified** until
you run them locally.

## Immediate next steps for you

1. `cp` your `.env.local`, fill in the real service-role key.
2. `pnpm dev`, actually click through: sign up on a tenant subdomain, sign
   in, hit `/platform` as super_admin, create an institute, assign an
   owner.
3. `pnpm test` and `pnpm test:e2e` for real — confirm the suites pass
   rather than skip.
4. Supabase dashboard → Authentication → Providers → Email → enable
   "Prevent use of leaked passwords" (Pro plan or above only — check
   whether this project's plan allows it).
5. Clean up the two leftover `rls-test-a`/`rls-test-b` institutes and
   their users in the dev project — I created them manually during task 2
   to prove isolation, and a Supabase tool-level issue (every `DELETE`
   statement hung) stopped me from removing them. Harmless (just test
   rows), but worth tidying.

## Known gaps (not failures — out of Stage 1's explicit scope)

Straight from SECURITY.md's full lifetime list, none of these were in
the original Stage 1 task list:

- 2FA for `institute_owner`/`super_admin`
- Concurrent session limits per student
- Custom domain verification, subdomain takeover prevention on offboarding
- Video/storage signed URLs (Bunny Stream integration)
- CSV/bulk-import formula-stripping
- CSP and other security headers
- Data export/deletion tooling (DPDP readiness)
- Payments (Razorpay) — no feature exists yet to need webhook handling
- Rich text sanitization — no rich-text content type exists yet
- Role-change capability and its audit event — `profiles.role` is
  deliberately immutable after creation (migration 0002's trigger); adding
  a sanctioned way to change it (e.g. promote student→instructor) needs
  its own migration with proper authorization, not a quick patch

## Architecture decisions worth knowing before you extend this

- **Service-role usage is narrow and justified, not a shortcut.** Used
  only where RLS genuinely can't do the job — resolving a tenant for an
  anonymous pre-login visitor, writing profiles at signup (no insert
  policy exists for anon/authenticated by design), audit log writes.
  Every other read/write goes through the user's own session client and
  RLS. Keep it that way.
- **Next.js 16 breaking changes**: this version is newer than most
  training data. `middleware.ts` → `proxy.ts` (migrated via the official
  codemod), and "Cache Components" blocks production builds on any route
  reading `cookies()`/`headers()` unless you opt out or adopt the
  Suspense/`use cache: private` streaming pattern. We opted out
  (`instant = false` on the root layout) since this whole app is
  session-driven and static-shell optimization isn't a Stage 1 concern.
  `node_modules/next/dist/docs/` has the current guides — read them before
  assuming training-data Next.js behavior.
- **Rate limiting is Postgres-backed, not in-memory** — in-memory counters
  don't work across Vercel's serverless invocations.
- **Sandbox-only dummy env value**: if you ever see
  `SUPABASE_SERVICE_ROLE_KEY=sandbox-local-dummy-not-a-real-secret` in
  `.env.local`, that's leftover from build verification in a
  network-restricted sandbox — replace it with your real key.
