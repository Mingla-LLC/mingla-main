/**
 * Issue #4114 Wave 3 (D9) — the chat header's pure model.
 *
 * The group/collab header used to be two stacked rows of pills (124pt always).
 * It is now one 48pt title row plus a 40pt strip that only exists when the
 * collab has matches or plans:
 *
 *   6 top + 48 title row + 8 bottom                    = 62pt
 *   6 top + 48 title row + 6 gap + 40 strip + 8 bottom = 108pt
 *
 * Everything here is pure and dependency-free (no React Native) so it runs
 * under Deno. The strip reads only data the chat already loads
 * (`useSessionSavedCardsForSheet` and `useSessionScheduledCards`) and keeps the
 * show-only-if-non-empty rules of `getCollabChatHeaderActions`.
 * MINGLA-INVARIANT: I-4114-CHAT-HEADER-62-108 | issue #4114 | The chat header is 62pt with nothing in the strip and 108pt with matches or plans, measured under the status bar.
 */

export const CHAT_HEADER_METRICS = {
  paddingTop: 6,
  titleRow: 48,
  stripGap: 6,
  strip: 40,
  paddingBottom: 8,
  backButtonWidth: 36,
  backButtonHeight: 44,
  avatar: 32,
  /** Issue #4114 Wave 6: the brand channel's logo is a rounded square. */
  brandAvatarRadius: 9,
  swipeButtonHeight: 34,
} as const;

/** The header's height under the status bar. */
export function chatHeaderHeight(showStrip: boolean): number {
  const m = CHAT_HEADER_METRICS;
  return m.paddingTop + m.titleRow + (showStrip ? m.stripGap + m.strip : 0) + m.paddingBottom;
}

export type CollabHeaderActionId = "matches" | "swipe" | "plans";

/** A matched (not yet locked) card, as `useSessionSavedCardsForSheet` returns it. */
export interface HeaderMatchInput {
  id: string;
  saved_card_id?: string;
  card_data?: unknown;
  experience_data?: unknown;
}

/** A locked plan, as `useSessionScheduledCards` returns it. */
export interface HeaderPlanInput {
  savedCardId: string;
  cardData: Record<string, unknown> | null;
  scheduledAt: string;
  lockedByDisplayName?: string;
}

export interface MatchesCellModel {
  count: number;
  /** Up to three matched-place photos, newest first. */
  photos: string[];
  /** The first three place names, comma separated. */
  names: string;
  /** True when a match exists that this phone has not opened yet. */
  hasUnseen: boolean;
  loading: boolean;
}

export interface PlanCellModel {
  /** `upcoming`: the next plan from now. `past`: every plan is in the past; the last one, muted. */
  state: "upcoming" | "past";
  title: string;
  scheduledAt: string;
  /** Other upcoming plans after the one shown ("+N more"). Always 0 for `past`. */
  moreCount: number;
  loading: boolean;
  /** The saved card of the plan shown, so tapping it opens that plan's card. */
  savedCardId: string;
}

