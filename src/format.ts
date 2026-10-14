import { gpa, isGraded, semesterLabel, summarize } from "./grades";
import type { Course, Results } from "./types";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function formatSemester(key: string, courses: Course[]): string {
  const header = `${"Code".padEnd(8)}${"Title".padEnd(30)}${"Unit".padStart(4)} ${"Score".padStart(5)}  Grade`;
  const rows = courses.map(
    (course) =>
      `${truncate(course.code, 8).padEnd(8)}${truncate(course.title, 29).padEnd(30)}${String(course.unit).padStart(4)} ${String(course.score ?? "-").padStart(5)}  ${truncate(course.grade || "Pending", 12)}`,
  );

  const semesterGpa = gpa(courses);
  const sgpa =
    semesterGpa === null
      ? "SGPA: n/a (no GPA-counted grades)"
      : `SGPA: <b>${semesterGpa.toFixed(2)}</b> / 5.00`;

  return [
    `<b>${escapeHtml(semesterLabel(key))}</b>`,
    `<pre>${escapeHtml([header, ...rows].join("\n"))}</pre>`,
    sgpa,
    ...(courses.some((course) => !isGraded(course)) ? ["<i>Pending or unrecognized grades are excluded from SGPA.</i>"] : []),
  ].join("\n");
}

export function formatSummary(results: Results): string {
  const summary = summarize(results);

  return [
    "<b>Summary</b>",
    `CGPA: <b>${summary.cgpa === null ? "n/a" : summary.cgpa.toFixed(2)}</b> / 5.00`,
    `Semesters: ${summary.semesters}`,
    `Units attempted: ${summary.unitsAttempted}`,
    `Units passed: ${summary.unitsPassed}`,
    `Failed courses: ${summary.failed}`,
    `Pending or unrecognized grades: ${summary.pending}`,
    "<i>Electives are not counted.</i>",
  ].join("\n");
}

/** Each page is independently formatted so HTML tags are never split. */
export function semesterPages(key: string, courses: Course[]): string[] {
  const pages: Course[][] = [];
  let page: Course[] = [];
  for (const course of courses) {
    if (page.length && formatSemester(key, [...page, course]).length > 3500) {
      pages.push(page);
      page = [];
    }
    page.push(course);
  }
  if (page.length || !pages.length) pages.push(page);
  const sgpa = gpa(courses);
  const footer = `SGPA: <b>${sgpa === null ? "n/a" : sgpa.toFixed(2)}</b> / 5.00`;
  return pages.map((part, index) => formatSemester(key, part).replace(/SGPA:.*?(?=\n|$)/, footer) +
    (pages.length > 1 ? `\nPage ${index + 1} / ${pages.length}` : ""));
}
