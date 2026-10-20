import {
  HANDBOOK,
  PROGRAMMES,
  type CurriculumCourse,
  type ProgrammeCurriculum,
  type ProgrammeId,
} from "./curriculum";
import { isElective, isGraded, totalsFor } from "./grades";
import type { Course, Results } from "./types";

export const DEGREE_CLASSES = [
  { id: "first-class", name: "First Class", minimum: 4.5 },
  { id: "second-class-upper", name: "Second Class Upper", minimum: 3.5 },
  { id: "second-class-lower", name: "Second Class Lower", minimum: 2.4 },
  { id: "third-class", name: "Third Class", minimum: 1.5 },
  { id: "pass", name: "Pass", minimum: 1 },
] as const;

export type DegreeClassId = typeof DEGREE_CLASSES[number]["id"];

export interface DegreeClass {
  id: DegreeClassId;
  name: string;
  minimum: number;
}

export interface RemainingCourse extends CurriculumCourse {
  kind: "required" | "choice" | "approved" | "reconciliation";
  repeat: boolean;
  choices?: CurriculumCourse[];
}

export interface DegreeTarget {
  id: DegreeClassId;
  name: string;
  minimum: number;
  attainable: boolean;
  requiredAverage: number | null;
  requiredPoints: number | null;
}

export interface PlannedCourse {
  course: RemainingCourse;
  expectedGrade: string;
  gradePoint: number;
}

export interface TermPlan {
  semester: string;
  order: number;
  units: number;
  expectedPoints: number;
  expectedGpa: number;
  cumulativeUnits: number;
  cumulativePoints: number;
  projectedCgpa: number;
  courses: PlannedCourse[];
}

export interface HonorsProjection {
  handbook: typeof HANDBOOK;
  programme: ProgrammeCurriculum;
  entryRoute: "standard" | "direct-entry";
  currentUnits: number;
  currentPoints: number;
  currentCgpa: number | null;
  currentClass: string;
  completedCurriculumUnits: number;
  curriculumGpaUnits: number;
  remainingUnits: number;
  remainingCourses: RemainingCourse[];
  carryovers: RemainingCourse[];
  blockedCourses: RemainingCourse[];
  specialElectivePassedUnits: number;
  maximumCgpa: number | null;
  highestAttainableClass: DegreeClass | null;
  selectedTarget: DegreeTarget;
  targetIntent: "attain" | "maintain";
  termPlans: TermPlan[];
}

function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function attempts(results: Results): Map<string, Course[]> {
  const grouped = new Map<string, Course[]>();
  for (const course of Object.values(results).flat()) {
    const code = normalizeCode(course.code);
    grouped.set(code, [...(grouped.get(code) ?? []), course]);
  }
  return grouped;
}

function passed(courses: Course[] | undefined): boolean {
  return courses?.some((course) => isGraded(course) && course.grade !== "F") ?? false;
}

function failed(courses: Course[] | undefined): boolean {
  return (courses?.some((course) => course.grade === "F") ?? false) && !passed(courses);
}

function passedUnits(courses: Course[]): number {
  const units = courses.filter((course) => isGraded(course) && course.grade !== "F").map((course) => course.unit);
  return units.length ? Math.max(...units) : 0;
}

function currentClass(cgpa: number | null): string {
  if (cgpa === null) return "Not available";
  return DEGREE_CLASSES.find((classification) => cgpa >= classification.minimum)?.name ?? "Below Pass";
}

function inferEntryRoute(grouped: Map<string, Course[]>, curriculum: ProgrammeCurriculum): "standard" | "direct-entry" {
  const hasFoundationAttempt = curriculum.requiredCourses.some((course) => course.foundation && grouped.has(course.code));
  const hasLaterAttempt = [...grouped.keys()].some((code) => {
    const match = code.match(/^[A-Z]+(\d{3})$/);
    return match !== null && Number(match[1][0]) >= 2;
  });
  return !hasFoundationAttempt && hasLaterAttempt ? "direct-entry" : "standard";
}

