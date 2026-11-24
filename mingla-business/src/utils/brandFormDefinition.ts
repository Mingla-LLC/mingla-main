/**
 * #4514 — the brand form definition (`mingla.brand_form.v1`) and the one place
 * the host builder's question list (the trip intake shape, extended in place)
 * is turned into it and back.
 *
 * Pure: no supabase, no react-native, no expo. The server validators
 * (`brand_form_definition_errors`) are the authority; the rules below mirror
 * them so the builder can say what is wrong before a save is refused:
 *   - at most 20 questions;
 *   - "Show only if" points only at an EARLIER single-choice question, one
 *     level deep, at one of its options;
 *   - "Show at the door" only on short text, number, date and the two choices,
 *     at most 3 per form, with an optional 16-character door label.
 */

import type {
  IntakeQuestion,
  IntakeQuestionType,
  IntakeSchema,
} from "../services/intakeSchemaService";

export const BRAND_FORM_SCHEMA = "mingla.brand_form.v1" as const;

export const BRAND_FORM_MAX_QUESTIONS = 20;
export const BRAND_FORM_MAX_DOOR_QUESTIONS = 3;
export const BRAND_FORM_DOOR_LABEL_MAX = 16;
export const BRAND_FORM_HELP_MAX = 300;
export const BRAND_FORM_LABEL_MAX = 200;
export const BRAND_FORM_OPTION_MAX = 80;
export const BRAND_FORM_NAME_MIN = 2;
export const BRAND_FORM_NAME_MAX = 80;

export interface BrandFormOptionDef {
  id: string;
  label: string;
}

export interface BrandFormShowIf {
  question_id: string;
  option_id: string;
}

export interface BrandFormQuestionDef {
  id: string;
  position: number;
  type: IntakeQuestionType;
  label: string;
  help?: string | null;
  required: boolean;
  options?: BrandFormOptionDef[];
  show_if?: BrandFormShowIf | null;
  show_at_door?: boolean;
  door_label?: string | null;
}

export interface BrandFormDefinition {
  schema: typeof BRAND_FORM_SCHEMA;
  title: string;
  intro?: string;
  questions: BrandFormQuestionDef[];
}

/** The types a host may mark "Show at the door" (long text and files are too long). */
export const DOOR_QUESTION_TYPES: readonly IntakeQuestionType[] = [
  "short_text",
  "number",
  "date",
  "single_choice",
  "multi_choice",
];

export const isDoorType = (type: IntakeQuestionType): boolean =>
  DOOR_QUESTION_TYPES.includes(type);

export const isChoiceType = (type: IntakeQuestionType): boolean =>
  type === "single_choice" || type === "multi_choice";

export const emptyBrandFormDefinition = (title: string): BrandFormDefinition => ({
  schema: BRAND_FORM_SCHEMA,
  title,
  questions: [],
});

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const OPTION_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A short option id that satisfies the server's `^[A-Za-z0-9_-]{1,64}$`. */
export const newOptionId = (): string => {
  let out = "o";
  for (let i = 0; i < 8; i += 1) {
    out += OPTION_ID_ALPHABET.charAt(Math.floor(Math.random() * OPTION_ID_ALPHABET.length));
  }
  return out;
};

// ---------------------------------------------------------------------------
// Definition <-> builder schema
// ---------------------------------------------------------------------------

const newSchemaVersionId = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

const trimOrUndefined = (value: string | null | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length === 0 ? undefined : t;
};

/** The builder's question list for a saved definition. */
export function definitionToSchema(def: BrandFormDefinition): IntakeSchema {
  const questions = [...def.questions]
    .sort((a, b) => a.position - b.position)
    .map((q, index): IntakeQuestion => {
      const out: IntakeQuestion = {
        id: q.id,
        type: q.type,
        label: q.label,
        required: q.required,
        position: index,
      };
      const help = trimOrUndefined(q.help);
      if (help !== undefined) out.helper = help;
      if (q.options !== undefined) {
        out.options = q.options.map((o) => o.label);
        out.option_ids = q.options.map((o) => o.id);
      }
      if (q.show_if !== undefined && q.show_if !== null) out.show_if = { ...q.show_if };
      if (q.show_at_door === true) out.show_at_door = true;
      const doorLabel = trimOrUndefined(q.door_label);
      if (doorLabel !== undefined) out.door_label = doorLabel;
      return out;
    });
  return { schema_version_id: newSchemaVersionId(), questions };
}

