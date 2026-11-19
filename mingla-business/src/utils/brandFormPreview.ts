/**
 * #4514 — the builder's live preview: what a guest sees for a definition and
 * a set of answers. Pure.
 *
 * `@mingla/form-rendering` (wave 1) draws the trip question shape and knows
 * nothing about "Show only if" or the door, so the preview decides which
 * questions are visible and adds the "Shown to door staff" line itself, then
 * hands the renderer a plain list. [TRANSITIONAL] Wave 3 moves this decision
 * into the package for every guest surface; exit: the package renderer
 * evaluates show_if and prints the door line, and this adapter is deleted.
 */

import type { FormAnswerValue, FormQuestion, FormSchema } from "@mingla/form-rendering";

import type { BrandFormDefinition, BrandFormQuestionDef } from "./brandFormDefinition";

export const SHOWN_TO_DOOR_STAFF = "Shown to door staff";
export const ANSWERS_SEEN_LINE = "The host and their door staff can see your answers.";

const isEmptyAnswer = (value: FormAnswerValue | undefined): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return value.length === 0;
};

/** Whether one question is visible given the answers so far. */
export function isQuestionVisible(
  def: BrandFormDefinition,
  q: BrandFormQuestionDef,
  answers: Record<string, FormAnswerValue>,
): boolean {
  if (q.show_if === undefined || q.show_if === null) return true;
  const source = def.questions.find((s) => s.id === q.show_if?.question_id);
  if (source === undefined) return false;
  const option = source.options?.find((o) => o.id === q.show_if?.option_id);
  if (option === undefined) return false;
  const given = answers[source.id];
  return typeof given === "string" && given === option.label;
}

export const visibleQuestions = (
  def: BrandFormDefinition,
  answers: Record<string, FormAnswerValue>,
): BrandFormQuestionDef[] =>
  [...def.questions]
    .sort((a, b) => a.position - b.position)
    .filter((q) => isQuestionVisible(def, q, answers));

/** Whether a visible required question is still unanswered. */
export const missingRequired = (
  def: BrandFormDefinition,
  answers: Record<string, FormAnswerValue>,
): boolean =>
  visibleQuestions(def, answers).some((q) => q.required && isEmptyAnswer(answers[q.id]));

/** The answers that still count: a hidden question's answer is dropped. */
export function visibleAnswers(
  def: BrandFormDefinition,
  answers: Record<string, FormAnswerValue>,
): Record<string, FormAnswerValue> {
  const out: Record<string, FormAnswerValue> = {};
  for (const q of visibleQuestions(def, answers)) {
    const value = answers[q.id];
    if (value !== undefined) out[q.id] = value;
  }
  return out;
}

const toFormQuestion = (q: BrandFormQuestionDef, index: number): FormQuestion => {
  const lines: string[] = [];
  if (typeof q.help === "string" && q.help.trim().length > 0) lines.push(q.help.trim());
  if (q.show_at_door === true) lines.push(SHOWN_TO_DOOR_STAFF);
  const out: FormQuestion = {
    id: q.id,
    type: q.type,
    label: q.label.length > 0 ? q.label : "Untitled question",
    required: q.required,
    position: index,
  };
  if (lines.length > 0) out.helper = lines.join("\n");
  if (q.options !== undefined) out.options = q.options.map((o) => o.label);
  return out;
};

/** The list the renderer draws for these answers. */
export function previewSchema(
  def: BrandFormDefinition,
  answers: Record<string, FormAnswerValue>,
): FormSchema {
  return { questions: visibleQuestions(def, answers).map(toFormQuestion) };
}
