/**
 * #4514 wave 3 — the answers chip on a guest list row (§4.8), pure.
 *
 * A row is matched to the page's answers by its RSVP or its orders: a response
 * whose subject is that RSVP or order, or a signed-in answer whose holder holds
 * it. "Not answered" comes from the server's own list (the person rule), and
 * "Added by you" marks a guest the host added (door sale, import) who has not
 * answered. Words, never colour alone.
 */

import type {
  BrandFormNotAnswered,
  BrandFormResponseRow,
  BrandFormResponsesPage,
} from "../services/brandFormsService";

export type GuestAnswersChipState =
  | { kind: "answered"; viaLink: boolean; earlierVersion: boolean; response: BrandFormResponseRow }
  | { kind: "not_answered"; addedByHost: boolean }
  | { kind: "none" };

export const GUEST_ANSWERS_CHIP_COPY = {
  answered: "Answered",
  viaLink: "via link",
  notAnswered: "Not answered",
  addedByYou: "Added by you",
  drawerTitle: "Answers",
  earlierVersion: "Answered an earlier version",
  currentVersion: "Current version",
  answeredOn: (date: string): string => `Answered ${date}`,
  loading: "Loading answers…",
  failed: "Couldn't load the answers.",
  retry: "Try again",
  empty: "Not answered",
  noForm: "No guest questions on this page.",
} as const;

export interface RosterAnswerIndex {
  formName: string;
  page: BrandFormResponsesPage;
  byRsvp: Map<string, BrandFormResponseRow>;
  byOrder: Map<string, BrandFormResponseRow>;
  notAnswered: Map<string, BrandFormNotAnswered>;
}

/** Index one page of answers by RSVP and order id. */
export function indexRosterAnswers(formName: string, page: BrandFormResponsesPage): RosterAnswerIndex {
  const byRsvp = new Map<string, BrandFormResponseRow>();
  const byOrder = new Map<string, BrandFormResponseRow>();
  for (const row of page.rows) {
    if (!row.verified) continue; // an unverified open-link answer never shows on a guest
    if (row.subject.kind === "rsvp" && row.subject.id !== null) byRsvp.set(row.subject.id, row);
    if (row.subject.kind === "order" && row.subject.id !== null) byOrder.set(row.subject.id, row);
    if (row.holder !== null) {
      if (row.holder.rsvpId !== null && !byRsvp.has(row.holder.rsvpId)) byRsvp.set(row.holder.rsvpId, row);
      for (const id of row.holder.orderIds) if (!byOrder.has(id)) byOrder.set(id, row);
    }
  }
  const notAnswered = new Map<string, BrandFormNotAnswered>();
  for (const n of page.notAnswered) notAnswered.set(`${n.kind}:${n.id}`, n);
  return { formName, page, byRsvp, byOrder, notAnswered };
}

/** The chip for one guest list row. */
export function chipForRow(
  index: RosterAnswerIndex,
  row: { rsvpId: string | null; orderIds: readonly string[] },
): GuestAnswersChipState {
  const found = (row.rsvpId !== null ? index.byRsvp.get(row.rsvpId) : undefined) ??
    row.orderIds.map((id) => index.byOrder.get(id)).find((r) => r !== undefined);
  if (found !== undefined) {
    return { kind: "answered", viaLink: found.viaLink, earlierVersion: found.earlierVersion, response: found };
  }
  const missing = (row.rsvpId !== null ? index.notAnswered.get(`rsvp:${row.rsvpId}`) : undefined) ??
    row.orderIds.map((id) => index.notAnswered.get(`order:${id}`)).find((n) => n !== undefined);
  if (missing !== undefined) return { kind: "not_answered", addedByHost: missing.addedByHost };
  return { kind: "none" };
}

export function chipLabel(state: GuestAnswersChipState): string | null {
  switch (state.kind) {
    case "answered":
      return state.viaLink
        ? `${GUEST_ANSWERS_CHIP_COPY.answered} · ${GUEST_ANSWERS_CHIP_COPY.viaLink}`
        : GUEST_ANSWERS_CHIP_COPY.answered;
    case "not_answered":
      return state.addedByHost ? GUEST_ANSWERS_CHIP_COPY.addedByYou : GUEST_ANSWERS_CHIP_COPY.notAnswered;
    case "none":
      return null;
    default: {
      const never: never = state;
      return never;
    }
  }
}
