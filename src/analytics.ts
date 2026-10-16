import { escapeHtml } from "./format";
import { isElective, isGraded, semesterProgress, summarize } from "./grades";
import type { Course, Results } from "./types";

const GRADES = ["A", "B", "C", "D", "E", "F"] as const;

export interface TrendPoint {
  key: string;
  label: string;
  sgpa: number | null;
  cgpa: number | null;
  units: number;
}

interface CourseScore {
  code: string;
  score: number;
}

export interface AcademicAnalytics {
  trend: TrendPoint[];
  currentCgpa: number | null;
  peakCgpa: TrendPoint | null;
  highestSgpa: TrendPoint | null;
  lowestSgpa: TrendPoint | null;
  latestChange: number | null;
  averageScore: number | null;
  highestScore: CourseScore | null;
  lowestScore: CourseScore | null;
  unitsAttempted: number;
  unitsPassed: number;
  gradeDistribution: Record<(typeof GRADES)[number], number>;
}

function extreme(points: TrendPoint[], field: "sgpa" | "cgpa", direction: "highest" | "lowest"): TrendPoint | null {
  const available = points.filter((point) => point[field] !== null);
  if (!available.length) return null;
  return available.reduce((selected, point) => {
    const selectedValue = selected[field]!;
    const pointValue = point[field]!;
    return direction === "highest"
      ? pointValue > selectedValue ? point : selected
      : pointValue < selectedValue ? point : selected;
  });
}

function courseExtreme(courses: Course[], direction: "highest" | "lowest"): CourseScore | null {
  const scored = courses.filter((course) => course.score !== null);
  if (!scored.length) return null;
  const selected = scored.reduce((current, course) => direction === "highest"
    ? course.score! > current.score! ? course : current
    : course.score! < current.score! ? course : current);
  return { code: selected.code, score: selected.score! };
}

export function analyzeResults(results: Results): AcademicAnalytics {
  const trend = semesterProgress(results).map(({ key, label, sgpa, cgpa, units }) => ({
    key, label, sgpa, cgpa, units,
  }));
  const countedCourses = Object.values(results).flat().filter((course) => !isElective(course.code));
  const scoredCourses = countedCourses.filter((course) => course.score !== null && isGraded(course));
  const gradeDistribution = Object.fromEntries(GRADES.map((grade) => [grade, 0])) as AcademicAnalytics["gradeDistribution"];
  for (const course of countedCourses) {
    if (isGraded(course)) gradeDistribution[course.grade as keyof typeof gradeDistribution] += 1;
  }
  const gradedTrend = trend.filter((point) => point.sgpa !== null);
  const latest = gradedTrend.at(-1);
  const previous = gradedTrend.at(-2);
  const summary = summarize(results);

  return {
    trend,
    currentCgpa: summary.cgpa,
    peakCgpa: extreme(trend, "cgpa", "highest"),
    highestSgpa: extreme(trend, "sgpa", "highest"),
    lowestSgpa: extreme(trend, "sgpa", "lowest"),
    latestChange: latest && previous ? latest.sgpa! - previous.sgpa! : null,
    averageScore: scoredCourses.length
      ? scoredCourses.reduce((total, course) => total + course.score!, 0) / scoredCourses.length
      : null,
    highestScore: courseExtreme(scoredCourses, "highest"),
    lowestScore: courseExtreme(scoredCourses, "lowest"),
    unitsAttempted: summary.unitsAttempted,
    unitsPassed: summary.unitsPassed,
    gradeDistribution,
  };
}

function metric(point: TrendPoint | null, field: "sgpa" | "cgpa"): string {
  if (!point || point[field] === null) return "n/a";
  return `${point[field]!.toFixed(2)} · ${escapeHtml(point.label.slice(0, 40))}`;
}

function gradeTable(distribution: AcademicAnalytics["gradeDistribution"]): string {
  const total = GRADES.reduce((sum, grade) => sum + distribution[grade], 0);
  return [
    "Grade Count   Share  Distribution",
    ...GRADES.map((grade) => {
      const count = distribution[grade];
      const share = total ? count / total * 100 : 0;
      const width = count ? Math.max(1, Math.round(share / 100 * 12)) : 0;
      const bar = "#".repeat(width).padEnd(12);
      return `${grade.padEnd(5)} ${String(count).padStart(5)} ${`${share.toFixed(1)}%`.padStart(7)}  ${bar}`;
    }),
  ].join("\n");
}

