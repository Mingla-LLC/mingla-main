/**
 * #4514 — the Responses page's pure helpers: how an answer reads, the Summary
 * bars and the guest's name. No react-native, no supabase. (The answers file is
 * the guest roster export since wave 3.)
 */

import type {
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
  // #4541 R4.7: an Unknown Blast reply is "Unknown"; a Blast recipient keeps the name at send.
  if (row.ownerKind === "unknown") return "Unknown";
  if (row.ownerKind === "blast" && row.ownerName !== null && row.ownerName.trim().length > 0) return row.ownerName.trim();
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