/** The definition the server stores for the builder's question list. */
export function schemaToDefinition(
  schema: IntakeSchema | null,
  base: { title: string; intro?: string },
): BrandFormDefinition {
  const questions = (schema?.questions ?? []).map((q, index): BrandFormQuestionDef => {
    const out: BrandFormQuestionDef = {
      id: q.id,
      position: index,
      type: q.type,
      label: q.label,
      required: q.required,
    };
    const help = trimOrUndefined(q.helper);
    if (help !== undefined) out.help = help;
    if (isChoiceType(q.type)) {
      const ids = q.option_ids ?? [];
      // A question seeded without ids (never in the builder, which gives each
      // option one) gets a position-based id, so the same input always gives
      // the same definition and "unsaved changes" stays stable.
      out.options = (q.options ?? []).map((label, i) => ({
        id: ids[i] ?? `o${i + 1}`,
        label,
      }));
    }
    if (q.show_if !== undefined) out.show_if = { ...q.show_if };
    if (q.show_at_door === true && isDoorType(q.type)) {
      out.show_at_door = true;
      const doorLabel = trimOrUndefined(q.door_label);
      if (doorLabel !== undefined) out.door_label = doorLabel;
    }
    return out;
  });
  const def: BrandFormDefinition = {
    schema: BRAND_FORM_SCHEMA,
    title: base.title,
    questions,
  };
  if (base.intro !== undefined && base.intro.length > 0) def.intro = base.intro;
  return def;
}

// ---------------------------------------------------------------------------
// Door questions
// ---------------------------------------------------------------------------

export const doorQuestionCount = (
  questions: readonly IntakeQuestion[],
  exceptId?: string,
): number =>
  questions.filter(
    (q) => q.id !== exceptId && q.show_at_door === true && isDoorType(q.type),
  ).length;

export interface DoorToggleState {
  /** Whether the switch can be turned on for this question. */
  canTurnOn: boolean;
  /** The line under the switch, exactly as designed. */
  line: string;
  /** "{n} of 3 door questions". */
  countLine: string;
}

/** The door switch for one question given the other questions on the form. */
export function doorToggleState(
  question: Pick<IntakeQuestion, "type" | "show_at_door">,
  otherDoorCount: number,
  typeLabel: string,
): DoorToggleState {
  const on = question.show_at_door === true && isDoorType(question.type);
  const total = otherDoorCount + (on ? 1 : 0);
  const countLine = `${total} of ${BRAND_FORM_MAX_DOOR_QUESTIONS} door questions`;
  if (!isDoorType(question.type)) {
    return {
      canTurnOn: false,
      line: `${typeLabel} answers are too long to show at the door.`,
      countLine,
    };
  }
  if (!on && otherDoorCount >= BRAND_FORM_MAX_DOOR_QUESTIONS) {
    return {
      canTurnOn: false,
      line: `${BRAND_FORM_MAX_DOOR_QUESTIONS} questions is the most the door can show. Turn one off first.`,
      countLine,
    };
  }
  return {
    canTurnOn: true,
    line: on ? "Door staff see this answer when they scan." : "Off: door staff never see this answer.",
    countLine,
  };
}

// ---------------------------------------------------------------------------
// "Show only if"
// ---------------------------------------------------------------------------

export interface ConditionSource {
  id: string;
  label: string;
  /** 1-based position on the form ("Q2"). */
  number: number;
  options: BrandFormOptionDef[];
}

const optionDefsOf = (q: IntakeQuestion): BrandFormOptionDef[] => {
  const ids = q.option_ids ?? [];
  return (q.options ?? []).map((label, i) => ({ id: ids[i] ?? "", label }));
};

/**
 * Earlier single-choice questions a question may depend on. `index` is the
 * question's own position; null means a new question added at the end. A
 * question that itself depends on another cannot be a source (one level deep).
 */
export function conditionSources(
  questions: readonly IntakeQuestion[],
  index: number | null,
): ConditionSource[] {
  const upTo = index === null ? questions.length : index;
  const out: ConditionSource[] = [];
  for (let i = 0; i < upTo; i += 1) {
    const q = questions[i];
    if (q === undefined) continue;
    if (q.type !== "single_choice") continue;
    if (q.show_if !== undefined) continue;
    const options = optionDefsOf(q).filter((o) => o.id.length > 0);
    if (options.length < 2) continue;
    out.push({ id: q.id, label: q.label, number: i + 1, options });
  }
  return out;
}

/** The numbers ("Q3") of the questions that depend on `questionId`. */
export const dependentNumbers = (
  questions: readonly IntakeQuestion[],
  questionId: string,
): number[] => {
  const out: number[] = [];
  questions.forEach((q, i) => {
    if (q.show_if !== undefined && q.show_if.question_id === questionId) out.push(i + 1);
  });
  return out;
};

/**
 * Drop every "Show only if" that no longer holds (its source was removed,
 * changed type, lost the option, moved below it, or itself became dependent).
 * Returns the cleaned list and the numbers of the questions that were cleared.
 */
export function sanitizeShowIf(questions: readonly IntakeQuestion[]): {
  questions: IntakeQuestion[];
  cleared: number[];
} {
  const cleared: number[] = [];
  const next = questions.map((q, index) => {
    if (q.show_if === undefined) return q;
    const sourceIndex = questions.findIndex((s) => s.id === q.show_if?.question_id);
    const source = sourceIndex >= 0 ? questions[sourceIndex] : undefined;
    const valid =
      source !== undefined &&
      sourceIndex < index &&
      source.type === "single_choice" &&
      source.show_if === undefined &&
      (source.option_ids ?? []).includes(q.show_if.option_id);
    if (valid) return q;
    cleared.push(index + 1);
    const { show_if: _dropped, ...rest } = q;
    void _dropped;
    return rest;
  });
  return { questions: next, cleared };
}

