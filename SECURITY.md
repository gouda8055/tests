# SECURITY.md — Multi-Tenant LMS & Exam SaaS

Stack: Next.js (App Router), Supabase (Postgres, Auth, Storage), Vercel, Bunny Stream, Stripe/Razorpay.

These rules are mandatory. If a task conflicts with them, stop and ask. Never silently weaken a rule to make something work.

---

## 0. Core principles

1. **Deny by default.** Access is granted explicitly, never assumed.
2. **The database is the last line of defense.** Enforce tenant isolation in RLS, not only in app code.
3. **Never trust the client.** All identity, tenant, role, price, score and time values come from the server.
4. **Least privilege.** Use the lowest-privilege key and role that can do the job.
5. **Secrets stay server-side.** No exceptions.

---

## 1. Tenant isolation (highest priority)

- Every tenant-owned table MUST have `institute_id uuid not null references institutes(id)`.
- **RLS MUST be enabled on every table** in the `public` schema, including join tables. A table without RLS is a bug.
- Never accept `institute_id` from request bodies, query params or headers. Derive it from the authenticated user's profile.
- Every `INSERT`/`UPDATE` policy MUST include `WITH CHECK`, not only `USING`.
- Never store role or tenant info in `user_metadata` (user-editable). Use a server-controlled `profiles` table or `app_metadata`.
- Views MUST use `security_invoker = true`. `SECURITY DEFINER` functions MUST set `search_path` explicitly and be justified in a comment.
- Storage: prefix every object path with `institute_id/` and write bucket policies against that prefix.

Standard pattern:

```sql
create function auth_institute_id() returns uuid
language sql stable security definer set search_path = public as $$
  select institute_id from profiles where id = auth.uid()
$$;

alter table <table> enable row level security;

create policy "tenant isolation" on <table>
  for all
  using (institute_id = auth_institute_id())
  with check (institute_id = auth_institute_id());
```

**Required test for every new table:** create two institutes (A and B). As a user of A, confirm you cannot select, insert, update or delete B's rows. Write this as an automated test.

---

## 2. Secrets and keys

- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Use it only in server code (route handlers, server actions, edge functions), never in client components.
- Never prefix a secret with `NEXT_PUBLIC_`. Only the Supabase URL and anon/publishable key may be public.
- Never commit `.env*` files. Keep `.env.example` with placeholder values only.
- Stripe/Razorpay secret keys, webhook secrets, and Bunny API and token-auth keys are server-only.
- Use separate Supabase projects and keys for development and production.
- If a secret appears in code, logs or a commit: stop, report it, and tell the user to rotate it.
- Never log secrets, tokens, full request bodies with credentials, or student personal data.

---

## 3. Authentication & authorization

- Check authentication AND authorization on every route handler, server action and API endpoint. Do not rely on middleware or UI hiding alone.
- Roles: `super_admin`, `institute_owner`, `instructor`, `student`. Check role on the server for every privileged action.
- Users MUST NOT be able to update their own `role` or `institute_id` (lock these columns in RLS or via a server-only function).
- Prevent IDOR: for any resource fetched by ID, verify it belongs to the user's institute AND the user has rights to it.
- Rate-limit login, signup, password reset and OTP sending. OTP/SMS endpoints must be strictly limited (cost and abuse).
- Require strong passwords and offer 2FA for `institute_owner` and `super_admin`.
- Consider limiting concurrent sessions per student to discourage account sharing.
- Use host-only cookies. Never set session cookies on the parent domain (`.yourapp.com`).

---

## 4. Exam integrity

- **Correct answers never leave the server** during an attempt. Store answer keys in a separate table with no student read policy.
- **Grade on the server only.** The client sends selected options, never scores.
- **The server owns the clock.** Record `started_at` on the server. Reject answer saves and submissions after `started_at + duration + small grace`. Never trust the browser clock.
- Lock an attempt on submit or timeout. Block re-submission and edits afterward.
- Enforce attempt limits on the server.
- Randomize question and option order per student where configured, seeded per attempt.
- Autosave must be debounced/batched and idempotent.
- Log attempt events (start, save, submit, timeout) for dispute resolution.
- Do not claim proctoring features. Tab-switch/fullscreen detection is a deterrent only, never presented as a guarantee.

---

## 5. Input handling & web attacks

