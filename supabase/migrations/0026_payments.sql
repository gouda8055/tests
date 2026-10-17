-- Paid enrollment (Stage 6, SECURITY.md §7). courses.price_paise is
-- nullable -- null/0 stays free, using the exact same self-enroll flow as
-- before. payments is the immutable record §7 requires: status only ever
-- transitions created -> captured/failed via the signature-verified
-- webhook's service-role client -- no update/delete policy exists for any
-- authenticated role at all, which is what makes "grant access only from
-- a verified webhook" a DB-enforced rule, not just an app convention.

alter table public.courses
  add column price_paise int check (price_paise is null or price_paise >= 0),
  add column currency text not null default 'INR';

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes (id),
  course_id uuid not null references public.courses (id),
  student_id uuid not null references public.profiles (id) on delete cascade,
  razorpay_order_id text not null unique,
  razorpay_payment_id text,
  amount_paise int not null check (amount_paise > 0),
  currency text not null default 'INR',
  status text not null default 'created' check (status in ('created', 'captured', 'failed')),
  created_at timestamptz not null default now(),
  captured_at timestamptz
);

comment on table public.payments is
  'Immutable per-transaction record (SECURITY.md §7). No update/delete policy for any authenticated role -- only the signature-verified webhook''s service-role client ever transitions status.';

create index payments_institute_id_idx on public.payments (institute_id);
create index payments_course_id_idx on public.payments (course_id);
create index payments_student_id_idx on public.payments (student_id);

alter table public.payments enable row level security;

create policy "payments_select"
  on public.payments
  for select
  using (
    (select public.is_super_admin())
    or student_id = (select auth.uid())
    or (
      institute_id = (select public.auth_institute_id())
      and (select public.auth_role()) in ('institute_owner', 'instructor')
    )
  );

-- Re-verifies amount/currency against the course's current price (not
-- client input) -- the server action already computes this correctly,
-- but "the database is the last line of defense" is this schema's
-- standing rule (every other insert policy in this file does the same).
create policy "payments_insert_self"
  on public.payments
  for insert
  with check (
    student_id = (select auth.uid())
    and (select public.auth_role()) = 'student'
    and institute_id = (select public.auth_institute_id())
    and status = 'created'
    and razorpay_payment_id is null
    and captured_at is null
    and exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.institute_id = payments.institute_id
        and c.status = 'published'
        and c.archived_at is null
        and c.price_paise = payments.amount_paise
        and c.currency = payments.currency
    )
  );

-- No update/delete policy for any authenticated role: only the
-- service-role webhook handler ever changes status.

-- Self-insert only when the course is free; a priced course's enrollment
-- can now only come from the webhook's service-role write.
drop policy "enrollments_insert_self" on public.enrollments;

create policy "enrollments_insert_self"
  on public.enrollments
  for insert
  with check (
    student_id = (select auth.uid())
    and (select public.auth_role()) = 'student'
    and institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.institute_id = enrollments.institute_id
        and c.status = 'published'
        and c.archived_at is null
        and (c.price_paise is null or c.price_paise = 0)
    )
  );
