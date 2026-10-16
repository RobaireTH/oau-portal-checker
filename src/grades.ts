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

export interface ElectiveProgress {
  totalCourses: number;
  passedCourses: number;
  passedUnits: number;
  failedCourses: number;
  failedUnits: number;
  pendingCourses: number;
  pendingUnits: number;
}

export interface SemesterProgress {
  key: string;
  label: string;
  units: number;
  points: number;
  cumulativeUnits: number;
  cumulativePoints: number;
  sgpa: number | null;
  cgpa: number | null;
  sgpaChange: number | null;
  cgpaChange: number | null;
}

export function isGraded(course: Course): boolean {
  return Object.hasOwn(GRADE_POINTS, course.grade);
}

export function electiveProgress(courses: Course[]): ElectiveProgress {
  const electives = courses.filter((course) => isElective(course.code));
  const passed = electives.filter((course) => isGraded(course) && course.grade !== "F");
  const failed = electives.filter((course) => course.grade === "F");
  const pending = electives.filter((course) => !isGraded(course));
  return {
    totalCourses: electives.length,
    passedCourses: passed.length,
    passedUnits: passed.reduce((sum, course) => sum + course.unit, 0),
    failedCourses: failed.length,
    failedUnits: failed.reduce((sum, course) => sum + course.unit, 0),
    pendingCourses: pending.length,
    pendingUnits: pending.reduce((sum, course) => sum + course.unit, 0),
  };
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

export function semesterKeys(results: Results): string[] {
  return Object.keys(results).sort((left, right) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : left.localeCompare(right, undefined, { numeric: true });
  });
}

export function semesterProgress(results: Results): SemesterProgress[] {
  let cumulativeUnits = 0;
  let cumulativePoints = 0;
  let previousSgpa: number | null = null;
  let previousCgpa: number | null = null;

  return semesterKeys(results).map((key) => {
    const totals = totalsFor(results[key]);
    cumulativeUnits += totals.units;
    cumulativePoints += totals.points;
    const sgpa = totals.units ? totals.points / totals.units : null;
    const cgpa = cumulativeUnits ? cumulativePoints / cumulativeUnits : null;
    const point = {
      key,
      label: semesterLabel(key),
      units: totals.units,
      points: totals.points,
      cumulativeUnits,
      cumulativePoints,
      sgpa,
      cgpa,
      sgpaChange: sgpa === null || previousSgpa === null ? null : sgpa - previousSgpa,
      cgpaChange: cgpa === null || previousCgpa === null ? null : cgpa - previousCgpa,
    };
    if (sgpa !== null) previousSgpa = sgpa;
    if (cgpa !== null) previousCgpa = cgpa;
    return point;
  });
}

export function summarize(results: Results) {
  const allCourses = Object.values(results).flat();
  const courses = allCourses.filter((course) => !isElective(course.code));
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
    electives: electiveProgress(allCourses),
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
