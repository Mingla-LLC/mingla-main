/**
 * #4514 — brand form rules every guest surface shares (pure, no React Native).
 *
 * The definition is `mingla.brand_form.v1` (BUILD CONTRACT v2 §3.2). Brand
 * answers store option IDS for choices and strings for everything else, as the
 * server validates them (`brand_form_check_answers`). The question renderers
 * draw option LABELS, so this module converts both ways.
 *
 * "Show only if": a question with `show_if` is visible only while its source (an
 * earlier single choice) has that option picked. A hidden question is never
 * required and its answer is dropped before anything is saved, exactly as the
 * server does. A door question carries "Shown to door staff" under its label.
 */

import { DEFAULT_FORM_RENDERING_COPY } from "./formCopy";
import type { FormAnswerValue, FormQuestion, FormRenderingCopy, FormSchema } from "./types";

export { ANSWERS_SEEN_LINE, SHOWN_TO_DOOR_STAFF } from "./formCopy";

export type BrandFormQuestionType =
  | "short_text"
  | "long_text"
  | "number"
  | "date"
  | "single_choice"
  | "multi_choice"
  | "file_upload";

export interface BrandFormOptionDef {
  id: string;
  label: string;
}

export interface BrandFormQuestionDef {
  id: string;
  position: number;
  type: BrandFormQuestionType;
  label: string;
  help?: string | null;
  required: boolean;
  options?: BrandFormOptionDef[];
  show_if?: { question_id: string; option_id: string } | null;
  show_at_door?: boolean;
  door_label?: string | null;
}

export interface BrandFormDefinitionShape {
  title?: string;
  intro?: string;
  questions: BrandFormQuestionDef[];
}

/** One stored answer: text, a number or date as text, an option id, or option ids. */
export type BrandAnswer = string | string[] | null;
export type BrandAnswers = Record<string, BrandAnswer>;

const isEmpty = (value: BrandAnswer | undefined): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return value.length === 0;
};

const byPosition = (def: BrandFormDefinitionShape): BrandFormQuestionDef[] =>
  [...def.questions].sort((a, b) => a.position - b.position);

/** Whether one question is visible given the answers so far (option ids). */
export function isQuestionVisible(
  def: BrandFormDefinitionShape,
  q: BrandFormQuestionDef,
  answers: BrandAnswers,
): boolean {
  const rule = q.show_if;
  if (rule === undefined || rule === null) return true;
  const source = def.questions.find((s) => s.id === rule.question_id);
  if (source === undefined || source.type !== "single_choice") return false;
  // The source must itself be visible (one level deep, so this ends at once).
  if (source.show_if !== undefined && source.show_if !== null && !isQuestionVisible(def, source, answers)) {
    return false;
  }
  return answers[source.id] === rule.option_id;
}

export const visibleQuestions = (
  def: BrandFormDefinitionShape,
  answers: BrandAnswers,
): BrandFormQuestionDef[] => byPosition(def).filter((q) => isQuestionVisible(def, q, answers));

/** Visible required questions still unanswered (ids, in order). */
export const missingRequiredIds = (def: BrandFormDefinitionShape, answers: BrandAnswers): string[] =>
  visibleQuestions(def, answers)
    .filter((q) => q.required && q.type !== "file_upload" && isEmpty(answers[q.id]))
    .map((q) => q.id);

export const missingRequired = (def: BrandFormDefinitionShape, answers: BrandAnswers): boolean =>
  missingRequiredIds(def, answers).length > 0;

/** The answers that still count: a hidden or empty question's answer is dropped. */
export function visibleAnswers(def: BrandFormDefinitionShape, answers: BrandAnswers): BrandAnswers {
  const out: BrandAnswers = {};
  for (const q of visibleQuestions(def, answers)) {
    const value = answers[q.id];
    if (value !== undefined && !isEmpty(value)) out[q.id] = value;
  }
  return out;
}

/** True when any question is marked for the door. */
export const hasDoorQuestions = (def: BrandFormDefinitionShape): boolean =>
  def.questions.some((q) => q.show_at_door === true);

type RulesCopy = Pick<FormRenderingCopy, "shownToDoorStaff" | "untitledQuestion">;

const toFormQuestion = (q: BrandFormQuestionDef, index: number, copy: RulesCopy): FormQuestion => {
  const lines: string[] = [];
  if (typeof q.help === "string" && q.help.trim().length > 0) lines.push(q.help.trim());
  // #4541 R6.3: the frame draws this line with the eye mark (matched on these words).
  if (q.show_at_door === true) lines.push(copy.shownToDoorStaff);
  const out: FormQuestion = {
    id: q.id,
    type: q.type,
    label: q.label.length > 0 ? q.label : copy.untitledQuestion,
    required: q.required,
    position: index,
  };
  if (lines.length > 0) out.helper = lines.join("\n");
  if (q.options !== undefined) out.options = q.options.map((o) => o.label);
  return out;
};

/**
 * The list the renderer draws for these answers (visible questions only).
 * `copy` is the injected words (#4541 R2.12); absent, the English defaults.
 */
