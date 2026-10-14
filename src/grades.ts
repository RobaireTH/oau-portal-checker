import type { Course, Results } from "./types";

const GRADE_POINTS: Record<string, number> = {
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
  F: 0,
};

/** Electives have a code whose numeric part starts with 0, e.g. LIB001. They are left out of GPA. */
export function isElective(code: string): boolean {
  const match = code.match(/\d+/);
  return match !== null && match[0].startsWith("0");
}

export interface Totals {
  units: number;
  points: number;
}

export function isGraded(course: Course): boolean {
  return Object.hasOwn(GRADE_POINTS, course.grade);
}

export function totalsFor(courses: Course[]): Totals {
  let units = 0;
  let points = 0;

  for (const course of courses) {
    if (isElective(course.code) || !isGraded(course)) continue;

    const gradePoints = GRADE_POINTS[course.grade];

    units += course.unit;
    points += gradePoints * course.unit;
  }

  return { units, points };
}

export function gpa(courses: Course[]): number | null {
  const { units, points } = totalsFor(courses);
  return units ? points / units : null;
}

export function summarize(results: Results) {
  const courses = Object.values(results)
    .flat()
    .filter((course) => !isElective(course.code));
  const totals = totalsFor(courses);

  return {
    cgpa: totals.units ? totals.points / totals.units : null,
    semesters: Object.keys(results).length,
    unitsAttempted: totals.units,
    unitsPassed: courses
      .filter((course) => isGraded(course) && course.grade !== "F")
      .reduce((sum, course) => sum + course.unit, 0),
    failed: courses.filter((course) => course.grade === "F").length,
    pending: courses.filter((course) => !isGraded(course)).length,
  };
}

/** Turns the portal's key into a readable label, e.g. "121" -> "100L · 1st Semester". */
export function semesterLabel(key: string): string {
  const match = key.match(/^12(\d+)$/);
  if (!match) return key;

  const index = Number(match[1]);
  const level = Math.ceil(index / 2) * 100;
  const term = index % 2 === 1 ? "1st" : "2nd";

  return `${level}L · ${term} Semester`;
}