function choicePlaceholder(
  label: string,
  units: number,
  semester: string,
  order: number,
  options: CurriculumCourse[],
): RemainingCourse {
  return {
    code: "OPTION",
    title: label,
    unit: units,
    semester,
    order,
    prerequisites: [],
    kind: "choice",
    repeat: false,
    choices: options,
  };
}

function remainingCurriculum(results: Results, curriculum: ProgrammeCurriculum, entryRoute: "standard" | "direct-entry") {
  const grouped = attempts(results);
  const completedCodes = new Set([...grouped].filter(([, courses]) => passed(courses)).map(([code]) => code));
  if (entryRoute === "direct-entry") {
    for (const course of curriculum.requiredCourses.filter((candidate) => candidate.foundation)) completedCodes.add(course.code);
  }
  const remaining: RemainingCourse[] = [];

  for (const course of curriculum.requiredCourses) {
    if (entryRoute === "direct-entry" && course.foundation) continue;
    if (!completedCodes.has(course.code)) {
      remaining.push({ ...course, kind: "required", repeat: failed(grouped.get(course.code)) });
    }
  }

  for (const group of curriculum.choiceGroups) {
    const completedOptions = group.options.filter((course) => completedCodes.has(course.code));
    const completedChoiceUnits = Math.min(group.unit, completedOptions.reduce((sum, course) => sum + course.unit, 0));
    const outstandingUnits = group.unit - completedChoiceUnits;
    if (outstandingUnits > 0) {
      remaining.push(choicePlaceholder(
        group.label,
        outstandingUnits,
        group.semester,
        group.order,
        group.options.filter((course) => !completedCodes.has(course.code)),
      ));
    }
  }

  const curriculumCodes = new Set([
    ...curriculum.requiredCourses.map((course) => course.code),
    ...curriculum.choiceGroups.flatMap((group) => group.options.map((course) => course.code)),
  ]);
  const consumedCodes = new Set(curriculumCodes);
  for (const requirement of curriculum.additionalRequirements) {
    const matching = [...grouped.entries()].filter(([code, courses]) =>
      /^(?:MTH|STT)/.test(code) && !consumedCodes.has(code) && passed(courses)
    );
    const completedUnits = Math.min(requirement.unit, matching.reduce((sum, [, courses]) => sum + passedUnits(courses), 0));
    for (const [code] of matching) consumedCodes.add(code);
    if (completedUnits < requirement.unit) {
      remaining.push({ ...requirement, unit: requirement.unit - completedUnits, kind: "approved", repeat: false });
    }
  }

  const otherCompletedUnit = [...grouped.entries()]
    .filter(([code, courses]) => !consumedCodes.has(code) && passed(courses) && courses.some((course) => !isElective(course.code)))
    .reduce((sum, [, courses]) => sum + passedUnits(courses), 0);
  const reconciledUnit = Math.min(curriculum.reconciliationUnit, otherCompletedUnit);
  if (reconciledUnit < curriculum.reconciliationUnit) {
    remaining.push({
      code: "HANDBOOK-UNIT",
      title: "Handbook units requiring adviser confirmation",
      unit: curriculum.reconciliationUnit - reconciledUnit,
      semester: "By graduation",
      order: 14,
      prerequisites: [],
      kind: "reconciliation",
      repeat: false,
    });
  }

  const requiredGpaUnits = curriculum.gpaUnit - (entryRoute === "direct-entry" ? curriculum.directEntryFoundationExemptionUnit : 0);
  const remainingUnits = remaining.reduce((sum, course) => sum + course.unit, 0);

  return { completedCodes, requiredGpaUnits, remainingUnits, remaining };
}

function targetProjection(
  id: DegreeClassId,
  name: string,
  minimum: number,
  currentUnits: number,
  currentPoints: number,
  remainingUnits: number,
): DegreeTarget {
  const finalUnits = currentUnits + remainingUnits;
  if (finalUnits === 0) return { id, name, minimum, attainable: false, requiredAverage: null, requiredPoints: null };
  if (remainingUnits === 0) {
    const cgpa = currentPoints / currentUnits;
    return { id, name, minimum, attainable: cgpa >= minimum, requiredAverage: null, requiredPoints: null };
  }
  const targetPoints = Math.ceil(minimum * finalUnits - 1e-9);
  const requiredPoints = Math.max(remainingUnits, targetPoints - currentPoints);
  return {
    id,
    name,
    minimum,
    attainable: requiredPoints <= remainingUnits * 5,
    requiredAverage: requiredPoints / remainingUnits,
    requiredPoints,
  };
}

