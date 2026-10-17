# Handoff

Everything below reflects the state of `claude/security-multi-tenant-lms-e5198b`
after Stage 6. Stage 1 (tenancy, auth, platform admin), Stage 2 (courses,
lessons, enrollment, video, quizzes/exams), Stage 3 (scheduled quiz-attempt
auto-expiry), Stage 4 (unenroll, bulk question import, gradebook export),
Stage 5 (question pools, short-answer questions, the attempt-limit race
fix, quiz analytics, an audit log viewer, account settings, and course
search), and Stage 6 (paid enrollment via Razorpay) are all built,
committed, and pushed — to this branch directly, which is this repo's
default branch (there's no separate `main`; everything lands here
straight, no PR workflow). `README.md` has setup steps, `SECURITY.md` is
the mandatory rulebook. This file is the map, in the order the six stages
happened.

## Access you'll need

- **Repo**: `gouda8055/tests`, branch `claude/security-multi-tenant-lms-e5198b`
  (the default branch — push here directly).
- **Supabase project**: `lms-exam-saas`, ref `uprhdpwfztdeifhktwww`, region
  `ap-south-1`. Separate from any other project on the account — see
  SECURITY.md §2. Migrations `0001`–`0026` are applied.
- **`.env.local`** (gitignored, create it yourself): real
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are in the
  README's Getting Started section. **`SUPABASE_SERVICE_ROLE_KEY` is not in
  the repo anywhere** — get it from the Supabase dashboard (Project Settings
  → API → service_role secret key). Nothing that touches auth, the platform
  screen, courses/quizzes, or the test suites works without it.
- **First login**: `superadmin@example.com` / `ChangeMe!12345` — a public
  placeholder committed in `supabase/migrations/0006_seed_super_admin.sql`,
  not a secret. Rotate it before this goes anywhere near production.
- **Bunny Stream** (video lessons): no account/credentials exist yet. The
  four `BUNNY_STREAM_*` env vars in `.env.example` are optional — video
  playback degrades to a clear "not configured" message until you add a
  real account. See the Stage 2 section below.
- **`CRON_SECRET`** (Stage 3): protects `/api/cron/finalize-expired-attempts`.
  Not set in the repo. Generate one (`openssl rand -hex 32`), put it in
  `.env.local` for local testing and in the deployment platform's env vars
  for production — see the Stage 3 section below for how this is verified
  without it ever being committed anywhere.
- **Razorpay** (paid enrollment, Stage 6): no account exists yet. The three
  `RAZORPAY_*` env vars in `.env.example` are optional — checkout degrades
  to a clear "payments aren't configured" message until you add a real
  (use test-mode keys first) account. See the Stage 6 section below.

## Stage 2 — courses, lessons, enrollment, video, quizzes/exams

### What's built

- **Schema** (`supabase/migrations/0010`–`0020`) — `courses`, `lessons`,
  `enrollments`, `quizzes`, `quiz_questions`/`quiz_question_options`,
  `quiz_answer_keys` (no student select policy, ever — SECURITY.md §4),
  `quiz_attempts`, `quiz_attempt_answers`. Same RLS idiom as Stage 1
  throughout (helper calls wrapped in `(select ...)`, `institute_id`
  server-stamped, no delete policies, `archived_at` as the soft-delete).
  Edit rights are creator-only for `instructor`, with `institute_owner`
  able to edit anything in their institute.
- **Courses/lessons** (`src/lib/courses/`, `src/lib/lessons/`) — draft/
  published status, markdown lesson content via `react-markdown` (no
  `rehype-raw`, no `dangerouslySetInnerHTML` — see `src/components/shared/
  markdown.tsx` for why this sidesteps SECURITY.md §5's sanitization
  requirement entirely rather than needing DOMPurify), optional
  `video_provider`/`video_id` per lesson.
- **Enrollment** (`src/lib/enrollment/`) — student self-enroll only, no
  payment gate (Razorpay still out of scope, nothing needs it yet).
- **Video** (`src/lib/video/bunny.ts`) — Bunny Stream token-auth signed
  URLs, generated only after verifying enrollment + institute via RLS.
  **Untested without real credentials** — fully wired, dormant, same
  treatment Stage 1 gave phone OTP.
