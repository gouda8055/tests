-- Quiz questions and their answer choices. The correct answer never lives
-- in either of these tables — see quiz_answer_keys (0015), which has no
-- student select policy (SECURITY.md §4).
create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes (id),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  position int not null default 0,
  question_text text not null check (char_length(btrim(question_text)) > 0),
  question_type text not null default 'single_choice',
  points numeric not null default 1 check (points > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint quiz_questions_type_check check (question_type in ('single_choice', 'multiple_choice'))
);

create table public.quiz_question_options (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes (id),
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  position int not null default 0,
  option_text text not null check (char_length(btrim(option_text)) > 0),
  created_at timestamptz not null default now()
);

comment on table public.quiz_questions is
  'A question within a quiz. Carries no "correct answer" — see quiz_answer_keys.';
comment on table public.quiz_question_options is
  'The answer choices shown to a student for a question. Carries no "is this correct" flag — that lives only in quiz_answer_keys. Options are not independently archivable; edit via update, not delete+reinsert, to avoid invalidating an in-progress attempt''s stored option_order.';

create index quiz_questions_institute_id_idx on public.quiz_questions (institute_id);
create index quiz_questions_quiz_id_idx on public.quiz_questions (quiz_id);
create index quiz_question_options_institute_id_idx on public.quiz_question_options (institute_id);
create index quiz_question_options_question_id_idx on public.quiz_question_options (question_id);

alter table public.quiz_questions enable row level security;
alter table public.quiz_question_options enable row level security;

create policy "quiz_questions_select"
  on public.quiz_questions
  for select
  using (
    (select public.is_super_admin())
    or (
      institute_id = (select public.auth_institute_id())
      and (
        (select public.auth_role()) in ('institute_owner', 'instructor')
        or public.quiz_is_accessible_to_student(quiz_id)
      )
    )
  );

create policy "quiz_questions_insert"
  on public.quiz_questions
  for insert
  with check (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.quizzes q
      where q.id = quiz_id
        and q.institute_id = quiz_questions.institute_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and q.created_by = (select auth.uid()))
        )
    )
  );

create policy "quiz_questions_update"
  on public.quiz_questions
  for update
  using (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.quizzes q
      where q.id = quiz_id
        and q.institute_id = quiz_questions.institute_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and q.created_by = (select auth.uid()))
        )
    )
  )
  with check (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.quizzes q
      where q.id = quiz_id
        and q.institute_id = quiz_questions.institute_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and q.created_by = (select auth.uid()))
        )
    )
  );

create policy "quiz_question_options_select"
  on public.quiz_question_options
  for select
  using (
    (select public.is_super_admin())
    or (
      institute_id = (select public.auth_institute_id())
      and (
        (select public.auth_role()) in ('institute_owner', 'instructor')
        or exists (
          select 1 from public.quiz_questions qq
          where qq.id = question_id and public.quiz_is_accessible_to_student(qq.quiz_id)
        )
      )
    )
  );

create policy "quiz_question_options_insert"
  on public.quiz_question_options
  for insert
  with check (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      where qq.id = question_id
        and qq.institute_id = quiz_question_options.institute_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and q.created_by = (select auth.uid()))
        )
    )
  );

create policy "quiz_question_options_update"
  on public.quiz_question_options
  for update
  using (
    institute_id = (select public.auth_institute_id())
    and exists (
      select 1 from public.quiz_questions qq
      join public.quizzes q on q.id = qq.quiz_id
      where qq.id = question_id
        and qq.institute_id = quiz_question_options.institute_id
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
        and qq.institute_id = quiz_question_options.institute_id
        and (
          (select public.auth_role()) = 'institute_owner'
          or ((select public.auth_role()) = 'instructor' and q.created_by = (select auth.uid()))
        )
    )
  );

-- No delete policy on either table: archived_at on quiz_questions is the
-- removal mechanism for questions; options are edited in place.