function termPlans(
  courses: RemainingCourse[],
  currentUnits: number,
  currentPoints: number,
): TermPlan[] {
  const grouped = new Map<string, RemainingCourse[]>();
  for (const course of courses) grouped.set(course.semester, [...(grouped.get(course.semester) ?? []), course]);
  let cumulativeUnits = currentUnits;
  let cumulativePoints = currentPoints;
  return [...grouped.entries()].map(([semester, termCourses]) => {
    const plannedCourses = termCourses.map((course) => ({ course, expectedGrade: "A", gradePoint: 5 }));
    const units = plannedCourses.reduce((sum, item) => sum + item.course.unit, 0);
    const expectedPoints = plannedCourses.reduce((sum, item) => sum + item.gradePoint * item.course.unit, 0);
    cumulativeUnits += units;
    cumulativePoints += expectedPoints;
    return {
      semester,
      order: Math.min(...termCourses.map((course) => course.order)),
      units,
      expectedPoints,
      expectedGpa: expectedPoints / units,
      cumulativeUnits,
      cumulativePoints,
      projectedCgpa: cumulativePoints / cumulativeUnits,
      courses: plannedCourses,
    };
  });
}

export function projectHonors(results: Results, programmeId: ProgrammeId, targetId: DegreeClassId): HonorsProjection {
  const curriculum = PROGRAMMES[programmeId];
  const allCourses = Object.values(results).flat();
  const totals = totalsFor(allCourses);
  const cgpa = totals.units ? totals.points / totals.units : null;
  const grouped = attempts(results);
  const entryRoute = inferEntryRoute(grouped, curriculum);
  const progress = remainingCurriculum(results, curriculum, entryRoute);
  const remainingCourses = progress.remaining.sort((left, right) => left.order - right.order || right.unit - left.unit || left.code.localeCompare(right.code));
  const remainingUnits = progress.remainingUnits;
  const maximumCgpa = totals.units + remainingUnits ? (totals.points + 5 * remainingUnits) / (totals.units + remainingUnits) : null;
  const highestAttainableClass = maximumCgpa === null
    ? null
    : DEGREE_CLASSES.find((candidate) => maximumCgpa >= candidate.minimum) ?? null;
  const classification = DEGREE_CLASSES.find((candidate) => candidate.id === targetId);
  if (!classification) throw new Error("Unknown degree target");
  const selectedTarget = targetProjection(
    classification.id,
    classification.name,
    classification.minimum,
    totals.units,
    totals.points,
    remainingUnits,
  );
  const carryovers = remainingCourses.filter((course) => course.repeat);
  const blockedCourses = remainingCourses.filter((course) =>
    course.prerequisites.some((prerequisite) => !progress.completedCodes.has(prerequisite))
  );
  const specialElectivePassedUnits = [...grouped.values()]
    .filter((courses) => courses.some((course) => isElective(course.code)))
    .reduce((sum, courses) => sum + passedUnits(courses), 0);
  return {
    handbook: HANDBOOK,
    programme: curriculum,
    entryRoute,
    currentUnits: totals.units,
    currentPoints: totals.points,
    currentCgpa: cgpa,
    currentClass: currentClass(cgpa),
    completedCurriculumUnits: progress.requiredGpaUnits - remainingUnits,
    curriculumGpaUnits: progress.requiredGpaUnits,
    remainingUnits,
    remainingCourses,
    carryovers,
    blockedCourses,
    specialElectivePassedUnits,
    maximumCgpa,
    highestAttainableClass,
    selectedTarget,
    targetIntent: cgpa !== null && cgpa >= selectedTarget.minimum ? "maintain" : "attain",
    termPlans: termPlans(remainingCourses, totals.units, totals.points),
  };
}
