"use client";

import { useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type StudentCourseListItem = {
  id: string;
  title: string;
  description: string | null;
  enrolled: boolean;
  /** Pre-formatted server-side (e.g. "Free", "₹499") — see format.ts's formatPrice. */
  priceLabel: string;
};

/** Client-side title/description filter — same reasoning as CourseList. */
export function StudentCourseGrid({ courses }: { courses: StudentCourseListItem[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? courses.filter(
        (course) =>
          course.title.toLowerCase().includes(needle) ||
          (course.description?.toLowerCase().includes(needle) ?? false),
      )
    : courses;

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        placeholder="Search courses…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="max-w-xs"
        aria-label="Search courses"
      />
      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {courses.length === 0
            ? "No courses are available yet."
            : "No courses match your search."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((course) => (
            <Link key={course.id} href={`/student/courses/${course.id}`}>
              <Card className="hover:bg-muted/50 h-full transition-colors">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{course.title}</CardTitle>
                    {course.enrolled ? <Badge variant="success">enrolled</Badge> : null}
                  </div>
                  <p className="text-muted-foreground text-xs">{course.priceLabel}</p>
                  {course.description ? (
                    <CardDescription className="line-clamp-3">
                      {course.description}
                    </CardDescription>
                  ) : null}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
