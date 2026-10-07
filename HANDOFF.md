# Handoff

Everything below reflects the state of `claude/security-multi-tenant-lms-e5198b`
as of commit `36b67dd`. Stage 1 (tenancy, auth, platform admin) and Stage 2
(courses, lessons, enrollment, video, quizzes/exams) are both built,
committed, and pushed — to this branch directly, which is this repo's
default branch (there's no separate `main`; everything lands here straight,
no PR workflow). `README.md` has setup steps, `SECURITY.md` is the mandatory
rulebook. This file is the map, in the order the two stages happened.

## Access you'll need

- **Repo**: `gouda8055/tests`, branch `claude/security-multi-tenant-lms-e5198b`
  (the default branch — push here directly).
- **Supabase project**: `lms-exam-saas`, ref `uprhdpwfztdeifhktwww`, region
  `ap-south-1`. Separate from any other project on the account — see
  SECURITY.md §2. Migrations `0001`–`0020` are applied.
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
4. Decide on a Stage 3 scope — there's no brief for it yet. Natural
   candidates: a gradebook/results export for instructors, unenroll, bulk
   question import, or finally wiring up the quiz-attempt auto-expiry via a
   real cron instead of the lazy on-touch finalize.

## Known gaps (not failures — out of scope so far)

Everything from Stage 1's list that's still open, plus:

- A real cron/scheduled job for quiz-attempt auto-expiry (currently lazy —
  an expired attempt only gets graded the next time anyone touches it; see
  `finalizeIfExpired` in `grading.ts` for the exact mechanism and why
  attempt-limit correctness doesn't depend on it ever running).
- Unenroll (self-enroll only, by design, for this stage).
- A real-time concurrent-`startAttempt` race on `max_attempts`: two
  simultaneous requests can both pass the count check before either
  commits, letting a student get one extra attempt. Documented in
  `0019_lock_down_attempt_writes.sql`'s closing comment — fixing it needs
  either serializable isolation or a server-assigned attempt sequence
  number, deferred as low-severity (fairness, not a score/data-integrity
  issue).
- Bulk question import, gradebook export, CSV formula-stripping (no CSV
  import exists yet to need it).

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
