-- Certificates of completion (Stage 8). A quiz with no passing_score_percent
-- set doesn't count toward a course's completion requirement at all --
-- lets an instructor keep practice/ungraded quizzes alongside the ones
-- that matter without forcing a threshold on every quiz.
alter table public.quizzes
  add column passing_score_percent int
  check (passing_score_percent is null or passing_score_percent between 0 and 100);

-- One certificate per student per course, ever -- immutable once issued
-- (no re-issuance/revocation this stage, matching this schema's standing
-- no-delete-policy norm). No insert/update/delete policy for any
-- authenticated role at all: only the service-role completion-check path
-- (src/lib/certificates/completion.ts) ever writes one -- a credential-
-- like record an institute might rely on for compliance shouldn't be
-- self-issuable by the student it's about, same reasoning as `payments`.
create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes (id),
  course_id uuid not null references public.courses (id),
  student_id uuid not null references public.profiles (id) on delete cascade,
  issued_at timestamptz not null default now(),
  constraint certificates_course_student_unique unique (course_id, student_id)
);

comment on table public.certificates is
  'Immutable per-student-per-course completion record (Stage 8). No insert/update/delete policy for any authenticated role -- only the service-role completion-check path ever writes one.';

create index certificates_institute_id_idx on public.certificates (institute_id);
create index certificates_course_id_idx on public.certificates (course_id);
create index certificates_student_id_idx on public.certificates (student_id);

alter table public.certificates enable row level security;

create policy "certificates_select"
  on public.certificates
  for select
  using (
    (select public.is_super_admin())
    or student_id = (select auth.uid())
    or (
      institute_id = (select public.auth_institute_id())
      and (select public.auth_role()) in ('institute_owner', 'instructor')
    )
  );

-- No insert/update/delete policy for any authenticated role: only the
-- service-role completion-check path ever writes one.
