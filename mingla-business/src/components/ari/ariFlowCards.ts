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
  AriFlowPlaceValue,
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

/**
 * Question ids the owner already answered (their structured answer rows).
 *
 * #3355 — an answer counts only until Ari shows the same card again. When a
 * check fails ("I checked; your plan approval isn't there yet"), the card
 * comes back below the owner's answer with the SAME question id; that copy
 * is live again, with its buttons, not "Answered".
 */
export function answeredFlowQuestionIds(
  messages: ReadonlyArray<Pick<AgentMessage, "role" | "content">>,
): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      const artefact = flowArtefactOf(message);
      if (artefact?.question_id) ids.delete(artefact.question_id);
      continue;
    }
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

/** #3355 — the handoffs the owner can finish with an in-chat upload. */
export type AriFlowUploadKind = "logo" | "cover" | "event_cover";

const FLOW_UPLOAD_ITEMS: Readonly<Record<string, AriFlowUploadKind>> =
  Object.freeze({
    profile_photo: "logo",
    cover_media: "cover",
    // #3355 P7 — the event flow's cover, after the draft exists.
    event_cover: "event_cover",
  });

export interface AriFlowUploadCopy {
  action: string;
  note: string;
  answer: string;
}

export const ARI_FLOW_UPLOAD_COPY: Readonly<
  Record<AriFlowUploadKind, AriFlowUploadCopy>
> = Object.freeze({
  logo: {
    action: "Upload your logo",
    note:
      "You choose the photo. It's saved to your brand as soon as you pick it — Ari never adds one for you.",
    answer: "I've uploaded my logo",
  },
  cover: {
    action: "Add your cover",
    note:
      "You choose the photo or video. It's saved to your brand as soon as you pick it — Ari never adds one for you.",
    answer: "I've added my cover",
  },
  event_cover: {
    action: "Add the event cover",
    note:
      "You choose the photo or video. It's saved to this event's draft as soon as you pick it — Ari never adds one for you.",
    answer: "I've added the event cover",
  },
});

/**
 * #3355 — which upload a live handoff card takes in the chat, if any. Only a
 * card that also lets the owner ask Ari to check (the "check" choice) gets
 * one, so a finished upload always has a bound answer to send.
 */
export function flowUploadKind(
  artefact: AriFlowArtefact,
): AriFlowUploadKind | null {
  if (artefact.kind !== "handoff" || !artefact.question_id) return null;
  const kind = artefact.handoff
    ? FLOW_UPLOAD_ITEMS[artefact.handoff.item_key]
    : undefined;
  if (!kind) return null;
  // An event cover needs the event it goes to.
  if (kind === "event_cover" && !artefact.subject_id) return null;
  return artefact.options.some((option) => option.id === "check")
    ? kind
    : null;
}

/**
 * #3355 P7 — the event flow's "Where is it?" card: answered with the Host's
 * address search (MapboxAddressInput) and a venue name, never typed text.
 * #3355 P8 — the trip flow's departure and destination cards use the same
 * search without a venue name ("city" mode).
 */
export type AriFlowPlaceMode = "venue" | "city" | "address";

/**
 * #3355 P9 — "address": an experience stop or a venue. The name was (or will
 * be) asked on its own card, so only the address search shows.
 */
const FLOW_PLACE_STEPS: Readonly<Record<string, AriFlowPlaceMode>> =
  Object.freeze({
    event_place: "venue",
    trip_departure: "city",
    trip_destination: "city",
    experience_stop_place: "address",
    venue_place: "address",
  });

export function flowPlaceMode(
  artefact: AriFlowArtefact,
): AriFlowPlaceMode | null {
  const mode = FLOW_PLACE_STEPS[artefact.step_key];
  return mode && artefact.answer_mode === "form" && artefact.question_id !== null
    ? mode
    : null;
}

export function isFlowPlaceCard(artefact: AriFlowArtefact): boolean {
  return flowPlaceMode(artefact) !== null;
}

/** #3355 P7 — the bound answer for a picked place. */
export function buildFlowPlaceAnswer(
  artefact: AriFlowArtefact,
  place: AriFlowPlaceValue,
): { answer: AriFlowAnswer; label: string } | null {
  if (!isFlowPlaceCard(artefact) || !artefact.question_id) return null;
  const venue = place.venue_name.trim();
  const address = place.address.trim();
  const city = place.city.trim();
  if (
    !venue ||
    !address ||
    !city ||
    !Number.isFinite(place.lat) ||
    !Number.isFinite(place.lng)
  ) {
    return null;
  }
  const shown = flowPlaceMode(artefact) === "venue"
    ? `${venue}, ${address}`
    : address;
  const label = shown.length > 200 ? `${shown.slice(0, 197)}…` : shown;
  return {
    answer: {
      run_id: artefact.run_id,
      step_key: artefact.step_key,
      question_id: artefact.question_id,
      choice_id: "answer",
      display_text: label,
      values: {
        choices: [],
        country: null,
        response: "",
        place: { ...place, venue_name: venue, address, city },
      },
    },
    label,
  };
}

/** #3355 — the bound "check" answer sent once the owner's file is saved. */
export function flowUploadAnswer(
  artefact: AriFlowArtefact,
  kind: AriFlowUploadKind,
): { answer: AriFlowAnswer; label: string } | null {
  if (!artefact.question_id) return null;
  const label = ARI_FLOW_UPLOAD_COPY[kind].answer;
  return {
    answer: {
      run_id: artefact.run_id,
      step_key: artefact.step_key,
      question_id: artefact.question_id,
      choice_id: "check",
      display_text: label,
    },
    label,
  };
}
