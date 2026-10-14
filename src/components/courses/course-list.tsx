"use client";

import { useState } from "react";
import Link from "next/link";

import { StatusBadge } from "@/components/shared/status-badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AdminCourseListItem = {
  id: string;
  title: string;
  status: string;
  archivedAt: string | null;
  ownerLabel: string;
  createdAtLabel: string;
};

/**
 * Client-side title filter over an already-fetched course list. Filtering
 * happens in the browser (no new server round-trip, no URL state) — this
 * list has never needed pagination, so a plain in-memory filter is enough.
 */
export function CourseList({ courses }: { courses: AdminCourseListItem[] }) {
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? courses.filter((course) =>
        course.title.toLowerCase().includes(query.trim().toLowerCase()),
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
          {courses.length === 0 ? "No courses yet." : "No courses match your search."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((course) => (
              <TableRow key={course.id}>
                <TableCell>
                  <Link
                    href={`/admin/courses/${course.id}`}
                    className="font-medium hover:underline"
                  >
                    {course.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={course.status} archivedAt={course.archivedAt} />
                </TableCell>
                <TableCell className="text-muted-foreground">{course.ownerLabel}</TableCell>
                <TableCell className="text-muted-foreground">
                  {course.createdAtLabel}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