export function formatAnalytics(analytics: AcademicAnalytics): string {
  const passRate = analytics.unitsAttempted
    ? analytics.unitsPassed / analytics.unitsAttempted * 100
    : null;
  const movement = analytics.latestChange === null
    ? "n/a"
    : `${analytics.latestChange >= 0 ? "+" : ""}${analytics.latestChange.toFixed(2)} vs previous semester`;

  return [
    "<b>Academic Analytics</b>",
    `Current CGPA: <b>${analytics.currentCgpa === null ? "n/a" : analytics.currentCgpa.toFixed(2)}</b> / 5.00`,
    `CGPA ATH: <b>${metric(analytics.peakCgpa, "cgpa")}</b>`,
    "<i>CGPA ATH is the highest cumulative CGPA reached at a semester end.</i>",
    `SGPA ATH: <b>${metric(analytics.highestSgpa, "sgpa")}</b>`,
    `Lowest SGPA: ${metric(analytics.lowestSgpa, "sgpa")}`,
    `Latest movement: ${movement}`,
    `Average score: ${analytics.averageScore === null ? "n/a" : `${analytics.averageScore.toFixed(1)}%`}`,
    `Highest score: ${analytics.highestScore ? `${escapeHtml(analytics.highestScore.code.slice(0, 20))} · ${analytics.highestScore.score}%` : "n/a"}`,
    `Lowest score: ${analytics.lowestScore ? `${escapeHtml(analytics.lowestScore.code.slice(0, 20))} · ${analytics.lowestScore.score}%` : "n/a"}`,
    `Units passed: ${analytics.unitsPassed} / ${analytics.unitsAttempted}${passRate === null ? "" : ` · ${passRate.toFixed(1)}%`}`,
    "<b>Grade distribution</b>",
    `<pre>${gradeTable(analytics.gradeDistribution).trimEnd()}</pre>`,
    "<i>Electives and pending grades are excluded from GPA metrics.</i>",
  ].join("\n");
}

function chartLabel(label: string): string {
  return label
    .replace(" · 1st Semester", " S1")
    .replace(" · 2nd Semester", " S2")
    .slice(0, 18);
}

export function analyticsChartRequest(analytics: AcademicAnalytics) {
  return {
    version: "4",
    format: "png",
    width: 900,
    height: 520,
    devicePixelRatio: 1,
    backgroundColor: "#F8F7F4",
    chart: {
      type: "line",
      data: {
        labels: analytics.trend.map((point) => chartLabel(point.label)),
        datasets: [
          {
            label: "Semester GPA",
            data: analytics.trend.map((point) => point.sgpa === null ? null : Number(point.sgpa.toFixed(2))),
            borderColor: "#D6544D",
            backgroundColor: "#D6544D",
            borderWidth: 3,
            pointRadius: 5,
            pointHoverRadius: 6,
            tension: 0.28,
            spanGaps: true,
          },
          {
            label: "Cumulative GPA",
            data: analytics.trend.map((point) => point.cgpa === null ? null : Number(point.cgpa.toFixed(2))),
            borderColor: "#167D77",
            backgroundColor: "#167D77",
            borderWidth: 3,
            pointRadius: 5,
            pointHoverRadius: 6,
            tension: 0.28,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: false,
        layout: { padding: 24 },
        plugins: {
          title: {
            display: true,
            text: "Academic performance trend",
            color: "#17212B",
            font: { size: 22, weight: "bold" },
            padding: { bottom: 18 },
          },
          subtitle: {
            display: true,
            text: "Semester GPA vs cumulative GPA · electives excluded",
            color: "#66717C",
            font: { size: 13 },
            padding: { bottom: 20 },
          },
          legend: {
            position: "bottom",
            labels: { color: "#2D3741", usePointStyle: true, padding: 24 },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#52606B", maxRotation: 0, minRotation: 0, font: { size: 12 } },
            border: { color: "#B8C0C8" },
          },
          y: {
            min: 0,
            max: 5,
            ticks: { color: "#52606B", stepSize: 1 },
            grid: { color: "#DDE1E5" },
            border: { display: false },
          },
        },
      },
    },
  };
}

export async function renderAnalyticsChart(analytics: AcademicAnalytics, request: typeof fetch = fetch): Promise<Uint8Array> {
  const response = await request("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(analyticsChartRequest(analytics)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/png")) {
    throw new Error(`Chart rendering failed (status ${response.status})`);
  }
  const image = new Uint8Array(await response.arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (image.length < signature.length || image.length > 5_000_000 || signature.some((byte, index) => image[index] !== byte)) {
    throw new Error("Chart renderer returned an invalid image");
  }
  return image;
}
