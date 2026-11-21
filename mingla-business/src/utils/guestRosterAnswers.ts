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
  | { kind: "not_loaded" }
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
  notLoaded: "Answer not loaded",
  truncated: (n: number): string =>
    `Only the first ${n} answers are loaded here. Open Responses in Promote › Forms to see every answer.`,
} as const;

/** Answers read per request (the server's page cap) and the most pages one guest list reads. */
export const ROSTER_ANSWERS_PAGE = 200;
export const ROSTER_ANSWERS_MAX_PAGES = 25;

export interface RosterAnswerIndex {
  formName: string;
  page: BrandFormResponsesPage;
  byRsvp: Map<string, BrandFormResponseRow>;
  byOrder: Map<string, BrandFormResponseRow>;
  notAnswered: Map<string, BrandFormNotAnswered>;
  /** More answers exist than were read (the read cap): unmatched guests are "not loaded", not "none". */
  truncated: boolean;
}

/**
 * Read every page of a page's answers (offset paging, `ROSTER_ANSWERS_PAGE` a
 * read) up to `maxPages`, then index them. The not-answered list is not paged
 * (the server returns all of it with each read), so it comes from the first page.
 */
export async function loadRosterAnswers(
  formName: string,
  fetchPage: (offset: number, limit: number) => Promise<BrandFormResponsesPage>,
  maxPages: number = ROSTER_ANSWERS_MAX_PAGES,
): Promise<RosterAnswerIndex> {
  const first = await fetchPage(0, ROSTER_ANSWERS_PAGE);
  const rows: BrandFormResponseRow[] = [...first.rows];
  let offset = first.rows.length;
  let pages = 1;
  while (offset < first.total && pages < maxPages) {
    const next = await fetchPage(offset, ROSTER_ANSWERS_PAGE);
    if (next.rows.length === 0) break;
    rows.push(...next.rows);
    offset += next.rows.length;
    pages += 1;
  }
  return indexRosterAnswers(formName, { ...first, rows }, rows.length < first.total);
}

/** Index one set of answers by RSVP and order id. */
export function indexRosterAnswers(
  formName: string,
  page: BrandFormResponsesPage,
  truncated: boolean = false,
): RosterAnswerIndex {
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
  return { formName, page, byRsvp, byOrder, notAnswered, truncated };
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
  // Past the read cap a guest may have answered on a page that was not read.
  if (index.truncated) return { kind: "not_loaded" };
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
    case "not_loaded":
      return GUEST_ANSWERS_CHIP_COPY.notLoaded;
    case "none":
      return null;
    default: {
      const never: never = state;
      return never;
    }
  }
}
