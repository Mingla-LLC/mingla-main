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

import type {
  AgentMessage,
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
  if (artefact.options.length === 0 || !artefact.question_id) return "info";
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
