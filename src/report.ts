import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { analyzeResults } from "./analytics";
import { isElective, isGraded, semesterProgress, summarize, type SemesterProgress } from "./grades";
import type { Course, Results } from "./types";

const PAGE_WIDTH = PageSizes.A4[0];
const PAGE_HEIGHT = PageSizes.A4[1];
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INK = rgb(0.11, 0.12, 0.14);
const MUTED = rgb(0.38, 0.4, 0.44);
const LINE = rgb(0.84, 0.84, 0.82);
const PAPER = rgb(0.98, 0.975, 0.96);
const ACCENT = rgb(0.8, 0.2, 0.18);
const NAVY = rgb(0.12, 0.27, 0.38);
const GREEN = rgb(0.16, 0.48, 0.34);

interface ReportContext {
  document: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
}

function safeText(value: unknown): string {
  return String(value ?? "")
    .replace(/[·•]/g, "-")
    .replace(/[–—]/g, "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function shortened(value: string, limit: number): string {
  const text = safeText(value);
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3))}...` : text;
}

function fixed(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

function newPage(context: ReportContext, title?: string): void {
  context.page = context.document.addPage(PageSizes.A4);
  context.page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: PAPER });
  context.y = PAGE_HEIGHT - MARGIN;
  if (title) {
    context.page.drawText(safeText(title), { x: MARGIN, y: context.y - 16, size: 16, font: context.bold, color: INK });
    context.y -= 36;
  }
}

function ensureSpace(context: ReportContext, height: number, continuation?: string): void {
  if (context.y - height >= MARGIN + 20) return;
  newPage(context, continuation);
}

function drawRule(context: ReportContext, y = context.y): void {
  context.page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.7, color: LINE });
}

function drawMetric(context: ReportContext, x: number, width: number, label: string, value: string): void {
  context.page.drawRectangle({ x, y: context.y - 57, width, height: 57, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.7 });
  context.page.drawText(safeText(label).toUpperCase(), { x: x + 11, y: context.y - 18, size: 7, font: context.bold, color: MUTED });
  context.page.drawText(safeText(value), { x: x + 11, y: context.y - 43, size: 17, font: context.bold, color: INK });
}

function drawTrend(context: ReportContext, progress: SemesterProgress[]): void {
  ensureSpace(context, 192, "Academic trend");
  context.page.drawText("SGPA and cumulative CGPA", { x: MARGIN, y: context.y - 12, size: 11, font: context.bold, color: INK });
  const chartX = MARGIN + 28;
  const chartY = context.y - 164;
  const chartWidth = CONTENT_WIDTH - 36;
  const chartHeight = 128;
  for (let value = 0; value <= 5; value += 1) {
    const y = chartY + value / 5 * chartHeight;
    context.page.drawLine({ start: { x: chartX, y }, end: { x: chartX + chartWidth, y }, thickness: 0.5, color: LINE });
    context.page.drawText(String(value), { x: chartX - 17, y: y - 2, size: 6.5, font: context.regular, color: MUTED });
  }
  const plotted = progress.filter((semester) => semester.sgpa !== null || semester.cgpa !== null);
  const xAt = (index: number) => chartX + (plotted.length <= 1 ? chartWidth / 2 : index / (plotted.length - 1) * chartWidth);
  const drawSeries = (field: "sgpa" | "cgpa", color: ReturnType<typeof rgb>) => {
    let prior: { x: number; y: number } | null = null;
    plotted.forEach((semester, index) => {
      const value = semester[field];
      if (value === null) return;
      const point = { x: xAt(index), y: chartY + value / 5 * chartHeight };
      if (prior) context.page.drawLine({ start: prior, end: point, thickness: 1.8, color });
      context.page.drawCircle({ x: point.x, y: point.y, size: 2.6, color });
      prior = point;
    });
  };
  drawSeries("sgpa", ACCENT);
  drawSeries("cgpa", NAVY);
  plotted.forEach((semester, index) => {
    const label = semester.label.replace(" Semester", "").replace("1st", "S1").replace("2nd", "S2");
    context.page.drawText(shortened(label, 10), { x: xAt(index) - 17, y: chartY - 14, size: 5.5, font: context.regular, color: MUTED });
  });
  context.page.drawCircle({ x: PAGE_WIDTH - MARGIN - 120, y: context.y - 11, size: 2.6, color: ACCENT });
  context.page.drawText("SGPA", { x: PAGE_WIDTH - MARGIN - 113, y: context.y - 14, size: 7, font: context.regular, color: MUTED });
  context.page.drawCircle({ x: PAGE_WIDTH - MARGIN - 67, y: context.y - 11, size: 2.6, color: NAVY });
  context.page.drawText("CGPA", { x: PAGE_WIDTH - MARGIN - 60, y: context.y - 14, size: 7, font: context.regular, color: MUTED });
  context.y -= 190;
}

function drawComparisonHeader(context: ReportContext): void {
  const columns = [
    { text: "Semester", x: MARGIN, width: 150, align: "left" },
    { text: "Units", x: MARGIN + 160, width: 36, align: "right" },
    { text: "Points", x: MARGIN + 206, width: 46, align: "right" },
    { text: "SGPA", x: MARGIN + 262, width: 38, align: "right" },
    { text: "Cum units", x: MARGIN + 310, width: 52, align: "right" },
    { text: "Cum points", x: MARGIN + 372, width: 58, align: "right" },
    { text: "CGPA", x: MARGIN + 440, width: 38, align: "right" },
  ] as const;
  context.page.drawRectangle({ x: MARGIN, y: context.y - 20, width: CONTENT_WIDTH, height: 20, color: NAVY });
  for (const column of columns) {
    const width = context.bold.widthOfTextAtSize(column.text, 6.8);
    const x = column.align === "right" ? column.x + column.width - width : column.x + 4;
    context.page.drawText(column.text, { x, y: context.y - 13, size: 6.8, font: context.bold, color: rgb(1, 1, 1) });
  }
  context.y -= 20;
}

function drawComparison(context: ReportContext, progress: SemesterProgress[]): void {
  ensureSpace(context, 62, "Semester comparison");
  context.page.drawText("Semester comparison", { x: MARGIN, y: context.y - 13, size: 12, font: context.bold, color: INK });
  context.y -= 27;
  drawComparisonHeader(context);
  progress.forEach((semester, index) => {
    ensureSpace(context, 19, "Semester comparison continued");
    if (context.y > PAGE_HEIGHT - MARGIN - 50 && index > 0) drawComparisonHeader(context);
    if (index % 2 === 0) context.page.drawRectangle({ x: MARGIN, y: context.y - 18, width: CONTENT_WIDTH, height: 18, color: rgb(0.955, 0.95, 0.93) });
    const cells = [
      { value: shortened(semester.label, 28), x: MARGIN + 4, width: 146, align: "left" },
      { value: String(semester.units), x: MARGIN + 160, width: 36, align: "right" },
      { value: semester.points.toFixed(1), x: MARGIN + 206, width: 46, align: "right" },
      { value: fixed(semester.sgpa), x: MARGIN + 262, width: 38, align: "right" },
      { value: String(semester.cumulativeUnits), x: MARGIN + 310, width: 52, align: "right" },
      { value: semester.cumulativePoints.toFixed(1), x: MARGIN + 372, width: 58, align: "right" },
      { value: fixed(semester.cgpa), x: MARGIN + 440, width: 38, align: "right" },
    ];
    for (const cell of cells) {
      const width = context.regular.widthOfTextAtSize(cell.value, 7);
      const x = cell.align === "right" ? cell.x + cell.width - width : cell.x;
      context.page.drawText(cell.value, { x, y: context.y - 12, size: 7, font: context.regular, color: INK });
    }
    context.y -= 18;
  });
  context.y -= 10;
}

function drawCourseHeader(context: ReportContext): void {
  context.page.drawRectangle({ x: MARGIN, y: context.y - 21, width: CONTENT_WIDTH, height: 21, color: NAVY });
  const headers = [
    ["Code", MARGIN + 5], ["Course", MARGIN + 70], ["Unit", MARGIN + 345],
    ["Score", MARGIN + 386], ["Grade", MARGIN + 434], ["GPA", MARGIN + 476],
  ] as const;
  for (const [text, x] of headers) context.page.drawText(text, { x, y: context.y - 14, size: 7, font: context.bold, color: rgb(1, 1, 1) });
  context.y -= 21;
}

function drawCourseRow(context: ReportContext, course: Course, index: number): void {
  if (index % 2 === 0) context.page.drawRectangle({ x: MARGIN, y: context.y - 20, width: CONTENT_WIDTH, height: 20, color: rgb(0.955, 0.95, 0.93) });
  const counted = !isElective(course.code) && isGraded(course);
  const values = [
    [shortened(course.code, 11), MARGIN + 5],
    [shortened(course.title, 49), MARGIN + 70],
    [String(course.unit), MARGIN + 350],
    [course.score === null ? "-" : String(course.score), MARGIN + 390],
    [course.grade || "Pending", MARGIN + 438],
    [counted ? "Yes" : "No", MARGIN + 480],
  ] as const;
  for (const [text, x] of values) context.page.drawText(text, { x, y: context.y - 13, size: 7.2, font: context.regular, color: INK });
  context.y -= 20;
}

function drawSemester(context: ReportContext, semester: SemesterProgress, courses: Course[]): void {
  newPage(context, semester.label);
  context.page.drawText(`SGPA ${fixed(semester.sgpa)} / 5.00`, { x: MARGIN, y: context.y - 13, size: 10, font: context.bold, color: ACCENT });
  context.page.drawText(`CGPA after semester ${fixed(semester.cgpa)} / 5.00`, { x: MARGIN + 160, y: context.y - 13, size: 10, font: context.bold, color: NAVY });
  context.y -= 28;
  context.page.drawText(`${semester.points.toFixed(1)} semester quality points / ${semester.units} GPA units`, { x: MARGIN, y: context.y - 10, size: 8, font: context.regular, color: MUTED });
  context.page.drawText(`${semester.cumulativePoints.toFixed(1)} cumulative quality points / ${semester.cumulativeUnits} cumulative GPA units`, { x: MARGIN + 245, y: context.y - 10, size: 8, font: context.regular, color: MUTED });
  context.y -= 27;
  drawCourseHeader(context);
  courses.forEach((course, index) => {
    if (context.y - 20 < MARGIN + 28) {
      newPage(context, `${semester.label} continued`);
      drawCourseHeader(context);
    }
    drawCourseRow(context, course, index);
  });
  context.y -= 14;
  context.page.drawText("GPA = Yes means the course is included in the displayed SGPA and CGPA calculations.", { x: MARGIN, y: context.y, size: 7.4, font: context.regular, color: MUTED });
}

export async function generateAcademicReport(results: Results, generatedAt = new Date()): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle("IfeMate Academic Report");
  document.setAuthor("IfeMate");
  document.setSubject("OAU portal academic results and GPA history");
  document.setCreationDate(generatedAt);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const context = { document, regular, bold, page: document.addPage(PageSizes.A4), y: PAGE_HEIGHT - MARGIN };
  context.page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: PAPER });
  const summary = summarize(results);
  const analytics = analyzeResults(results);
  const progress = semesterProgress(results);
  const passRate = summary.unitsAttempted ? summary.unitsPassed / summary.unitsAttempted * 100 : 0;
  const peak = analytics.peakCgpa;

  context.page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 104, width: PAGE_WIDTH, height: 104, color: INK });
  context.page.drawText("IFEMATE", { x: MARGIN, y: PAGE_HEIGHT - 39, size: 9, font: bold, color: ACCENT });
  context.page.drawText("Academic Report", { x: MARGIN, y: PAGE_HEIGHT - 70, size: 25, font: bold, color: rgb(1, 1, 1) });
  context.page.drawText(`Generated ${safeText(generatedAt.toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }))}`, { x: MARGIN, y: PAGE_HEIGHT - 89, size: 8, font: regular, color: rgb(0.76, 0.77, 0.79) });
  context.y = PAGE_HEIGHT - 127;
  const gap = 8;
  const metricWidth = (CONTENT_WIDTH - gap * 3) / 4;
  drawMetric(context, MARGIN, metricWidth, "Current CGPA", `${fixed(summary.cgpa)} / 5.00`);
  drawMetric(context, MARGIN + (metricWidth + gap), metricWidth, "CGPA ATH", fixed(peak?.cgpa ?? null));
  drawMetric(context, MARGIN + (metricWidth + gap) * 2, metricWidth, "GPA units", String(summary.unitsAttempted));
  drawMetric(context, MARGIN + (metricWidth + gap) * 3, metricWidth, "Unit pass rate", `${passRate.toFixed(1)}%`);
  context.y -= 77;
  context.page.drawText("Grade distribution", { x: MARGIN, y: context.y - 10, size: 9, font: bold, color: INK });
  const gradeText = Object.entries(analytics.gradeDistribution).map(([grade, count]) => `${grade} ${count}`).join("     ");
  context.page.drawText(gradeText, { x: MARGIN + 104, y: context.y - 10, size: 9, font: regular, color: MUTED });
  context.y -= 27;
  context.page.drawText(peak ? `CGPA ATH reached after ${safeText(peak.label)}.` : "CGPA ATH is not available yet.", { x: MARGIN, y: context.y - 9, size: 8, font: regular, color: MUTED });
  context.y -= 23;
  drawTrend(context, progress);
  drawComparison(context, progress);
  ensureSpace(context, 45);
  drawRule(context);
  context.y -= 15;
  context.page.drawText("How to read this report", { x: MARGIN, y: context.y, size: 9, font: bold, color: INK });
  context.y -= 14;
  context.page.drawText("SGPA uses only one semester. CGPA uses every GPA-counted course through that semester. Values are calculated before rounding.", { x: MARGIN, y: context.y, size: 7.4, font: regular, color: MUTED });

  for (const semester of progress) drawSemester(context, semester, results[semester.key] ?? []);

  const pages = document.getPages();
  pages.forEach((page, index) => {
    page.drawLine({ start: { x: MARGIN, y: 29 }, end: { x: PAGE_WIDTH - MARGIN, y: 29 }, thickness: 0.6, color: LINE });
    page.drawText("Calculated from portal data. Elective codes whose numeric part starts with 0 are excluded from GPA.", { x: MARGIN, y: 16, size: 6.5, font: regular, color: MUTED });
    const number = `Page ${index + 1} of ${pages.length}`;
    page.drawText(number, { x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(number, 6.5), y: 16, size: 6.5, font: regular, color: MUTED });
  });

  return document.save();
}