export interface CollabHeaderStripModel {
  visible: boolean;
  matches: MatchesCellModel | null;
  plan: PlanCellModel | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** The best photo a saved card carries (place image, gallery, or a curated plan's first stop). */
export function cardPhoto(cardData: unknown): string | null {
  const card = asRecord(cardData);
  if (!card) return null;
  const images = Array.isArray(card.images) ? card.images : [];
  const stops = Array.isArray(card.stops) ? card.stops : [];
  const firstStop = asRecord(stops[0]);
  return firstString(
    card.image,
    card.imageUrl,
    card.image_url,
    images[0],
    firstStop?.imageUrl,
    firstStop?.image,
  );
}

export function cardName(cardData: unknown): string | null {
  const card = asRecord(cardData);
  if (!card) return null;
  return firstString(card.title, card.name, card.placeName);
}

function matchCard(match: HeaderMatchInput): unknown {
  return match.card_data ?? match.experience_data ?? null;
}

export function matchKey(match: HeaderMatchInput): string {
  return match.saved_card_id || match.id;
}

/** True when any match id is missing from the set this phone has already opened. */
export function hasUnseenMatches(matchIds: readonly string[], seenIds: ReadonlySet<string>): boolean {
  return matchIds.some((id) => !seenIds.has(id));
}

/** Plans split for the Plans sheet: Upcoming soonest first, Past most recent first. */
export function groupPlans<T extends Pick<HeaderPlanInput, "scheduledAt">>(
  rows: readonly T[],
  now: number,
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const row of rows) {
    const at = Date.parse(row.scheduledAt);
    if (Number.isFinite(at) && at >= now) upcoming.push(row);
    else past.push(row);
  }
  upcoming.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  past.sort((a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt));
  return { upcoming, past };
}

export function buildCollabHeaderStrip(input: {
  /** The ids `getCollabChatHeaderActions` returned (show-only-if-non-empty rules). */
  actionIds: readonly CollabHeaderActionId[];
  matches: readonly HeaderMatchInput[];
  matchesLoading: boolean;
  plans: readonly HeaderPlanInput[];
  plansLoading: boolean;
  seenMatchIds: ReadonlySet<string>;
  now: number;
  untitled: string;
}): CollabHeaderStripModel {
  // Issue #4114 QA (P3): a cell appears only once it has data. A first read
  // with nothing yet used to flash "Loading matches / plans" and then vanish
  // when the collab had none; now the strip stays hidden until there is
  // something to show.
  const showMatches = input.actionIds.includes("matches") && input.matches.length > 0;
  const showPlans = input.actionIds.includes("plans") && input.plans.length > 0;

  let matches: MatchesCellModel | null = null;
  if (showMatches) {
    const photos: string[] = [];
    const names: string[] = [];
    for (const match of input.matches) {
      const card = matchCard(match);
      const photo = cardPhoto(card);
      if (photo && photos.length < 3) photos.push(photo);
      const name = cardName(card);
      if (name && names.length < 3) names.push(name);
    }
    matches = {
      count: input.matches.length,
      photos,
      names: names.join(", "),
      hasUnseen: hasUnseenMatches(input.matches.map(matchKey), input.seenMatchIds),
      loading: input.matchesLoading && input.matches.length === 0,
    };
  }

  let plan: PlanCellModel | null = null;
  if (showPlans) {
    const { upcoming, past } = groupPlans(input.plans, input.now);
    const shown = upcoming[0] ?? past[0] ?? null;
    plan = {
      state: upcoming.length > 0 ? "upcoming" : "past",
      title: (shown && cardName(shown.cardData)) || input.untitled,
      scheduledAt: shown?.scheduledAt ?? "",
      moreCount: upcoming.length > 0 ? upcoming.length - 1 : 0,
      loading: input.plansLoading && input.plans.length === 0,
      savedCardId: shown?.savedCardId ?? "",
    };
  }

  return { visible: matches !== null || plan !== null, matches, plan };
}

/**
 * Issue #4114: what a tap on the strip's plan cell does. The plan itself (date
 * tile and name) opens THAT plan's card; "+N more" opens the Plans sheet.
 */
export type PlanStripTap = { kind: "card"; savedCardId: string } | { kind: "sheet" };

export function planStripTap(plan: Pick<PlanCellModel, "savedCardId"> | null, part: "plan" | "more"): PlanStripTap {
  if (part === "plan" && plan?.savedCardId) return { kind: "card", savedCardId: plan.savedCardId };
  return { kind: "sheet" };
}

/**
 * Issue #4114: the saved card a plan row in the thread points at. Covers the
 * lock-and-schedule card message (`lockInEvent`, flat payload with
 * `savedCardId`) and the older ORCH-0908 rows ("Plan locked in" /
 * "Scheduled for", `event` + `saved_card_id`). Anything else is not a plan.
 */
export function planSavedCardIdFromPayload(payload: unknown): string | null {
  const p = asRecord(payload);
  if (!p) return null;
  const isPlan =
    p.lockInEvent === "card_locked_and_scheduled" ||
    p.event === "card_locked_and_scheduled" ||
    p.event === "card_locked" ||
    p.event === "plan_scheduled";
  if (!isPlan) return null;
  return firstString(p.savedCardId, p.saved_card_id);
}

/**
 * Issue #4114: the plan to open for a saved card id. The Plans list row wins
 * (the exact data the Plans sheet opens); a card message's own payload is the
 * fallback while the list has not loaded it. Null when there is nothing to show.
 */
export function resolvePlanCard<T extends Pick<HeaderPlanInput, "savedCardId" | "cardData">>(
  rows: readonly T[],
  savedCardId: string,
  fallbackCardData?: Record<string, unknown> | null,
): { savedCardId: string; cardData: Record<string, unknown> } | null {
  const row = rows.find((candidate) => candidate.savedCardId === savedCardId);
  const cardData = row?.cardData ?? fallbackCardData ?? null;
  return cardData ? { savedCardId, cardData } : null;
}

/** "Tomi, Kemi, Dayo and you": the members' first names for the title row. */
export function memberFirstNames(
  names: readonly string[],
  youLabel: string,
  joiner: (list: string, last: string) => string,
): string {
  const firsts = names
    .map((name) => name.trim().split(/\s+/)[0])
    .filter((name): name is string => !!name);
  if (firsts.length === 0) return youLabel;
  return joiner(firsts.join(", "), youLabel);
}

/**
 * Issue #4114 QA (P3): the group avatar stack in the thread header shows the
 * OTHER members (the chat list was fixed in 3671b7910; the header still put
 * your own initials first). Drops you from the stack and from the "+N" count.
 */
export function headerAvatarStack<T extends { id: string }>(
  participants: readonly T[],
  participantCount: number | undefined,
  currentUserId: string | null | undefined,
): { participants: T[]; participantCount: number } {
  const others = currentUserId ? participants.filter((participant) => participant.id !== currentUserId) : [...participants];
  const total = participantCount ?? participants.length;
  const removedSelf = others.length < participants.length ? 1 : 0;
  return { participants: others, participantCount: Math.max(others.length, total - removedSelf) };
}