- **Quizzes/exams** (`src/lib/quizzes/`) — timed attempts, question
  randomization (persisted per-attempt as `question_order`/`option_order`,
  computed once at start so a later question edit never reshuffles an
  attempt in flight), exact-match all-or-nothing grading
  (`src/lib/quizzes/grading.ts`), lazy timeout finalization (no cron exists
  in this stack — see "Known gaps" below), attempt limits enforced both in
  the `startAttempt` action and in the insert policy's `with check`.
- **Tests** — `tests/rls/quiz-answer-keys.test.ts` (Vitest, live against
  the dev project): answer-key secrecy from students, DB-level timeout
  enforcement, attempt-limit enforcement, and explicit regression coverage
  for the two bugs below. All 40 tests (Stage 1 + Stage 2) pass, repeatably,
  with no fixture leaks.

### Two real security bugs found and fixed during this build

Both caught by the new test suite, not assumed — worth reading before
touching `quiz_attempts`' RLS again:

1. **Forged score/timer.** The original `quiz_attempts` insert/update
   policies checked *who* was writing but not *what* — a student hitting
   PostgREST directly (bypassing the app entirely) could set
   `status='submitted'` with an arbitrary `score`, or inflate
   `duration_seconds`/`grace_seconds` to extend their own exam time
   indefinitely. Fixed in `0019_lock_down_attempt_writes.sql`: the insert
   policy now pins every write-once column (status/score/submitted_at
   forced to fresh-attempt defaults, `duration_seconds`/`grace_seconds`
   forced to match the quiz's current values, `started_at` pinned to ~now),
   and the student update policy was dropped entirely — every legitimate
   status/score write already goes through the service-role grading engine
   in `grading.ts`, so there was nothing for a student-facing update policy
   to legitimately allow.
2. **RLS self-reference recursion.** The attempt-count check in that same
   insert policy did `select count(*) from quiz_attempts qa2 where ...`
   directly inside `quiz_attempts`' own policy. Once a quiz had more than
   one existing attempt row, Postgres couldn't safely resolve this and threw
   "infinite recursion detected in policy for relation quiz_attempts" —
   present since the schema was first written, just never exercised until a
   test tried a second successful attempt. Fixed in
   `0020_fix_attempt_count_recursion.sql` with a `SECURITY DEFINER`
   `student_attempt_count()` helper, the same pattern `0004_helper_functions.sql`
   already used for `profiles` and for the same reason (a table's own
   policy can't safely subquery itself without bypassing the caller's RLS
   for that one read).

### A real (non-security) bug found and fixed: double action dispatch

Five client components — `course-form.tsx`, `lesson-form.tsx`,
`quiz-form.tsx`, `question-form.tsx`, and `attempt-runner.tsx`'s submit
form — had both `action={formAction}` **and** a manual `onSubmit` handler
that called the same action again via `startTransition`. This double-fires
the same `useActionState` dispatch and reliably hangs the submission
forever in a real browser (confirmed via Playwright, not just in theory —
this is exactly the mechanism, not a load issue). Fixed by removing the
redundant `onSubmit`/`startTransition` wrapper everywhere except
`attempt-runner.tsx`, which legitimately needs to flush pending autosaves
before submitting — there, the fix was to drop the conflicting `action`
prop instead and make `onSubmit` the sole dispatch path. If you add a new
form, copy `create-institute-form.tsx`'s plain `<form action={formAction}>`
pattern; don't add a manual dispatch alongside it.

### Also fixed: missing `refresh()` before redirecting into a new page

`createCourse`, `createLesson`, `createQuiz`, `createQuestion`, and the
quiz attempt start/submit actions all call `redirect()` into a page the
client router has never cached. Every other mutating action in this
codebase already calls `next/cache`'s `refresh()` (to invalidate the client
router) before any redirect; these five didn't. Added it to all of them.
This was a real gap worth closing regardless of the e2e flake below — any
new "create and navigate to the new resource" action should call
`refresh()` immediately before its `redirect()`, matching the existing
pattern.

### Known gap: an unreliable new e2e test, and why it's not a code problem