- **Validate all input on the server** with a schema validator (e.g. Zod): type, length, format, allowed values.
- **XSS:** sanitize all rich text (questions, explanations, discussions) with DOMPurify or equivalent before rendering. Avoid `dangerouslySetInnerHTML`; if unavoidable, sanitize first.
- **SQL injection:** use the Supabase query builder or parameterized queries only. Never concatenate user input into SQL.
- **File uploads:** allowlist file types, enforce size limits, validate content type server-side, randomize stored filenames, never serve uploads as executable content.
- **Bulk imports (CSV/Excel/Word question banks):** parse in a size-limited, sandboxed way. Treat all cells as untrusted. Strip formulas to prevent CSV injection (cells starting with `=`, `+`, `-`, `@`).
- **CORS:** never use `*` with credentials. Allow only known origins.
- **CSRF:** use SameSite cookies and verify origin on state-changing requests.
- **Rate limiting** on all public and expensive endpoints (login, OTP, search, uploads, exports).
- Return generic error messages to users. Log detail server-side only.

---

## 6. Video & file protection

- Video via Bunny Stream with **token authentication** enabled. Generate short-lived signed URLs on the server only after verifying enrollment and institute.
- Enable **domain/referrer locking** for the player.
- Never expose raw storage URLs. Serve PDFs and notes via signed, expiring URLs.
- Store `video_provider` and `video_id` per lesson, not hard-coded URLs.
- Note: signed URLs deter sharing. They do not stop screen recording. Do not promise otherwise.

---

## 7. Payments

- Never treat a client redirect as proof of payment. Grant access **only** from a **signature-verified webhook**.
- Webhook handlers MUST be **idempotent** (store event IDs, ignore duplicates).
- Verify amount, currency and product server-side. Never trust a price from the client.
- Never store card data. Use the provider's hosted checkout.
- Keep an immutable `payments` record for each transaction.

---

## 8. Domains & subdomains

- Reserve and block subdomains: `admin`, `api`, `www`, `app`, `login`, `auth`, `support`, `mail`, `static`, `billing`, `security`.
- Validate subdomain format (lowercase letters, digits, single hyphens).
- Custom domains require DNS ownership verification before activation.
- On offboarding, remove DNS records and domain mappings to prevent subdomain takeover.
- Resolve the tenant from the host on the server, and never trust a client-supplied tenant header.

---

## 9. Data protection & privacy

- Collect the minimum personal data. Do not collect Aadhaar or other sensitive IDs unless explicitly required.
- Assume some students are minors. Handle their data with extra care.
- Support data export and deletion per institute and per student (DPDP Act readiness).
- HTTPS only. Set security headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options/frame-ancestors, Referrer-Policy).
- Enable Supabase backups. A restore must be tested, not assumed.
- Define institute offboarding: export, then delete after the retention period.

---

## 10. Audit logging & monitoring

Write to an append-only `audit_logs` table (institute_id, actor_id, action, target, metadata, ip, created_at) for:

- Logins and failed logins
- Role changes
- Data exports and bulk deletes
- Result or score edits
- Payment and enrollment changes
- Domain changes

Students and instructors cannot read or modify audit logs. Alert on repeated failed logins, error spikes and webhook failures.

---

## 11. Dependencies & infrastructure

- Run `npm audit` before releases and keep dependencies updated. Pin versions with a lockfile.
- Do not add a new package without a reason. Prefer well-maintained, widely used libraries.
- Run Supabase **Security Advisor** and **Performance Advisor** after every schema change and fix findings.
- Restrict direct database network access. Use connection pooling and set statement timeouts.
- Limit who has production access (least privilege for team members).

---

## 12. Definition of done (security checklist)

Before marking any feature complete, confirm:

- [ ] New tables have `institute_id`, RLS enabled, and `USING` + `WITH CHECK` policies
- [ ] Cross-tenant access test written and passing
- [ ] No secret exposed to client code or committed
- [ ] Server-side authentication and authorization on every endpoint
- [ ] All inputs validated server-side (schema)
- [ ] User-generated rich text sanitized before render
- [ ] Resources checked for ownership (no IDOR)
- [ ] Rate limiting on public/expensive endpoints
- [ ] Sensitive actions written to `audit_logs`
- [ ] No answer keys or other tenants' data reachable by students
- [ ] Payments confirmed via verified, idempotent webhooks only
- [ ] Supabase Security Advisor clean

---

## 13. When unsure

If a requirement could weaken tenant isolation, expose secrets, or bypass server-side checks: **do not implement it.** Explain the risk and propose a safer alternative.
