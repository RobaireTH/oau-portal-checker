import { isElective, isGraded, semesterLabel, semesterProgress, summarize, type SemesterProgress } from "./grades";
import type { Course, Results } from "./types";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function decimal(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

export function formatSemester(key: string, courses: Course[], results: Results = { [key]: courses }): string {
  const completeCourses = results[key] ?? courses;
  const header = `${"Code".padEnd(8)}${"Title".padEnd(30)}${"Unit".padStart(4)} ${"Score".padStart(5)}  Grade`;
  const rows = courses.map(
    (course) => {
      const grade = `${course.grade || "Pending"}${isElective(course.code) ? " elective" : ""}`;
      return `${truncate(course.code, 8).padEnd(8)}${truncate(course.title, 29).padEnd(30)}${String(course.unit).padStart(4)} ${String(course.score ?? "-").padStart(5)}  ${truncate(grade, 12)}`;
    },
  );

  const progress = semesterProgress(results).find((semester) => semester.key === key);
  const sgpa = progress?.sgpa ?? null;
  const cgpa = progress?.cgpa ?? null;
  const units = progress?.units ?? 0;
  const points = progress?.points ?? 0;
  const cumulativeUnits = progress?.cumulativeUnits ?? 0;
  const cumulativePoints = progress?.cumulativePoints ?? 0;

  return [
    `<b>${escapeHtml(semesterLabel(key))}</b>`,
    `<pre>${escapeHtml([header, ...rows].join("\n"))}</pre>`,
    `SGPA: <b>${decimal(sgpa)}</b> / 5.00 · ${points.toFixed(1)} points / ${units} units`,
    `CGPA after semester: <b>${decimal(cgpa)}</b> / 5.00 · ${cumulativePoints.toFixed(1)} cumulative points / ${cumulativeUnits} units`,
    ...(completeCourses.some((course) => isElective(course.code)) ? ["<i>Electives are tracked for graduation and excluded only from SGPA and CGPA.</i>"] : []),
    ...(completeCourses.some((course) => !isElective(course.code) && !isGraded(course)) ? ["<i>Pending or unrecognized non-elective grades are excluded from GPA calculations.</i>"] : []),
  ].join("\n");
}

export function formatSemesterComparison(results: Results): string {
  const progress = semesterProgress(results);
  const header = `${"Semester".padEnd(22)} ${"Units".padStart(5)} ${"SGPA".padStart(5)} ${"CGPA".padStart(5)} ${"ΔCGPA".padStart(7)}`;
  const rows = progress.map((semester) => {
    const change = semester.cgpaChange === null
      ? "-"
      : `${semester.cgpaChange >= 0 ? "+" : ""}${semester.cgpaChange.toFixed(2)}`;
    return `${truncate(semester.label, 22).padEnd(22)} ${String(semester.units).padStart(5)} ${decimal(semester.sgpa).padStart(5)} ${decimal(semester.cgpa).padStart(5)} ${change.padStart(7)}`;
  });
  const peak = progress.filter((semester) => semester.cgpa !== null).reduce<SemesterProgress | null>(
    (best, semester) => !best || semester.cgpa! > best.cgpa! ? semester : best,
    null,
  );

  return [
    "<b>Semester Comparison</b>",
    `<pre>${escapeHtml([header, ...rows].join("\n"))}</pre>`,
    peak ? `CGPA ATH: <b>${peak.cgpa!.toFixed(2)}</b> after ${escapeHtml(peak.label)}` : "CGPA ATH: n/a",
    "<i>CGPA is cumulative quality points divided by cumulative GPA-counted units at the end of each semester.</i>",
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
    "<b>Elective Progress</b>",
    `Passed courses: ${summary.electives.passedCourses} · Passed units: ${summary.electives.passedUnits}`,
    `Failed courses: ${summary.electives.failedCourses} · Failed units: ${summary.electives.failedUnits}`,
    `Pending courses: ${summary.electives.pendingCourses} · Pending units: ${summary.electives.pendingUnits}`,
    "<i>Electives are tracked for graduation and excluded only from SGPA and CGPA.</i>",
  ].join("\n");
}

/** Each page is independently formatted so HTML tags are never split. */
export function semesterPages(key: string, courses: Course[], results: Results = { [key]: courses }): string[] {
  const pages: Course[][] = [];
  let page: Course[] = [];
  for (const course of courses) {
    if (page.length && formatSemester(key, [...page, course], results).length > 3500) {
      pages.push(page);
      page = [];
    }
    page.push(course);
  }
  if (page.length || !pages.length) pages.push(page);
  return pages.map((part, index) => formatSemester(key, part, results) +
    (pages.length > 1 ? `\nPage ${index + 1} / ${pages.length}` : ""));
}
