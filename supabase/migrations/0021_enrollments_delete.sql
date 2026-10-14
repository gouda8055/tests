-- Unenroll (Stage 4): a student always deletes their own enrollment row;
-- institute_owner may delete any in their institute; an instructor only
-- where they created the course. No delete policy existed before this
-- (0011's comment said so explicitly) -- self-enroll was one-way.
create policy "enrollments_delete"
  on public.enrollments
  for delete
  using (
    institute_id = (select public.auth_institute_id())
    and (
      student_id = (select auth.uid())
      or (select public.auth_role()) = 'institute_owner'
      or (
        (select public.auth_role()) = 'instructor'
        and exists (
          select 1 from public.courses c
          where c.id = enrollments.course_id and c.created_by = (select auth.uid())
        )
      )
    )
  );