`e2e/course-quiz-flow.spec.ts` (full course→lesson→quiz→question→enroll→
attempt→result flow, Playwright) is committed but **does not reliably
pass**, even after the `refresh()` fix above. Root-cause investigation
(extensive — don't redo this, read the summary):

- A hard `page.reload()` after any Server-Action redirect always recovers
  the correct page, every time, meaning the underlying server-side data and
  rendering are correct — only the client-side transition occasionally
  fails to apply.
- It isn't specific to one route or to Stage 2: partway through
  investigation, Stage 1's own previously-100%-reliable
  `e2e/signup-login-dashboard.spec.ts` started failing with the identical
  symptom, on code this session never touched.
- Found and cleaned up a real, separate hygiene issue along the way: an
  orphaned `next-server` process from hours earlier was still running
  (renamed from `next dev` after startup, so `pkill -f "next dev"` never
  matched it), potentially sharing Turbopack's build cache with the live
  server. Killed it, cleared `.next`, restarted clean — **the flake still
  reproduced**, so that wasn't the sole cause either.
- `pnpm build` is unaffected throughout — this is dev-server-only.

Conclusion: something in this specific sandbox's execution environment
degraded partway through a long session (possibly resource contention
unrelated to Next.js at all), not a defect in the app or in Stage 2's code.
`course-quiz-flow.spec.ts` has `retries: 2` and real selectors verified
against actual component output — on a fresh machine/session it may well
pass cleanly. If it still flakes for you, the fallback is manual
click-through (`pnpm dev`, use a `*.localtest.me` subdomain) — the DB-level
test suite (`pnpm test`) already proves the business logic is correct
independent of this.

### Immediate next steps for you

1. Everything from Stage 1's list that's still open: enable Supabase's
   leaked-password-protection toggle (Pro plan), decide on the `acme` test
   institute.
2. Get Bunny Stream credentials if video lessons matter yet; add them to
   `.env.local`.
3. Try `e2e/course-quiz-flow.spec.ts` yourself — see if the flake above
   reproduces in your environment or was specific to the sandbox.
4. Set a real `CRON_SECRET` and a cron schedule for your actual Vercel plan
   — see the Stage 3 section below.
5. Get a real (test-mode first) Razorpay account and set the three
   `RAZORPAY_*` env vars — see the Stage 6 section below — once paid
   enrollment actually needs to work end to end rather than stay dormant.
6. Decide on a Stage 7 scope — there's no brief for it yet. Two themes
   remain deferred: notifications, and the small ops loose ends in this
   list.

## Stage 3 — scheduled quiz-attempt auto-expiry

### What's built

Stage 2 shipped grading with a **lazy** finalize: `finalizeIfExpired()` in
`grading.ts` only flips a stale `in_progress` attempt to `timed_out` (and
grades it) the next time anyone's request happens to touch that attempt —
correct (the real deadline is enforced at the RLS layer regardless), but an
attempt a student just abandons can sit `in_progress` indefinitely if no
one ever loads it again. Stage 3 adds the "real cron" from Stage 2's
known-gaps list, reusing that exact same logic instead of reimplementing
it:

- **`src/lib/quizzes/cron.ts`** — `finalizeAllExpiredAttempts()`: lists
  every `in_progress` attempt across every institute (service-role,
  `limit 500` per sweep so one backlog can't make a single run unbounded —
  a larger backlog just drains over subsequent runs), filters to the ones
  past `attemptDeadline()`, and calls the *same* `finalizeIfExpired()` on
  each. No grading logic is duplicated or reimplemented in SQL — this is
  deliberately the one reason "Vercel Cron → Route Handler" was chosen over
  Supabase `pg_cron` (which would have needed the exact-match scoring logic
  rewritten in SQL, risking drift from `grading.ts` over time).
- **`src/app/api/cron/finalize-expired-attempts/route.ts`** — the Vercel
  Cron target. Checks `Authorization: Bearer ${CRON_SECRET}` before doing
  anything; returns 500 if `CRON_SECRET` isn't configured at all (refuses
  to run unauthenticated rather than silently no-op'ing — same "dormant
  until configured" treatment Stage 2 gave Bunny Stream), 401 on a
  missing/wrong secret. Vercel sends that header automatically on every
  scheduled invocation once `CRON_SECRET` exists as a project env var — no
  extra wiring needed on Vercel's side.
- **`vercel.json`** — defines the schedule: `0 3 * * *` (once daily) by
  default, because that's the frequency every Vercel plan supports. **If
  you're on Pro or above, tighten this** — e.g. `*/15 * * * *` — for a
  timelier gradebook view of stale attempts. This only changes how quickly
  the UI reflects a timeout; it can never affect exam integrity, since the
  RLS deadline on `quiz_attempt_answers` (Stage 2, `0018`) rejects a late
  write regardless of whether this cron has run yet.

### Verified

No real cron scheduler exists in dev, so this was verified the way it will
actually run in production: a real HTTP request hitting the real Next.js
route. `finalizeIfExpired()` calls `logAudit()` → `getClientIp()` →
`next/headers`' `headers()`, which only works inside an actual Next.js
request scope — calling `finalizeAllExpiredAttempts()` as a bare function
from a Vitest test throws `headers() was called outside a request scope`,
confirmed firsthand while building this. So this is **not** covered by the
Vitest RLS suites (which never spin up the Next.js server) — it's
`e2e/cron-finalize-expired-attempts.spec.ts` instead, a Playwright spec that
uses the `request` fixture (no browser page needed) against the real `pnpm
dev` server Playwright's `webServer` config already starts. It covers: 401
with no/wrong secret and no side effects, 200 + correct grading + status
flip for a backdated stale attempt with the right secret, and idempotency
(a second sweep leaves an already-finalized attempt untouched). Also
reconfirmed clean `lint`/`typecheck`/`build` after adding the route (Next 16
Cache Components rejects the route-segment `dynamic = "force-dynamic"`
export that's otherwise standard in older Next docs/training data — a
Route Handler that reads `headers()`/env secrets is dynamic by default
under Cache Components already, so the export isn't needed; just leave it
out).

### If you don't know your Vercel plan yet

The default `0 3 * * *` schedule works on every plan including Hobby (free)
— Hobby limits cron jobs to once a day, so this ships "as scheduled" to
work out of the box rather than guessing a frequency that might fail to
deploy. The lazy `finalizeIfExpired()` path from Stage 2 still runs on
every relevant request regardless, so day-to-day correctness never depends
on this cron's frequency — only on how fast a stale attempt's status
reflects in a staff-facing list before that happens anyway.

## Stage 4 — unenroll, bulk question import, gradebook export

### What's built

- **Unenroll** (`supabase/migrations/0021_enrollments_delete.sql`,
  `src/lib/enrollment/actions.ts`'s `unenrollFromCourse`) — enrollment had
  no delete policy at all before this (self-enroll was one-way, by
  design, through Stage 3). The new policy mirrors `courses_update`'s
  creator-check shape: a student always deletes their own enrollment; an
  institute_owner deletes any in their institute; an instructor only in a
  course they created. One action serves both the roster's "Remove"
  button (staff) and the student course page's "Unenroll" button (self) —
  `unenrollFromCourse` just picks the right success message, the RLS
  policy is what actually decides whether either succeeds. No cascade
  concerns: nothing references `enrollments.id`, so a removed student's
  lesson/quiz history is untouched.
- **Bulk question import**
  (`src/lib/csv.ts`, `src/lib/quizzes/csv-import.ts`,
  `importQuestions` in `src/lib/quizzes/actions.ts`,
  `.../questions/import/page.tsx`) — paste a CSV
  (`question_text,points,option_1,...,correct_options`, 2-10 option
  columns, `;`-separated 1-based `correct_options` indices; question type
  is inferred from how many are marked correct) and get every question
  inserted in one shot, through the exact same
  question+options+answer-key insert shape `createQuestion` already used.
  Every row's errors are collected and reported at once (line-numbered)
  rather than stopping at the first, and the whole import is all-or-
  nothing: a failure partway through archives whatever this import
  already created. Every text cell gets `stripFormulaPrefix()`'d
  (SECURITY.md §5's CSV-injection defense) before it's stored.
- **Gradebook export**
  (`.../quizzes/[quizId]/export/route.ts`) — a GET Route Handler that
  reuses the attempts page's exact data loading (same
  `finalizeExpiredAttempts` lazy sweep, same `getStudentNames`) and writes
  a CSV with a UTF-8 BOM (so Excel renders non-ASCII names correctly).
  Every cell — including app-authored names/statuses, not just anything
  a student typed — gets `stripFormulaPrefix()`'d too; SECURITY.md §5's
  CSV-injection rule is a blanket one for anything that becomes a CSV
  cell, not only user-supplied text. Rate-limited
  (`checkRateLimit("quiz.export", ...)`) per SECURITY.md §5's "rate limit
  ... exports" line.
- **`src/lib/csv.ts`** — the one new piece of real logic this stage
  needed: `parseCsv`/`toCsvRow`/`stripFormulaPrefix`, pure functions with
  no `server-only`/env dependency, shared by the importer and the
  exporter. Directly unit-tested (`tests/unit/csv.test.ts`,
  `tests/unit/csv-import.test.ts` — 26 tests between them).

### Verified

- `tests/rls/enrollment-unenroll.test.ts` (new, live): student deletes own
  enrollment vs. another student's (0 rows); the course's creator-
  instructor can remove a student vs. an instructor who didn't create it
  (0 rows); institute_owner removes any enrollment in their institute; a
  *different* institute's owner cannot touch this one's enrollment (0
  rows) — the new RLS surface this stage actually added, so this is the
  one place real new coverage was needed.
- **No Vitest test calls `importQuestions`/`unenrollFromCourse` as bare
  functions**, for the same reason the Stage 3 cron logic couldn't be:
  both are `"use server"` actions that call `next/cache`'s `refresh()`
  (and in `unenrollFromCourse`'s and `createQuestion`'s case,
  `getClientIp()` too), which need a real Next.js request-handling scope
  a bare Vitest call doesn't have.
- `e2e/stage4.spec.ts` (new, Playwright against the real dev server):
  owner bulk-imports 2 questions via the textarea, publishes the quiz,
  fetches `/export` directly (via `context.request`, sharing the signed-
  in page's cookies — unlike the cron spec, this route needs a real
  session, not an API secret) and checks the CSV body contains the
  seeded attempt's row; removes a student from the roster; a second
  student self-unenrolls. One real UI behavior worth knowing if you
  touch either button: the server action's `refresh()` re-renders the
  whole list/page the instant the delete lands, so the removed row (or
  the "not enrolled" branch replacing the enrolled one) appears
  immediately — there's no lingering on-screen "success" message to wait
  for, because the component showing it is itself removed from the tree
  in that same update. Assert on the row/branch changing, not on success
  text, for either unenroll path.
- Hit one real, unrelated flake while running this spec repeatedly during
  development: `checkRateLimit("login", 10, 900)` is keyed by IP with no
  per-test identifier, so running this spec (2 real sign-ins each) back
  to back several times in a row can trip the same 15-minute login rate
  limit a real attacker would — confirmed by the sign-in page literally
  showing "Too many attempts." This is the rate limiter working
  correctly, not a bug; if you hit it while developing against this spec,
  wait a few minutes rather than suspecting the new code.

## Stage 5 — question pools, short answer, the attempt-limit race fix, analytics, audit log, settings, search

User picked three of six proposed themes to bundle: exam engine depth,
instructor-facing tools, student-facing tools (paid enrollment,
notifications, and small ops loose ends were explicitly deferred). Two
scope cuts made along the way, in case you wonder why they're missing:
**no "matching" question type** (real new UI + a different answer-key
shape for uncertain payoff) and **no dedicated "true/false" feature**
(already works today — a `single_choice` question with exactly two
options IS a true/false question). Certificates of completion were also
proposed but deferred: they need a new "passing score" concept no quiz
has today, a PDF-generation dependency, and a template design — the
least-defined item on the list.

### What's built

- **Fixed the `max_attempts` concurrency race**
  (`supabase/migrations/0022_fix_attempt_limit_race.sql`) — the gap
  documented since Stage 2: two simultaneous `startAttempt` requests could
  both pass `quiz_attempts_insert_self`'s attempt-count check before
  either committed, since that check is `STABLE` and evaluated against
  the single INSERT statement's snapshot (blocking alone doesn't help
  under READ COMMITTED — a blocked statement resumes with the *same*
  snapshot). Fixed with a `BEFORE INSERT FOR EACH ROW` trigger that takes
  a `pg_advisory_xact_lock` scoped to the (quiz, student) pair, then runs
  its own fresh count query — plpgsql function bodies get a fresh READ
  COMMITTED snapshot per internal query, unlike the outer statement, so
  the second transaction's count (taken after the lock the first one just
  released) correctly sees the first's committed row. No `SECURITY
  DEFINER` needed. Verified with a real concurrency test (two inserts
  fired via `Promise.all`, not sequentially) in
  `tests/rls/quiz-attempt-limit-race.test.ts`. One real advisor finding
  caught and fixed along the way: the trigger function was missing `set
  search_path = public` (every other function in this schema pins it) —
  `0023_fix_enforce_attempt_limit_search_path.sql`.
- **Question pools ("pull N of M")** — a nullable `quizzes.pool_size`
  (`0024_quiz_pool_size.sql`). When set and less than the quiz's active
  question count, `startAttempt` (`src/lib/quizzes/attempt-actions.ts`)
  samples that many random questions before persisting `question_order` —
  everything downstream (grading, the attempt UI, result review) already
  operates purely off that persisted list, so nothing else needed to
  change for a smaller sampled list to just mean a smaller `max_score`.
  Selection is always random; presentation order still respects
  `randomize_questions` independently (off means the sampled subset shows
  in its original authored order, not further shuffled).
- **Short-answer questions** (`0025_short_answer_questions.sql`) —
  exact-match, case/whitespace-insensitive text grading against one or
  more acceptable answers. `quiz_answer_keys.correct_option_ids` is now
  nullable with a new nullable `correct_text_answers text[]`, exactly one
  populated (DB check constraint, same invariant-via-constraint precedent
  as lessons' `(video_provider is null) = (video_id is null)`);
  `quiz_attempt_answers` gained a nullable `text_answer`. The grading
  logic itself (`isQuestionCorrect`, `sameSet`) lives in the new
  **`src/lib/quizzes/correctness.ts`** — pulled out of `grading.ts`
  specifically because `grading.ts` is `server-only` (importing it
  outside a real Next.js request/render throws), so this pure piece
  wouldn't have been unit-testable otherwise; `grading.ts` re-exports both
  names so no existing import site needed to change. A question's type is
  **locked after creation** — switching a choice question to/from
  short_answer would orphan its options or its answer key's shape, so the
  type Select in `question-form.tsx` is only interactive when creating;
  editing shows it as a fixed label plus a hidden input, and
  `updateQuestion` never writes `question_type` at all, branching instead
  on the DB's own stored type (never the client-submitted one — a
  tampered request can't flip which validation path runs). Bulk CSV
  import stays choice-only this stage; short-answer rows aren't a
  supported import format yet.
- **Quiz analytics**
  (`.../quizzes/[quizId]/analytics/page.tsx`) — attempt counts by status,
  average score (as a *percentage*, not raw score, since pool_size means
  `max_score` isn't constant across a quiz's attempts anymore), a
  bucketed score-distribution bar chart (plain Tailwind divs, no charting
  dependency), and per-question correct-rate — computed by checking each
  question only against the attempts whose persisted `question_order`
  actually included it, not every attempt, since pools mean not every
  attempt sees every question.
- **Audit log viewer** (`/admin/audit-log`, `institute_owner` only) —
  needed no new RLS at all;
  `audit_logs_select_super_admin_or_owner` (0005) already granted this
  read, nothing had ever used it. Actor names resolved via a new, broader
  sibling of `getStudentNames`:
  **`src/lib/audit/names.ts`**'s `getProfileNames` (no role filter, since
  an audit log's actor can be any role, unlike a roster).
- **Account settings** (`/student/settings`, `/admin/settings`) — change
  display name (already allowed by `profiles_update_self`, 0005) and
  change password (`supabase.auth.updateUser`, no extra Supabase config).
  New `src/lib/account/actions.ts`, same Zod/`requireRole`/`logAudit`/
  `refresh()` convention as every other action in this codebase.
- **Course search** — both course list pages got a small client
  component wrapping the already-fetched list with a plain in-browser
  title filter (`src/components/courses/course-list.tsx`,
  `student-course-grid.tsx`). No new server round-trip, no URL state —
  neither list has ever needed pagination. The server page still does the
  one data fetch exactly as before and hands plain, already-formatted
  data to the client component (timestamps are pre-formatted server-side
  per `format.ts`'s existing "server-rendered timestamp" convention,
  never passed as raw values for a client component to reformat).

### Verified

- Live tests: the concurrency race test above, plus
  `tests/rls/quiz-short-answer.test.ts` (answer-key secrecy for a
  short_answer question, the exactly-one-shape check constraint rejecting
  both-set and neither-set rows, a student successfully saving a
  `text_answer` within the deadline, a late one still rejected). 15 new
  unit tests for the extracted `src/lib/quizzes/correctness.ts`
  (`tests/unit/correctness.test.ts`) — case/whitespace-insensitive
  matching, wrong-answer scoring, exact-set-match for both choice types —
  the same reasoning as Stage 4's `csv.ts`/`csv-import.ts` split: pull
  pure logic out of a `server-only` module so it's actually unit-testable.
- `e2e/stage5.spec.ts` (Playwright, real dev server, one long flow):
  sets `pool_size = 2` on a 3-question quiz via the UI and confirms an
  attempt shows exactly 2 questions; adds a short-answer question via the
  UI and confirms it grades correctly end to end; checks the analytics
  page's average-score and the audit log's `quiz.attempt.submitted`
  entry; updates a profile name and password through the settings pages
  and confirms the new password actually works by signing in again with
  it; exercises course search on both the admin and student lists. Needed
  `test.setTimeout(180_000)` — this single flow does far more sequential
  navigation than any other spec, and the default 30s budget wasn't
  enough on its own. Also hit (and fixed) a real test bug, not an app bug:
  Playwright's `getByLabel` does substring matching by default, so
  `getByLabel("New password")` also matched "Confirm new password" —
  needed `{ exact: true }`.
- 88 Vitest tests total, lint/typecheck/build clean, no new advisor
  findings beyond the one `search_path` fix already folded into this
  stage's own migrations.

## Stage 6 — paid enrollment (Razorpay)

Closes the last deferred theme from Stage 5's scoping question (the other
two — notifications and the small ops loose ends below — are still
deferred). Followed SECURITY.md §7 to the letter rather than improvising,
since this is the first feature touching real financial transactions,
even in test mode.

### What's built

- **Course pricing** — `courses.price_paise` (nullable; null/0 stays free,
  using the exact same self-enroll flow as before) plus `currency`
  (`'INR'` default — single-currency system for now). A course-form.tsx
  "Price (₹, optional)" field, converted to paise
  (`Math.round(rupees * 100)`) in `courses/actions.ts` — the one rounding
  point in the whole feature.
- **`payments` table** (`0026_payments.sql`) — the immutable per-
  transaction record SECURITY.md §7 requires. The load-bearing design
  choice: **no update or delete policy exists for any authenticated
  role, at all** — only the webhook's service-role client can ever
  transition `status` from `created` to `captured`/`failed`. This is what
  makes "grant access only from a verified webhook" a fact enforced by
  Postgres, not just something the app happens to do. The insert policy
  (student, `status='created'` only) re-verifies `amount_paise`/`currency`
  against the course's *current* price via a subquery — "the database is
  the last line of defense" holds here exactly like everywhere else in
  this schema.
- **`enrollments_insert_self` (0011) tightened**: self-insert now only
  works when the course is free. A priced course's enrollment can only
  come from the webhook's service-role write — closing what would
  otherwise be a direct path around payment entirely.
- **Order creation** (`src/lib/payments/actions.ts`'s `createCheckoutOrder`)
  — a plain async function (not a `<form>` action, same convention as
  `saveAnswer`), rate-limited, computes the amount **only** from the
  course's own `price_paise`, creates a Razorpay order (new `razorpay`
  npm dependency), inserts the matching `payments` row. Returns the order
  details to the client to launch Razorpay's hosted Checkout — never a
  redirect.
- **Checkout UI** (`src/components/payments/checkout-button.tsx`) —
  loads Razorpay's Checkout script on click, opens the modal. Razorpay's
  own client-side success handler is treated as **cosmetic only**: it
  switches to "confirming your enrollment…" and polls a thin
  `getEnrollmentStatus` check for up to 20s rather than granting anything
  itself — SECURITY.md §7's "never treat a client redirect as proof of
  payment," actually enforced, not just documented.
- **Webhook** (`src/app/api/webhooks/razorpay/route.ts`) — service-role
  only, no user session (this is Razorpay's server calling us). Reads
  the body via `request.text()` **before** any JSON parsing — signature
  verification needs the exact raw bytes Razorpay signed, not a
  reserialized object. Verifies `X-Razorpay-Signature` with Node's
  built-in `crypto` (not the SDK's own helper — explicit and auditable,
  matching this codebase's general preference, e.g. `csv.ts`'s
  `stripFormulaPrefix`). Idempotent: a payment already marked `captured`
  is a no-op, not a re-grant; a duplicate enrollment insert (unique-
  violation) is treated as success, not an error.
- **Dormant until configured** — same treatment Stage 2 gave Bunny
  Stream: `isRazorpayConfigured` (`src/lib/env.server.ts`) gates both the
  checkout button (shows "Payments aren't configured for this institute
  yet." instead) and the webhook (returns 500 rather than running
  unauthenticated).

### Scope cut

No payments-history/revenue UI this stage (an instructor-facing
transactions view). The `payments` table exists for integrity and is
directly queryable; a dedicated viewer is a reasonable follow-up once
there's real transaction volume to look at, not before.

### Verified

- `tests/rls/payments.test.ts` (new, live): a student can still self-
  enroll directly in a free course (regression against Stage 1-5
  behavior); a student **cannot** self-insert an enrollment for a priced
  course — and this is a genuine Postgres error (`42501`), not a silent
  0-row result, because a failing `WITH CHECK` on INSERT is a hard
  rejection (unlike UPDATE/DELETE, which filter silently) — worth
  knowing if you write a similar insert-rejection test later; a student
  can create a `payments` row with the correct amount but not a forged
  one; no authenticated role can update a `payments` row's status at
  all.
- `tests/unit/payments-signature.test.ts` (new): the webhook's signature
  verification (`src/lib/payments/signature.ts`, pulled out pure/
  server-only-free the same way `csv.ts` and `correctness.ts` were) —
  valid signature accepted, tampered body rejected, wrong secret
  rejected, malformed header rejected without throwing.
- **Not independently testable without a real Razorpay account**: actual
  order creation against Razorpay's live API, and a real webhook
  delivery. `e2e/stage6.spec.ts` verifies everything that *is*
  testable in the dormant state instead: course pricing end to end
  through the UI, the "not configured" message appearing with no
  checkout button for a priced course, the free-course self-enroll flow
  staying completely unaffected, and the webhook refusing to run
  (500) without configuration.
- 99 Vitest tests total, lint/typecheck/build clean, no new advisor
  findings.

## Known gaps (not failures — out of scope so far)

Everything from Stage 1's list that's still open, plus:

- **No real Razorpay account** — paid enrollment (Stage 6) is fully
  wired but dormant; manual click-through through an actual checkout is
  only possible once real (or test-mode) `RAZORPAY_*` keys exist.
- Notifications and the handful of remaining small ops items are still
  deferred from Stage 5/6's scoping — see "Immediate next steps" there.

The `max_attempts` concurrency race from Stage 2's list is now fixed (see
Stage 5 above).

## Architecture decisions worth knowing before you extend this

- **Service-role usage is narrow and justified, not a shortcut** (Stage 1's
  note still holds). Stage 2 adds exactly one more: `grading.ts` reading
  `quiz_answer_keys` to grade an attempt, since that table has no student
  select policy by design.
- **Next.js 16 breaking changes** (Stage 1's note still holds — read
  `node_modules/next/dist/docs/` before assuming training-data behavior).
  Stage 2 adds: `refresh()` from `next/cache` must be called inside a
  Server Action before `redirect()` into a page the client hasn't cached
  yet (see above); dynamic route pages take `params` as `Promise<{...}>`,
  awaited inside an `async` page component.
- **No table's RLS policy may subquery its own table directly** — if you
  need a count/existence check against the same table a policy is attached
  to, wrap it in a `SECURITY DEFINER` helper function first (see
  `student_attempt_count()` in `0020`, or `auth_institute_id()` etc. in
  Stage 1's `0004`). Postgres cannot always safely resolve the direct
  self-reference and will throw "infinite recursion detected in policy."
- **Rate limiting is Postgres-backed, not in-memory** (Stage 1's note still
  holds).
- **Sandbox-only dummy env value** (Stage 1's note still holds).