export function rendererSchema(
  def: BrandFormDefinitionShape,
  answers: BrandAnswers,
  copy: RulesCopy = DEFAULT_FORM_RENDERING_COPY,
): FormSchema {
  return { questions: visibleQuestions(def, answers).map((q, i) => toFormQuestion(q, i, copy)) };
}

const labelOf = (q: BrandFormQuestionDef, id: string): string | null =>
  q.options?.find((o) => o.id === id)?.label ?? null;
const idOf = (q: BrandFormQuestionDef, label: string): string | null =>
  q.options?.find((o) => o.label === label)?.id ?? null;

/** Brand answers (option ids) → the renderer's values (option labels). */
export function toRendererAnswers(
  def: BrandFormDefinitionShape,
  answers: BrandAnswers,
): Record<string, FormAnswerValue> {
  const out: Record<string, FormAnswerValue> = {};
  for (const q of def.questions) {
    const value = answers[q.id];
    if (value === undefined || value === null) continue;
    if (q.type === "single_choice" && typeof value === "string") {
      const label = labelOf(q, value);
      if (label !== null) out[q.id] = label;
    } else if (q.type === "multi_choice" && Array.isArray(value)) {
      out[q.id] = value.map((id) => labelOf(q, id)).filter((l): l is string => l !== null);
    } else if (typeof value === "string") {
      out[q.id] = value;
    }
  }
  return out;
}

/** The renderer's values (labels) → brand answers (option ids); hidden answers dropped. */
export function fromRendererAnswers(
  def: BrandFormDefinitionShape,
  values: Record<string, FormAnswerValue>,
): BrandAnswers {
  const raw: BrandAnswers = {};
  for (const q of def.questions) {
    const value = values[q.id];
    if (value === undefined || value === null) continue;
    if (q.type === "single_choice" && typeof value === "string") {
      const id = idOf(q, value);
      if (id !== null) raw[q.id] = id;
    } else if (q.type === "multi_choice" && Array.isArray(value)) {
      raw[q.id] = value
        .filter((v): v is string => typeof v === "string")
        .map((label) => idOf(q, label))
        .filter((id): id is string => id !== null);
    } else if (typeof value === "string") {
      raw[q.id] = value;
    }
  }
  return visibleAnswers(def, raw);
}

/** Read-only display text for one answer ("Yes", "Red, Blue", the text itself). */
export function answerDisplayText(q: BrandFormQuestionDef, value: BrandAnswer | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (q.type === "single_choice" && typeof value === "string") return labelOf(q, value);
  if (q.type === "multi_choice" && Array.isArray(value)) {
    const labels = value.map((id) => labelOf(q, id)).filter((l): l is string => l !== null);
    return labels.length > 0 ? labels.join(", ") : null;
  }
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Brand header data (§5.1): read live from the brand, never stored on the form.
// ---------------------------------------------------------------------------

export interface BrandHeaderData {
  displayName: string;
  /** Logo URL; null draws the first letter of the name, in white, on the ring. */
  photo: string | null;
  /** Cover image URL (a video or GIF cover's poster); null draws the accent fill. */
  coverUrl: string | null;
  /** The brand's theme accent (#rrggbb) for the ring and the no-cover fill. */
  accent: string | null;
  /** Hue for the host's gradient cover fallback (0-359). */
  coverHue: number;
}

export const brandInitial = (name: string): string => {
  const t = name.trim();
  return t.length === 0 ? "•" : t.charAt(0).toUpperCase();
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A stable hue (0-359) from an accent hex, for the gradient fallback. */
export function hueFromAccent(accent: string | null | undefined, fallback = 25): number {
  if (typeof accent !== "string" || !HEX.test(accent)) return fallback;
  const r = parseInt(accent.slice(1, 3), 16) / 255;
  const g = parseInt(accent.slice(3, 5), 16) / 255;
  const b = parseInt(accent.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return fallback;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

/**
 * The header fields every server read returns (`brand_form_brand_header`):
 * cover media URL and type, photo, display name and theme accent. A video or
 * GIF cover has no poster in that payload, so it draws the accent fallback.
 */
export function brandHeaderFromServer(brand: {
  displayName?: unknown;
  photo?: unknown;
  coverMediaUrl?: unknown;
  coverMediaType?: unknown;
  accent?: unknown;
} | null | undefined): BrandHeaderData {
  const accent = typeof brand?.accent === "string" && HEX.test(brand.accent) ? brand.accent : null;
  const type = brand?.coverMediaType;
  const cover = typeof brand?.coverMediaUrl === "string" && brand.coverMediaUrl.length > 0 &&
      (type === undefined || type === null || type === "image")
    ? brand.coverMediaUrl
    : null;
  return {
    displayName: typeof brand?.displayName === "string" ? brand.displayName : "",
    photo: typeof brand?.photo === "string" && brand.photo.length > 0 ? brand.photo : null,
    coverUrl: cover,
    accent,
    coverHue: hueFromAccent(accent),
  };
}

