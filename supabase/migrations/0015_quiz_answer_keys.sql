-- The correct answer(s) for a question. Deliberately has NO select policy
-- for the student role — SECURITY.md §4: "Correct answers never leave the
-- server during an attempt." Grading reads this with the service-role
-- client, narrowly, only from src/lib/quizzes/grading.ts — the same
-- "narrow and justified" precedent as Stage 1's signup profile insert.
create table public.quiz_answer_keys (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes (id),
  question_id uuid not null unique references public.quiz_questions (id) on delete cascade,
  correct_option_ids uuid[] not null check (array_length(correct_option_ids, 1) > 0),
  explanation text,
  created_at timestamptz not null default now()
);

comment on table public.quiz_answer_keys is
  'The correct answer(s) for a question. No select policy exists for the student role anywhere in this file — SECURITY.md §4.';

create index quiz_answer_keys_institute_id_idx on public.quiz_answer_keys (institute_id);

alter table public.quiz_answer_keys enable row level security;

-- Staff (creator or institute_owner) only. No branch for 'student' anywhere
-- in this policy — not even a false one — by design.
create policy "quiz_answer_keys_select_staff_only"
  on public.quiz_answer_keys
  for select
  using (
    (select public.is_super_admin())
    or (
      institute_id = (select public.auth_institute_id())
      and exists (
        select 1 from public.quiz_questions qq
        join public.quizzes q on q.id = qq.quiz_id
        where qq.id = question_id
          and (
            (select public.auth_role()) = 'institute_owner'
            or ((select public.auth_role()) = 'instructor' and q.created_by = (select auth.uid()))
          )
      )
    )
  );

create policy "quiz_answer_keys_insert_staff_only"
  on public.quiz_answer_keys
  for insert
  with check (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      where qq.id = question_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and q.created_by = (select auth.uid()))
        )
    )
  );

create policy "quiz_answer_keys_update_staff_only"
  on public.quiz_answer_keys
  for update
  using (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      where qq.id = question_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and q.created_by = (select auth.uid()))
        )
    )
  )
  with check (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      where qq.id = question_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and q.created_by = (select auth.uid()))
        )
    )
  );

-- No delete policy.