export type MoveResult =
  | { ok: true; questions: IntakeQuestion[] }
  | { ok: false; message: string };

/**
 * Move one question to a new place. Moving a question above the question its
 * "Show only if" depends on (or the source below its dependents) is blocked.
 */
export function moveQuestion(
  questions: readonly IntakeQuestion[],
  from: number,
  to: number,
): MoveResult {
  if (to < 0 || to >= questions.length || from === to) {
    return { ok: true, questions: [...questions] };
  }
  const next = [...questions];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return { ok: true, questions: [...questions] };
  next.splice(to, 0, moved);
  for (let i = 0; i < next.length; i += 1) {
    const q = next[i];
    if (q === undefined || q.show_if === undefined) continue;
    const sourceIndex = next.findIndex((s) => s.id === q.show_if?.question_id);
    if (sourceIndex >= i) {
      const sourceNumber = sourceIndex + 1;
      return {
        ok: false,
        message: `Question ${i + 1} only shows after question ${sourceNumber}. Move question ${sourceNumber} up first, or remove its "Show only if".`,
      };
    }
  }
  return { ok: true, questions: next.map((q, idx) => ({ ...q, position: idx })) };
}

// ---------------------------------------------------------------------------
// Option helpers (keep `options` and `option_ids` in step)
// ---------------------------------------------------------------------------

/** Give every option an id (brand forms only; trip questions never get ids). */
export function withOptionIds(q: IntakeQuestion): IntakeQuestion {
  if (!isChoiceType(q.type)) return q;
  const options = q.options ?? [];
  const ids = q.option_ids ?? [];
  if (ids.length === options.length) return q;
  return { ...q, option_ids: options.map((_, i) => ids[i] ?? newOptionId()) };
}

export function addOptionTo(q: IntakeQuestion, max: number): IntakeQuestion {
  const options = q.options ?? [];
  if (options.length >= max) return q;
  const next: IntakeQuestion = { ...q, options: [...options, ""] };
  if (q.option_ids !== undefined) next.option_ids = [...q.option_ids, newOptionId()];
  return next;
}

export function removeOptionFrom(q: IntakeQuestion, index: number, min: number): IntakeQuestion {
  const options = q.options ?? [];
  if (options.length <= min) return q;
  const next: IntakeQuestion = { ...q, options: options.filter((_, i) => i !== index) };
  if (q.option_ids !== undefined) next.option_ids = q.option_ids.filter((_, i) => i !== index);
  return next;
}

export function moveOptionIn(q: IntakeQuestion, from: number, to: number): IntakeQuestion {
  const options = q.options ?? [];
  if (to < 0 || to >= options.length || from === to) return q;
  const move = <T,>(list: readonly T[]): T[] => {
    const copy = [...list];
    const [item] = copy.splice(from, 1);
    if (item !== undefined) copy.splice(to, 0, item);
    return copy;
  };
  const next: IntakeQuestion = { ...q, options: move(options) };
  if (q.option_ids !== undefined) next.option_ids = move(q.option_ids);
  return next;
}

/** On save: drop blank options and their ids together. */
export function dropBlankOptions(q: IntakeQuestion): IntakeQuestion {
  if (!isChoiceType(q.type)) return q;
  const options = q.options ?? [];
  const keep = options.map((o) => o.trim().length > 0);
  const next: IntakeQuestion = {
    ...q,
    options: options.filter((_, i) => keep[i]).map((o) => o.trim()),
  };
  if (q.option_ids !== undefined) next.option_ids = q.option_ids.filter((_, i) => keep[i]);
  return next;
}

// ---------------------------------------------------------------------------
// Pre-publish checks (mirror of the server's, in plain words)
// ---------------------------------------------------------------------------

export function publishBlockers(questions: readonly IntakeQuestion[]): string[] {
  const out: string[] = [];
  if (questions.length === 0) out.push("Add at least one question before publishing.");
  questions.forEach((q, i) => {
    const n = i + 1;
    if (q.label.trim().length === 0) out.push(`Question ${n} needs a question.`);
    if (isChoiceType(q.type) && (q.options ?? []).filter((o) => o.trim().length > 0).length < 2) {
      out.push(`Question ${n} needs at least 2 options.`);
    }
  });
  if (doorQuestionCount(questions) > BRAND_FORM_MAX_DOOR_QUESTIONS) {
    out.push(`A form can show at most ${BRAND_FORM_MAX_DOOR_QUESTIONS} questions at the door.`);
  }
  return out;
}

/** Whether two definitions are the same as far as a publish is concerned. */
export const sameDefinition = (a: BrandFormDefinition, b: BrandFormDefinition): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
