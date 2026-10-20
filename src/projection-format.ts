import { escapeHtml } from "./format";
import { DEGREE_CLASSES, type HonorsProjection, type PlannedCourse, type RemainingCourse, type TermPlan } from "./projection";

function decimal(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

function entryRoute(value: HonorsProjection["entryRoute"]): string {
  return value === "direct-entry" ? "Direct entry, inferred from portal history" : "Standard entry";
}

function compactCourse(course: RemainingCourse): string {
  if (course.kind === "choice") {
    const choices = course.choices?.map((option) => `${option.code} ${option.title}`).join(" / ") ?? "published options";
    return `${course.title}: choose ${course.unit}u from ${choices}`;
  }
  if (course.kind === "approved") return `${course.title} (${course.unit}u; exact courses require approval)`;
  if (course.kind === "reconciliation") return `${course.unit} handbook unit${course.unit === 1 ? "" : "s"} requiring adviser confirmation`;
  return `${course.code} ${course.title} (${course.unit}u)${course.repeat ? " · carryover" : ""}`;
}

function guidance(projection: HonorsProjection): string {
  const highest = projection.highestAttainableClass;
  const target = projection.selectedTarget;
  if (!highest) return `Even an A in every remaining course leaves the maximum CGPA at ${decimal(projection.maximumCgpa)}, below the Pass threshold.`;
  if (!target.attainable) {
    return `${target.name} is above the current mathematical ceiling. The term plan therefore follows the strongest recovery path toward ${highest.name} and ${decimal(projection.maximumCgpa)} CGPA.`;
  }
  if (target.id !== highest.id) {
    return `${target.name} is only a safety floor. Do not plan downward: ${highest.name} is still attainable, so the term plan aims for the maximum ${decimal(projection.maximumCgpa)} CGPA.`;
  }
  if (projection.targetIntent === "maintain") {
    return `You already meet this floor. The term plan does not recommend coasting; it aims to improve your result toward the maximum ${decimal(projection.maximumCgpa)} CGPA.`;
  }
  return `${highest.name} is the highest honours class still attainable. The term plan aims for the maximum ${decimal(projection.maximumCgpa)} CGPA.`;
}

function higherMilestones(projection: HonorsProjection): string | null {
  if (projection.maximumCgpa === null) return null;
  const milestones = DEGREE_CLASSES
    .filter((candidate) => candidate.minimum > projection.selectedTarget.minimum && projection.maximumCgpa! >= candidate.minimum)
    .reverse();
  return milestones.length
    ? milestones.map((candidate) => `${candidate.name} (${candidate.minimum.toFixed(2)})`).join(" → ")
    : null;
}

function overviewPage(projection: HonorsProjection): string {
  const target = projection.selectedTarget;
  const highest = projection.highestAttainableClass;
  const lines = [
    "<b>Honours Projection</b>",
    `<b>Programme:</b> ${escapeHtml(projection.programme.name)}`,
    `<b>Selected safety floor:</b> ${escapeHtml(target.name)} (${target.minimum.toFixed(2)})`,
    `<b>Current:</b> ${decimal(projection.currentCgpa)} CGPA · ${projection.currentClass} · ${projection.currentUnits} GPA units`,
    `<b>Entry route:</b> ${entryRoute(projection.entryRoute)}`,
    `<b>Remaining:</b> ${projection.remainingUnits} GPA units across ${projection.termPlans.length} handbook term${projection.termPlans.length === 1 ? "" : "s"}`,
    "",
    `<b>Highest attainable:</b> ${highest ? `${escapeHtml(highest.name)} · ` : "Below Pass · "}${decimal(projection.maximumCgpa)} CGPA`,
    `<b>Recommendation:</b> Aim for A in every remaining course.`,
  ];
  if (target.requiredAverage !== null && target.attainable) {
    lines.push(`<b>Floor check:</b> Mathematically attainable at a ${target.requiredAverage.toFixed(2)} remaining average. This is a boundary, not the recommended course target.`);
  } else if (target.requiredAverage !== null) {
    const shortfall = Math.max(0, target.minimum - (projection.maximumCgpa ?? 0));
    lines.push(`<b>Floor check:</b> ${escapeHtml(target.name)} is not attainable within the 5.00 scale. Straight As in all remaining courses produce at most ${decimal(projection.maximumCgpa)}, which is ${shortfall.toFixed(2)} below the ${target.minimum.toFixed(2)} floor.`);
  } else {
    lines.push(`<b>Floor check:</b> ${target.attainable ? "Secured by the recorded final result" : "Not reached by the recorded final result"}.`);
  }
  lines.push("", `<b>Advice:</b> ${escapeHtml(guidance(projection))}`);
  const milestones = higherMilestones(projection);
  if (milestones) lines.push(`<b>Higher milestones:</b> ${escapeHtml(milestones)}`);
  lines.push(
    "",
    `<i>Portal grades determine the starting point. Future terms and courses come from the ${escapeHtml(projection.handbook.edition)} departmental handbook.</i>`,
  );
  return lines.join("\n");
}

function tableLabel(course: RemainingCourse): string {
  if (course.kind === "reconciliation") return "Adviser-confirmed handbook unit";
  if (course.kind === "approved" || course.kind === "choice") return course.title;
  return `${course.code} ${course.title}`;
}

function fit(value: string, width: number): string {
  return value.length <= width ? value.padEnd(width) : `${value.slice(0, width - 3)}...`;
}

function courseTable(courses: PlannedCourse[]): string {
  const width = 44;
  const rows = [
    `${fit("Course / requirement", width)} ${"Units".padStart(5)}  ${"Aim".padStart(5)}`,
    `${"-".repeat(width)} -----  -----`,
    ...courses.map((item) => `${fit(tableLabel(item.course), width)} ${String(item.course.unit).padStart(5)}  ${item.expectedGrade.padStart(5)}`),
  ];
  return `<pre>${escapeHtml(rows.join("\n"))}</pre>`;
}

function termPage(term: TermPlan, index: number, total: number): string {
  const title = term.semester === "By graduation"
    ? "Graduation requirements"
    : `Term ${index + 1} of ${total} · ${term.semester}`;
  const details = term.courses.flatMap((item) => {
    if (item.course.kind === "choice") {
      const choices = item.course.choices?.map((choice) => `${choice.code} ${choice.title}`).join(" / ") ?? "published options";
      return [`<b>Options:</b> ${escapeHtml(choices)}`];
    }
    if (item.course.kind === "approved") return [`<b>Approval:</b> ${escapeHtml(compactCourse(item.course))}`];
    return [];
  });
  const carryovers = term.courses.filter((item) => item.course.repeat).map((item) => item.course.code);
  const lines = [
    `<b>${escapeHtml(title)}</b>`,
    `<b>Recommended term GPA:</b> ${term.expectedGpa.toFixed(2)} · ${term.units} units`,
    "",
    courseTable(term.courses),
  ];
  if (carryovers.length) lines.push(`<b>Carryover:</b> ${escapeHtml(carryovers.join(", "))}`);
  if (details.length) lines.push("", ...details);
  lines.push(
    "",
    `<b>Highest-attainable checkpoint:</b> ${term.projectedCgpa.toFixed(2)} projected CGPA after ${term.cumulativeUnits} GPA units`,
  );
  return lines.join("\n");
}

function boundariesPage(projection: HonorsProjection): string {
  const reconciliationUnits = projection.remainingCourses
    .filter((course) => course.kind === "reconciliation")
    .reduce((sum, course) => sum + course.unit, 0);
  const lines = [
    "<b>Plan Boundaries</b>",
    `Special electives passed: ${projection.specialElectivePassedUnits}/${projection.programme.specialElectiveUnit} units. They are required for graduation but excluded from CGPA.`,
  ];
  if (projection.carryovers.length) lines.push(`${projection.carryovers.length} carryover course${projection.carryovers.length === 1 ? " is" : "s are"} marked in the term plan and must be cleared.`);
  if (projection.blockedCourses.length) {
    lines.push("", "<b>Prerequisites to clear first</b>");
    for (const course of projection.blockedCourses) lines.push(`• ${escapeHtml(course.code)} requires ${escapeHtml(course.prerequisites.join(", "))}`);
  }
  if (reconciliationUnits) lines.push("", `${reconciliationUnits} GPA unit${reconciliationUnits === 1 ? " is" : "s are"} present in the published graduation total but not named consistently in the handbook tables. Confirm the applicable course with your academic adviser.`);
  lines.push(
    "",
    "<i>This is a projected grade plan, not registration advice. Aim to do well in every registered course regardless of the selected safety floor, and confirm registrations with your academic adviser.</i>",
  );
  return lines.join("\n");
}

export function formatProjectionPages(projection: HonorsProjection): string[] {
  const terms = projection.termPlans.map((term, index) => termPage(term, index, projection.termPlans.length));
  return [overviewPage(projection), ...terms, boundariesPage(projection)];
}
