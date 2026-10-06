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

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` / `format:check` | Prettier |
| `pnpm test` | Vitest (unit + RLS tests) |
| `pnpm test:e2e` | Playwright end-to-end tests |

## Database migrations

Versioned SQL lives in `supabase/migrations`. RLS is the enforced tenant
boundary — see `SECURITY.md` §1 for the required pattern and the
cross-tenant test every new table must have.
