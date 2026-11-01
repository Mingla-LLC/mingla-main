/**
 * #3355 P3 — which flow card in an Ari thread may be answered.
 *
 * Ari's server flow engine owns progress. Exactly one card per chat is
 * current (the run's `current_artefact_id`, delivered with every response and
 * by flow_resume); every other flow card is locked and says why, in words a
 * screen reader announces: "Answered" when the owner already answered it,
 * "Replaced by a newer question" when a newer card took its place. Until the
 * server has answered for this chat, the newest unanswered card is treated as
 * current so a reload never shows a dead thread.
 *
 * Pure on purpose (no React Native), so every branch is unit-testable.
 */

import {
  formatPhoneNational,
  phoneDialCodeForCountry,
} from "@mingla/phone-input/phoneNumber";

import type {
  AgentMessage,
  AriFlowAnswer,
  AriFlowArtefact,
  AriFlowState,
} from "../../services/agentChatService";

export type AriFlowCardStatus =
  | "live"
  | "answered"
  | "replaced"
  | "info"
  | "view_only";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function flowArtefactOf(
  message: Pick<AgentMessage, "role" | "content">,
): AriFlowArtefact | null {
  if (message.role !== "assistant") return null;
  const structured = (message.content as { structured?: unknown }).structured;
  const raw = isRecord(structured) ? structured.flow : undefined;
  if (
    !isRecord(raw) || raw.schema_version !== 1 ||
    typeof raw.artefact_id !== "string" || typeof raw.run_id !== "string" ||
    typeof raw.step_key !== "string" || !Array.isArray(raw.options)
  ) return null;
  const options = raw.options.filter((option): option is AriFlowArtefact[
    "options"
  ][number] =>
    isRecord(option) && typeof option.id === "string" &&
    typeof option.label === "string" &&
    (option.route === undefined || typeof option.route === "string")
  );
  return {
    ...(raw as unknown as AriFlowArtefact),
    question_id: typeof raw.question_id === "string" ? raw.question_id : null,
    options,
  };
}

/** Question ids the owner already answered (their structured answer rows). */
export function answeredFlowQuestionIds(
  messages: ReadonlyArray<Pick<AgentMessage, "role" | "content">>,
): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    const structured = (message.content as { structured?: unknown })
      .structured;
    const answer = isRecord(structured) ? structured.flow_answer : undefined;
    if (isRecord(answer) && typeof answer.question_id === "string") {
      ids.add(answer.question_id);
    }
  }
  return ids;
}

/**
 * #2830 P4 — when Ari shows the current card again at the bottom (resume,
 * a refusal, "not there yet"), the newer row carries the SAME artefact id.
 * Only the newest copy is the card; every older copy shows its words with
 * "Continued below" and no controls, so one step is never answerable twice.
 */
export function earlierFlowCopyIds(
  messages: ReadonlyArray<Pick<AgentMessage, "id" | "role" | "content">>,
): Set<string> {
  const seen = new Set<string>();
  const earlier = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const artefact = flowArtefactOf(messages[index]);
    if (!artefact) continue;
    if (seen.has(artefact.artefact_id)) earlier.add(messages[index].id);
    else seen.add(artefact.artefact_id);
  }
  return earlier;
}

export const ARI_FLOW_CONTINUED_COPY = "Continued below";

/** The card treated as current before the server's flow state arrives. */
export function newestOpenFlowArtefactId(
  messages: ReadonlyArray<Pick<AgentMessage, "role" | "content">>,
): string | null {
  const answered = answeredFlowQuestionIds(messages);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const artefact = flowArtefactOf(messages[index]);
    if (!artefact || artefact.options.length === 0) continue;
    return artefact.question_id && answered.has(artefact.question_id)
      ? null
      : artefact.artefact_id;
  }
  return null;
}

export function flowCardStatus(args: {
  artefact: AriFlowArtefact;
  flowState: AriFlowState | null | undefined;
  answered: ReadonlySet<string>;
  fallbackCurrentId: string | null;
}): AriFlowCardStatus {
  const { artefact, flowState } = args;
  if (!artefact.question_id) return "info";
  if (artefact.options.length === 0 && artefact.answer_mode !== "form") {
    return "info";
  }
  if (args.answered.has(artefact.question_id)) return "answered";
  const currentId = flowState === undefined
    ? args.fallbackCurrentId
    : flowState?.current_artefact_id ?? null;
  if (currentId !== artefact.artefact_id) return "replaced";
  if (flowState?.view_only) return "view_only";
  return "live";
}

export const ARI_FLOW_LOCKED_COPY: Readonly<
  Record<"answered" | "replaced", string>
> = Object.freeze({
  answered: "Answered",
  replaced: "Replaced by a newer question",
});

export const ARI_FLOW_OFFLINE_COPY =
  "You're offline — I'll pick up here when you're back.";

export function flowViewOnlyCopy(state: AriFlowState | null | undefined): string {
  return `${
    state?.owner_name ?? state?.lease_owner_name ?? "A teammate"
  } is working on this. You can follow along here.`;
}

/**
 * #2830 P4 — a form card's answer: the values its control produced (chosen
 * option labels, the phone chip's country, what was typed), bound to the
 * card's run, step and question. The owner's bubble shows only their value
 * ("+44 20 7946 0958"), never a scripted instruction.
 */
export function buildFlowFormAnswer(args: {
  artefact: AriFlowArtefact;
  choiceLabels: string[];
  fieldValue: string;
  fieldCountryIso?: string | null;
}): { answer: AriFlowAnswer; label: string } | null {
  const { artefact } = args;
  if (artefact.answer_mode !== "form" || !artefact.question_id) return null;
  const choices = args.choiceLabels
    .map((label) => label.trim())
    .filter(Boolean)
    .slice(0, 10);
  const response = args.fieldValue.trim().slice(0, 2000);
  const country =
    typeof args.fieldCountryIso === "string" &&
    /^[A-Z]{2}$/.test(args.fieldCountryIso)
      ? args.fieldCountryIso
      : null;
  if (choices.length === 0 && !response) return null;
  let shown = response || choices.join(", ");
  if (country && response && !response.startsWith("+")) {
    const dial = phoneDialCodeForCountry(country);
    if (dial) shown = `${dial} ${formatPhoneNational(country, response)}`;
  }
  if (choices.length > 0 && response) {
    shown = `${choices.join(", ")}: ${shown}`;
  }
  const label = shown.length > 200 ? `${shown.slice(0, 197)}…` : shown;
  return {
    answer: {
      run_id: artefact.run_id,
      step_key: artefact.step_key,
      question_id: artefact.question_id,
      choice_id: "answer",
      display_text: label,
      values: { choices, country, response },
    },
    label,
  };
}
