/**
 * #4514 — the Responses page's pure helpers: how an answer reads, the Summary
 * bars, the guest's name, and the answers CSV. No react-native, no supabase.
 */

import type {
  BrandFormExport,
  BrandFormResponseRow,
  BrandFormResponsesPage,
  BrandFormVersionDef,
} from "../services/brandFormsService";
import type { BrandFormDefinition, BrandFormQuestionDef } from "./brandFormDefinition";

/** The definition the Summary draws: the live version, else the newest. */
export function summaryDefinition(page: BrandFormResponsesPage): BrandFormDefinition | null {
  const live = page.form.liveVersionId !== null ? page.versions[page.form.liveVersionId] : undefined;
  if (live !== undefined) return live.definition;
  const all: BrandFormVersionDef[] = Object.values(page.versions);
  all.sort((a, b) => b.version - a.version);
  return all[0]?.definition ?? null;
}

/** How one stored answer reads: option ids become their labels. */
export function answerText(question: BrandFormQuestionDef, value: unknown): string {
  if (value === undefined || value === null) return "";
  const label = (id: string): string => question.options?.find((o) => o.id === id)?.label ?? id;
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string")
      .map(label)
      .join(", ");
  }
  if (typeof value === "string") {
    return question.type === "single_choice" || question.type === "multi_choice" ? label(value) : value;
  }
  if (typeof value === "number") return String(value);
  return "";
}

export interface SummaryBar {
  optionId: string;
  label: string;
  count: number;
  /** 0..1 of the biggest bar. */
  share: number;
}

export interface QuestionSummary {
  question: BrandFormQuestionDef;
  number: number;
  /** Choice questions: one bar per option. */
  bars: SummaryBar[];
  /** Choice questions: how many answers the bars add up to. */
  answeredTotal: number;
  /** Other questions: the latest few answers, with who gave them. */
  samples: Array<{ name: string; text: string }>;
  /** Other questions: answers among the loaded rows. */
  sampleCount: number;
  /** "Asked only after {Qn} is {option}" note, or null. */
  conditionNote: string | null;
}

export const subjectName = (row: BrandFormResponseRow): string => {
  const name = row.subject.name?.trim() ?? "";
  if (name.length > 0) return name;
  return row.subject.kind === "user" ? "Mingla guest" : "Guest";
};

export function summarize(
  definition: BrandFormDefinition,
  counts: BrandFormResponsesPage["counts"],
  rows: readonly BrandFormResponseRow[],
): QuestionSummary[] {
  const ordered = [...definition.questions].sort((a, b) => a.position - b.position);
  return ordered.map((question, index): QuestionSummary => {
    let conditionNote: string | null = null;
    if (question.show_if !== undefined && question.show_if !== null) {
      const sourceIndex = ordered.findIndex((q) => q.id === question.show_if?.question_id);
      const source = sourceIndex >= 0 ? ordered[sourceIndex] : undefined;
      const option = source?.options?.find((o) => o.id === question.show_if?.option_id);
      if (source !== undefined && option !== undefined) {
        conditionNote = `Asked only after Q${sourceIndex + 1} is ${option.label}`;
      }
    }
    if (question.type === "single_choice" || question.type === "multi_choice") {
      const byOption = counts[question.id] ?? {};
      const raw = (question.options ?? []).map((o) => ({
        optionId: o.id,
        label: o.label,
        count: byOption[o.id] ?? 0,
      }));
      const max = Math.max(1, ...raw.map((r) => r.count));
      return {
        question,
        number: index + 1,
        bars: raw.map((r) => ({ ...r, share: r.count / max })),
        answeredTotal: raw.reduce((sum, r) => sum + r.count, 0),
        samples: [],
        sampleCount: 0,
        conditionNote,
      };
    }
    const samples: Array<{ name: string; text: string }> = [];
    let sampleCount = 0;
    for (const row of rows) {
      const text = answerText(question, row.answers[question.id]).trim();
      if (text.length === 0) continue;
      sampleCount += 1;
      if (samples.length < 3) samples.push({ name: subjectName(row), text });
    }
    return {
      question,
      number: index + 1,
      bars: [],
      answeredTotal: 0,
      samples,
      sampleCount,
      conditionNote,
    };
  });
}

// ---------------------------------------------------------------------------
// Answers CSV
// ---------------------------------------------------------------------------

const csvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** A spreadsheet reads a leading = + - @ as a formula; keep it text. */
const safeCell = (value: string): string => (/^[=+\-@]/.test(value) ? `'${value}` : value);

/**
 * One header column per question and version, one row per response.
 * [TRANSITIONAL] The Name column comes from the Responses page rows; the
 * roster export (`brand-people-export`) does not take a form yet, so this is
 * the answers-only file. Exit: the roster export gains the form scope and
 * this serializer is deleted.
 */
export function buildAnswersCsv(
  feed: BrandFormExport,
  names: ReadonlyMap<string, string>,
): string {
  const header = [
    "Name",
    "Answered",
    "Updated",
    "Form version",
    "Verified",
    ...feed.columns.map((c) => `${c.label} (v${c.version})`),
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of feed.rows) {
    const cells = [
      names.get(row.responseId) ?? "",
      row.submittedAt,
      row.updatedAt,
      String(row.version),
      row.verified ? "Yes" : "No",
      ...feed.columns.map((c) => row.values[c.key] ?? ""),
    ];
    lines.push(cells.map((c) => csvCell(safeCell(c))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export const answersCsvFilename = (formName: string, now: Date): string => {
  const slug = formName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${slug.length > 0 ? slug : "form"}-answers-${y}-${m}-${d}.csv`;
};
