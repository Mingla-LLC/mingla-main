/**
 * Issue #4261 — plans in chats: the pure model.
 *
 * Everything here is dependency-free (no React Native) so the Deno suite can
 * run it: which chats hold plans, whether the form can post, the leading time,
 * what needs the viewer's vote, the Matches order, the RSVP summary, plan time
 * labels (Intl, never hard-coded month names), the comment quote note, the
 * "Suggest a random time" slot, the quick-day chips, the place-result merge
 * and the optimistic patches the vote / RSVP / thumbs mutations apply.
 */
import type {
  ChatPlan,
  ChatPlanKind,
  ChatPlanLink,
  ChatPlanOption,
  ChatPlanPlaceOption,
  ChatPlansPayload,
  ChatPlanRpcErrorCode,
  PlanAddPlaceInput,
  PlanCreateInput,
  PlanPlaceInput,
  PlanQuoteSnapshot,
  PlanReaction,
  PlanRsvp,
  PlanWhereKind,
} from "../../types/chatPlans";

// ---------------------------------------------------------------------------
// Which chats can hold plans (spec 5.5 #12; mirrors `chat_plan_chat_kind`)
// ---------------------------------------------------------------------------

export interface ChatPlanKindInput {
  isGroupChat: boolean;
  /** `conversations.linked_entity_type` as the chat list carries it. */
  linkedEntityType?: string | null;
  sessionId?: string | null;
  programKind?: string | null;
  /** A brand channel (event chats grouped under a brand). */
  isBrandChannel?: boolean;
  /** Brand enquiry / support threads. */
  isEnquiry?: boolean;
  isBlocked?: boolean;
  isUnfriended?: boolean;
  isDeletedAccount?: boolean;
}

export function chatPlanKindOf(input: ChatPlanKindInput): ChatPlanKind | null {
  if (input.isBrandChannel || input.isEnquiry || input.programKind) return null;
  const linked = input.linkedEntityType ?? null;
  if (!input.isGroupChat) {
    if (input.isBlocked || input.isUnfriended || input.isDeletedAccount) return null;
    if (linked !== null && linked !== "direct") return null;
    return "direct";
  }
  if (linked === "session") return input.sessionId ? "session" : null;
  if ((linked === null || linked === "direct") && !input.sessionId) return "plain";
  return null;
}

// ---------------------------------------------------------------------------
// The plan form (prototype `canPost`)
// ---------------------------------------------------------------------------

export type PlanFormWhere = "place" | "link" | "none";
export type PlanFormWhen = "set" | "poll";

/** A picked place: a pool row, a Google row (after retrieve) or typed text. */
export interface PlanFormPlace {
  source: "pool" | "google" | "typed";
  name: string;
  area: string | null;
  poolId?: string;
  providerPlaceId?: string;
  lat?: number | null;
  lng?: number | null;
}

/** One time in the form: `date` is `YYYY-MM-DD` ('' until picked), `time` is `HH:mm`. */
export interface PlanFormSlot {
  date: string;
  time: string;
}

export interface PlanFormDraft {
  title: string;
  where: PlanFormWhere;
  place: PlanFormPlace | null;
  /** Amendment 1: the optional own link of a Google / typed place (reset when the place changes). */
  placeLink: string;
  link: string;
  when: PlanFormWhen;
  /** Set a time. */
  date: string;
  time: string;
  /** Let the group vote. */
  options: PlanFormSlot[];
  openTimes: boolean;
  note: string;
}

export const PLAN_TITLE_MAX = 80;
export const PLAN_NOTE_MAX = 280;
export const PLAN_FORM_MAX_TIMES = 5;
export const PLAN_MAX_TIMES = 8;

export function blankPlanForm(): PlanFormDraft {
  return {
    title: "",
    where: "place",
    place: null,
    placeLink: "",
    link: "",
    when: "poll",
    date: "",
    time: "19:00",
    options: [],
    openTimes: true,
    note: "",
  };
}

/** The host of a pasted link without `www.`, or '' when it is not a link. */
export function linkDomainOf(link: string): string {
  const stripped = (link || "").trim().replace(/^https?:\/\//i, "");
  if (!/^[^\s/]+\.[^\s/]+/.test(stripped)) return "";
  return (stripped.split("/")[0] ?? "").replace(/^www\./i, "").toLowerCase();
}

/** The URL `plan_create` gets: the pasted text, with https:// added when it has no scheme. */
export function normalisedLinkUrl(link: string): string {
  const trimmed = (link || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** A non-empty place link that is not a link blocks Post / Add (amendment 1, 6.3). */
export function placeLinkInvalid(placeLink: string | null | undefined): boolean {
  const text = (placeLink ?? "").trim();
  return text !== "" && linkDomainOf(text) === "";
}

export function canPostPlan(form: PlanFormDraft): boolean {
  if (form.where === "place" && placeLinkInvalid(form.placeLink)) return false;
  const what =
    form.title.trim().length > 0 ||
    (form.where === "place" && form.place !== null) ||
    (form.where === "link" && linkDomainOf(form.link) !== "");
  if (!what) return false;
  if (form.when === "set") return form.date !== "";
  return form.openTimes || form.options.filter((option) => option.date !== "").length >= 2;
}

/** A picked place as the `p_where_kind` / `p_place` pair the RPCs take. Pool rows send only their id. */
export function placeInputOf(place: PlanFormPlace): { whereKind: "place" | "address"; place: PlanPlaceInput } {
  if (place.source === "pool" && place.poolId) return { whereKind: "place", place: { poolId: place.poolId } };
  if (place.source === "google" && place.providerPlaceId) {
    return {
      whereKind: "place",
      place: {
        providerPlaceId: place.providerPlaceId,
        name: place.name,
        ...(place.area ? { address: place.area } : {}),
        ...(typeof place.lat === "number" ? { lat: place.lat } : {}),
        ...(typeof place.lng === "number" ? { lng: place.lng } : {}),
      },
    };
  }
  return { whereKind: "address", place: { name: place.name } };
}

/** The place's own link for `p_link_url`: Google / typed places only, never a Mingla place. */
export function placeLinkUrlOf(place: PlanFormPlace, placeLink: string | null | undefined): string | null {
  if (place.source === "pool") return null;
  const text = (placeLink ?? "").trim();
  if (!text || linkDomainOf(text) === "") return null;
  return normalisedLinkUrl(text);
}

/** The `plan_create` input from the form. */
export function planCreateInput(form: PlanFormDraft, conversationId: string, clientId: string): PlanCreateInput {
  let whereKind: PlanWhereKind = "none";
  let place: PlanPlaceInput | null = null;
  let linkUrl: string | null = null;
  if (form.where === "place" && form.place) {
    const input = placeInputOf(form.place);
    whereKind = input.whereKind;
    place = input.place;
    linkUrl = placeLinkUrlOf(form.place, form.placeLink);
  } else if (form.where === "link" && linkDomainOf(form.link)) {
    whereKind = "link";
    linkUrl = normalisedLinkUrl(form.link);
  }
  const setAt = form.when === "set" ? slotToDate({ date: form.date, time: form.time }) : null;
  const options = form.when === "poll"
    ? form.options
        .filter((slot) => slot.date !== "")
        .map((slot) => slotToDate(slot))
        .filter((value): value is Date => value !== null)
        .map((value) => value.toISOString())
    : [];
  return {
    conversationId,
    clientId,
    title: form.title.trim(),
    whereKind,
    place,
    linkUrl,
    whenMode: form.when,
    scheduledAt: setAt ? setAt.toISOString() : null,
    options: Array.from(new Set(options)),
    openTimes: form.when === "poll" ? form.openTimes : false,
    note: form.note.trim() ? form.note.trim() : null,
  };
}

/** The `plan_add_place` input from the suggest sheet. */
export function planAddPlaceInput(planId: string, place: PlanFormPlace, placeLink: string | null | undefined): PlanAddPlaceInput {
  const input = placeInputOf(place);
  return { planId, whereKind: input.whereKind, place: input.place, linkUrl: placeLinkUrlOf(place, placeLink) };
}

/** A form date + time as an instant in the phone's own time zone. */
export function slotToDate(slot: PlanFormSlot): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || !/^\d{2}:\d{2}$/.test(slot.time)) return null;
  const [y, m, d] = slot.date.split("-").map(Number);
  const [hh, mm] = slot.time.split(":").map(Number);
  const value = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isFinite(value.getTime()) ? value : null;
}

/** Constitution #12: compare the picked datetime, not today's date. */
export function isFutureSlot(slot: PlanFormSlot, now: Date): boolean {
  const at = slotToDate(slot);
  return at !== null && at.getTime() > now.getTime();
}

export function dateKey(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function timeKey(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Votes, leader, needs-my-vote, Matches order, RSVP summary
// ---------------------------------------------------------------------------

/** Most voters; a tie goes to the earliest time. Null when there are no options. */
export function leadingOption(options: readonly ChatPlanOption[]): ChatPlanOption | null {
  let best: ChatPlanOption | null = null;
  for (const option of options) {
    if (!best) {
      best = option;
      continue;
    }
    const more = option.voterIds.length > best.voterIds.length;
    const tieEarlier =
      option.voterIds.length === best.voterIds.length &&
      Date.parse(option.startsAt) < Date.parse(best.startsAt);
    if (more || tieEarlier) best = option;
  }
  return best;
}

export function viewerVotedAny(plan: Pick<ChatPlan, "options">, viewerId: string): boolean {
  return plan.options.some((option) => option.voterIds.includes(viewerId));
}

export function viewerReaction(plan: Pick<ChatPlan, "reactions">, viewerId: string): PlanReaction | null {
  if (plan.reactions.up.includes(viewerId)) return "up";
  if (plan.reactions.down.includes(viewerId)) return "down";
  return null;
}

export function viewerRsvp(plan: Pick<ChatPlan, "rsvps">, viewerId: string): PlanRsvp | null {
  if (plan.rsvps.going.includes(viewerId)) return "going";
  if (plan.rsvps.maybe.includes(viewerId)) return "maybe";
  if (plan.rsvps.cant.includes(viewerId)) return "cant";
  return null;
}

/**
 * Prototype L427: a time vote with options I have not voted on, a place vote I
 * have not voted on (amendment 1), or no thumbs from me.
 */
export function needsMyVote(
  plan: Pick<ChatPlan, "whenMode" | "options" | "reactions"> & { places?: ChatPlan["places"] },
  viewerId: string,
): boolean {
  const pollPending = plan.whenMode === "poll" && plan.options.length > 0 && !viewerVotedAny(plan, viewerId);
  const places = plan.places ?? [];
  const placePending = places.length >= 2 && !places.some((option) => option.voterIds.includes(viewerId));
  return pollPending || placePending || viewerReaction(plan, viewerId) === null;
}

/** Matches: still-deciding plans, the ones needing my vote first, then newest first. */
export function orderMatches<T extends Pick<ChatPlan, "status" | "createdAt" | "whenMode" | "options" | "reactions"> & { places?: ChatPlan["places"] }>(
  plans: readonly T[],
  viewerId: string,
): T[] {
  return plans
    .filter((plan) => plan.status === "deciding")
    .map((plan) => ({ plan, todo: needsMyVote(plan, viewerId) }))
    .sort((a, b) => {
      if (a.todo !== b.todo) return a.todo ? -1 : 1;
      return Date.parse(b.plan.createdAt) - Date.parse(a.plan.createdAt);
    })
    .map((entry) => entry.plan);
}

export function rsvpSummary(plan: Pick<ChatPlan, "rsvps">): { going: number; maybe: number; cant: number } {
  return { going: plan.rsvps.going.length, maybe: plan.rsvps.maybe.length, cant: plan.rsvps.cant.length };
}

/** Lock in the leader only once it has at least one vote (prototype `canLock`). */
export function lockableLeader(plan: Pick<ChatPlan, "canLock" | "status" | "options">): ChatPlanOption | null {
  if (!plan.canLock || plan.status !== "deciding") return null;
  const leader = leadingOption(plan.options);
  return leader && leader.voterIds.length > 0 ? leader : null;
}

/** "Lock it in" (pick a time) shows for a locker when there is no time vote yet. */
export function canLockWithoutVote(plan: Pick<ChatPlan, "canLock" | "status" | "options">): boolean {
  return plan.canLock && plan.status === "deciding" && plan.options.length === 0;
}

// ---------------------------------------------------------------------------
// Time labels (Intl only, Hermes-safe; amendment 1 B-1)
// Every field comes from format() (never the parts API Hermes answers
// differently), with a manual clock fallback, so no label shows "undefined".
// ---------------------------------------------------------------------------

/** Hermes returns U+202F / U+00A0 inside formatted times; labels use plain spaces. */
function cleanLabel(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, " ").replace(/\s+/g, " ").trim();
}

function usableLabel(value: string): boolean {
  return value !== "" && !/undefined|NaN/.test(value);
}

/**
 * One date field ("Fri", "6", "Nov") through `format()`. A formatter that throws
 * or returns nothing falls back to `toLocaleDateString` (local time only: with
 * an explicit time zone there is no honest fallback, so the field is dropped).
 */
export function fieldLabel(at: Date, locale: string, opts: Intl.DateTimeFormatOptions, timeZone?: string): string {
  let out = "";
  try {
    out = cleanLabel(new Intl.DateTimeFormat(locale, { ...opts, ...(timeZone ? { timeZone } : {}) }).format(at));
  } catch (error) {
    // Fallback below replaces the value; the label is never left broken.
    out = "";
  }
  if (usableLabel(out)) return out;
  if (timeZone) return "";
  try {
    const fallback = cleanLabel(at.toLocaleDateString(locale, opts));
    return usableLabel(fallback) ? fallback : "";
  } catch (error) {
    return "";
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * "8:00 PM" / "20:00". `format()` with hour + minute is used when it holds at
 * least three digits; otherwise (local time only) the clock is built from
 * `getHours()` / `getMinutes()`, 12-hour unless the locale resolves to 24-hour.
 */
export function clockLabel(at: Date, locale: string, timeZone?: string): string {
  let formatted = "";
  let hour12: boolean | undefined;
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
    formatted = cleanLabel(formatter.format(at));
    try {
      hour12 = formatter.resolvedOptions().hour12;
    } catch (error) {
      hour12 = undefined;
    }
  } catch (error) {
    // The manual clock below replaces the value.
    formatted = "";
  }
  const digits = (formatted.match(/\d/g) ?? []).length;
  if (digits >= 3 && usableLabel(formatted)) return formatted;
  if (timeZone) return "";
  const hours = at.getHours();
  const minutes = pad2(at.getMinutes());
  if (hour12 === false) return `${pad2(hours)}:${minutes}`;
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

function validDate(iso: string): Date | null {
  const at = new Date(iso);
  return Number.isFinite(at.getTime()) ? at : null;
}

/** "Fri 6 Nov · 8:00 PM" */
export function formatPlanTime(iso: string, locale: string, timeZone?: string): string {
  const at = validDate(iso);
  if (!at) return "";
  const date = [
    fieldLabel(at, locale, { weekday: "short" }, timeZone),
    fieldLabel(at, locale, { day: "numeric" }, timeZone),
    fieldLabel(at, locale, { month: "short" }, timeZone),
  ].filter(Boolean).join(" ");
  return [date, clockLabel(at, locale, timeZone)].filter(Boolean).join(" · ");
}

/** "Fri 8:00 PM" (the lock button and the quote note). */
export function shortPlanTime(iso: string, locale: string, timeZone?: string): string {
  const at = validDate(iso);
  if (!at) return "";
  return [fieldLabel(at, locale, { weekday: "short" }, timeZone), clockLabel(at, locale, timeZone)].filter(Boolean).join(" ");
}

/** Matches: the card index under a horizontal offset (amendment 1 B-2). */
export function matchIndexForOffset(offsetX: number, interval: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(offsetX) || !Number.isFinite(interval) || interval <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offsetX / interval)));
}

// ---------------------------------------------------------------------------
// The comment quote note (prototype `myNote`, localised)
// ---------------------------------------------------------------------------

export type PlanTranslate = (key: string, params?: Record<string, unknown>) => string;

export function joinNames(items: readonly string[], t: PlanTranslate): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return t("plan_quote_and", { list: items.slice(0, -1).join(", "), last: items[items.length - 1] });
}

/** "You voted Fri 8:00 PM and Sat 7:00 PM, you're going" (from the sender's own picks). */
export function planQuoteNote(
  snapshot: Pick<PlanQuoteSnapshot, "votedStartsAt" | "rsvp" | "votedPlaces">,
  locale: string,
  timeZone: string | undefined,
  t: PlanTranslate,
  fallback?: string,
): string {
  const parts: string[] = [];
  const voted = [...snapshot.votedStartsAt]
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .map((iso) => shortPlanTime(iso, locale, timeZone))
    .filter(Boolean);
  if (voted.length > 0) parts.push(t("plan_quote_you_voted", { times: joinNames(voted, t) }));
  const places = (snapshot.votedPlaces ?? []).filter((name) => typeof name === "string" && name.trim() !== "");
  if (places.length > 0) parts.push(t("plan_quote_you_picked", { places: joinNames(places, t) }));
  if (snapshot.rsvp === "going") parts.push(t("plan_quote_going"));
  else if (snapshot.rsvp === "maybe") parts.push(t("plan_quote_maybe"));
  else if (snapshot.rsvp === "cant") parts.push(t("plan_quote_cant"));
  if (parts.length === 0) return fallback ?? t("plan_quote_voting");
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A place option's name as people read it: its name, else its link's domain. */
export function placeOptionName(option: Pick<ChatPlanPlaceOption, "name" | "link">): string {
  return option.name?.trim() || option.link?.domain || "";
}

/** The viewer's live picks on a plan, as a quote snapshot (the reply bar preview). */
export function viewerQuoteSnapshot(plan: ChatPlan, viewerId: string): PlanQuoteSnapshot {
  return {
    title: plan.title,
    votedStartsAt: plan.options.filter((option) => option.voterIds.includes(viewerId)).map((option) => option.startsAt),
    rsvp: viewerRsvp(plan, viewerId),
    votedPlaces: (plan.places ?? [])
      .filter((option) => option.voterIds.includes(viewerId))
      .map(placeOptionName)
      .filter(Boolean),
  };
}

/** The quote's fallback when nothing is picked: a place-only vote says so. */
export function planQuoteFallbackKey(plan: Pick<ChatPlan, "whenMode" | "options"> & { places?: ChatPlan["places"] }): string {
  const timePoll = plan.whenMode === "poll" && plan.options.length > 0;
  return !timePoll && (plan.places ?? []).length >= 2 ? "plan_quote_voting_place" : "plan_quote_voting";
}

/** The composer's "Replying to plan" state. */
export interface PlanCommentReply {
  planId: string;
  title: string;
  viaPlanId: boolean;
  /** My picks when the reply started; null when the viewer is unknown. */
  quote: PlanQuoteSnapshot | null;
}

/**
 * What a send carries for the composer's reply. A plan comment's bubble gets the
 * plan and my picks at once, so it renders the plan quote from its first frame;
 * a plan with no visible card has no message to reply to. Any other reply stays
 * a plain reply.
 */
export function planCommentSendFields(
  reply: { messageId: string; plan?: PlanCommentReply } | null,
): { replyToId?: string; planId?: string; planQuote?: PlanQuoteSnapshot } {
  const plan = reply?.plan;
  if (!plan) return { replyToId: reply?.messageId };
  return {
    replyToId: plan.viaPlanId ? undefined : reply?.messageId,
    planId: plan.planId,
    planQuote: plan.quote ?? undefined,
  };
}

/** Reads `messages.plan_quote` defensively (old rows, partial realtime rows). */
export function parsePlanQuote(value: unknown): PlanQuoteSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.title !== "string") return null;
  const voted = Array.isArray(record.votedStartsAt)
    ? record.votedStartsAt.filter((item): item is string => typeof item === "string")
    : [];
  const rsvp = record.rsvp === "going" || record.rsvp === "maybe" || record.rsvp === "cant" ? record.rsvp : null;
  const votedPlaces = Array.isArray(record.votedPlaces)
    ? record.votedPlaces.filter((item): item is string => typeof item === "string")
    : [];
  return { title: record.title, votedStartsAt: voted, rsvp, votedPlaces };
}

// ---------------------------------------------------------------------------
// Suggest a random time, quick days
// ---------------------------------------------------------------------------

/** Evening / weekend slots on the next Thu–Sun (prototype `suggestOpt`). */
const SUGGEST_SLOTS: Record<number, string[]> = {
  4: ["19:30"],
  5: ["18:00", "21:00"],
  6: ["13:00", "20:00"],
  0: ["11:00", "17:00"],
};

export function suggestRandomSlot(
  existing: readonly PlanFormSlot[],
  now: Date,
  rng: () => number,
): PlanFormSlot | null {
  const taken = new Set(existing.map((slot) => `${slot.date}T${slot.time}`));
  const free: PlanFormSlot[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    for (const time of SUGGEST_SLOTS[day.getDay()] ?? []) {
      const slot = { date: dateKey(day), time };
      if (taken.has(`${slot.date}T${slot.time}`)) continue;
      if (!isFutureSlot(slot, now)) continue;
      free.push(slot);
    }
  }
  if (free.length === 0) return null;
  const index = Math.min(free.length - 1, Math.max(0, Math.floor(rng() * free.length)));
  return free[index];
}

export type QuickDayKind = "tonight" | "tomorrow" | "friday" | "saturday";

export interface QuickDay {
  kind: QuickDayKind;
  date: string;
}

/** Tonight, Tomorrow, then the next Friday and Saturday after tomorrow. */
export function quickDays(now: Date): QuickDay[] {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (offset: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
  const nextWeekday = (weekday: number): Date => {
    for (let offset = 2; offset <= 8; offset += 1) {
      const day = at(offset);
      if (day.getDay() === weekday) return day;
    }
    return at(2);
  };
  return [
    { kind: "tonight", date: dateKey(base) },
    { kind: "tomorrow", date: dateKey(at(1)) },
    { kind: "friday", date: dateKey(nextWeekday(5)) },
    { kind: "saturday", date: dateKey(nextWeekday(6)) },
  ];
}

// ---------------------------------------------------------------------------
// Place results: pool first, then Google, then the typed row
// (Invariant I-4261-PLACE-SEARCH-POOL-FIRST is declared beside its test, issue_4261_plan_model.)
// ---------------------------------------------------------------------------

export interface PlacePoolRowInput {
  id: string;
  name: string;
  area: string | null;
  lat: number | null;
  lng: number | null;
}

export interface PlaceSearchRowInput {
  providerPlaceId: string;
  name: string;
  area: string | null;
}

export type PlaceResultRow =
  | { kind: "pool"; key: string; name: string; area: string | null; onMingla: true; poolId: string; lat: number | null; lng: number | null }
  | { kind: "google"; key: string; name: string; area: string | null; onMingla: false; providerPlaceId: string }
  | { kind: "typed"; key: string; name: string; area: null; onMingla: false };

function placeKey(name: string, area: string | null): string {
  const normal = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
  return `${normal(name)}|${normal(area ?? "")}`;
}

export function mergePlaceResults(
  pool: readonly PlacePoolRowInput[],
  searched: readonly PlaceSearchRowInput[],
  query: string,
): PlaceResultRow[] {
  const rows: PlaceResultRow[] = [];
  const seen = new Set<string>();
  for (const row of pool) {
    const key = placeKey(row.name, row.area);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ kind: "pool", key: `pool:${row.id}`, name: row.name, area: row.area, onMingla: true, poolId: row.id, lat: row.lat, lng: row.lng });
  }
  for (const row of searched) {
    const key = placeKey(row.name, row.area);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ kind: "google", key: `google:${row.providerPlaceId}`, name: row.name, area: row.area, onMingla: false, providerPlaceId: row.providerPlaceId });
  }
  const typed = query.trim();
  if (typed) rows.push({ kind: "typed", key: `typed:${typed}`, name: typed, area: null, onMingla: false });
  return rows;
}

// ---------------------------------------------------------------------------
// Optimistic patches (Constitution #1: the tap shows at once; rollback on error)
// ---------------------------------------------------------------------------

function patchPlan(
  payload: ChatPlansPayload,
  planId: string,
  patch: (plan: ChatPlan) => ChatPlan,
): ChatPlansPayload {
  return { ...payload, plans: payload.plans.map((plan) => (plan.id === planId ? patch(plan) : plan)) };
}

export function applyVotePatch(
  payload: ChatPlansPayload,
  optionId: string,
  viewerId: string,
  on: boolean,
): ChatPlansPayload {
  const owner = payload.plans.find((plan) => plan.options.some((option) => option.id === optionId));
  if (!owner) return payload;
  return patchPlan(payload, owner.id, (plan) => ({
    ...plan,
    options: plan.options.map((option) => {
      if (option.id !== optionId) return option;
      const without = option.voterIds.filter((id) => id !== viewerId);
      return { ...option, voterIds: on ? [...without, viewerId] : without };
    }),
  }));
}

export function applyRsvpPatch(
  payload: ChatPlansPayload,
  planId: string,
  viewerId: string,
  status: PlanRsvp | null,
): ChatPlansPayload {
  return patchPlan(payload, planId, (plan) => {
    const strip = (ids: string[]) => ids.filter((id) => id !== viewerId);
    const rsvps = { going: strip(plan.rsvps.going), maybe: strip(plan.rsvps.maybe), cant: strip(plan.rsvps.cant) };
    if (status) rsvps[status] = [...rsvps[status], viewerId];
    return { ...plan, rsvps };
  });
}

export function applyReactionPatch(
  payload: ChatPlansPayload,
  planId: string,
  viewerId: string,
  kind: PlanReaction | null,
): ChatPlansPayload {
  return patchPlan(payload, planId, (plan) => {
    const strip = (ids: string[]) => ids.filter((id) => id !== viewerId);
    const reactions = { up: strip(plan.reactions.up), down: strip(plan.reactions.down) };
    if (kind) reactions[kind] = [...reactions[kind], viewerId];
    return { ...plan, reactions };
  });
}

/** Tapping the selected RSVP / thumb again clears it. */
export function toggledChoice<T extends string>(current: T | null, tapped: T): T | null {
  return current === tapped ? null : tapped;
}

// ---------------------------------------------------------------------------
// Errors → copy keys (spec 5.6)
// ---------------------------------------------------------------------------

export type PlanAction =
  | "create"
  | "vote"
  | "rsvp"
  | "reaction"
  | "addTime"
  | "addPlace"
  | "placeVote"
  | "lock"
  | "update"
  | "cancel";

export function planErrorKey(
  code: ChatPlanRpcErrorCode | "unknown",
  action: PlanAction,
  source: "chat" | "deck" = "chat",
): string {
  if (code === "unavailable") return "plan_unavailable";
  if (code === "conflict_too_many_times") return "plan_too_many_times";
  if (code === "conflict_too_many_places") return "plan_too_many_places";
  if (action === "lock" && code === "not_allowed") return source === "deck" ? "plan_only_admin_locks" : "plan_only_creator_locks";
  return "plan_action_failed";
}

// ---------------------------------------------------------------------------
// Header strip and Plans sheet inputs
// ---------------------------------------------------------------------------

export type PlanRef = { kind: "chat"; planId: string } | { kind: "deck"; savedCardId: string };

export function planRefOf(plan: Pick<ChatPlan, "id" | "source" | "savedCardId">): PlanRef {
  return plan.source === "deck" && plan.savedCardId
    ? { kind: "deck", savedCardId: plan.savedCardId }
    : { kind: "chat", planId: plan.id };
}

/**
 * The photo a plan shows: a chat plan's place photo (pool first), else its
 * link's preview image (amendment 1); a deck match's card photo.
 */
export function planPhoto(plan: Pick<ChatPlan, "source" | "place" | "cardData"> & { link?: ChatPlanLink | null }): string | null {
  if (plan.source === "chat") return plan.place?.photoUrl ?? plan.link?.imageUrl ?? null;
  const card = plan.cardData ?? null;
  if (!card) return null;
  const images = Array.isArray(card.images) ? card.images : [];
  for (const candidate of [card.image, card.imageUrl, card.image_url, images[0]]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/** Plans in the Plans sheet: locked in, with a time. */
export function scheduledPlans(plans: readonly ChatPlan[]): Array<ChatPlan & { scheduledAt: string }> {
  return plans.filter(
    (plan): plan is ChatPlan & { scheduledAt: string } => plan.status === "scheduled" && typeof plan.scheduledAt === "string",
  );
}

/**
 * The header strip's inputs from the plan list: Matches = every plan still
 * being decided (flagged when it waits on the viewer), Plans = the locked-in
 * plans with a time.
 */
export function planHeaderInputs(plans: readonly ChatPlan[], viewerId: string): {
  matches: Array<{ id: string; card_data: Record<string, unknown>; needsVote: boolean }>;
  scheduled: Array<{ savedCardId: string; cardData: Record<string, unknown>; scheduledAt: string; planRef: PlanRef }>;
} {
  const matches = plans
    .filter((plan) => plan.status === "deciding")
    .map((plan) => ({
      id: plan.id,
      card_data: { title: plan.title, image: planPhoto(plan) ?? undefined },
      needsVote: needsMyVote(plan, viewerId),
    }));
  const scheduled = scheduledPlans(plans).map((plan) => ({
    savedCardId: plan.savedCardId ?? "",
    cardData: plan.source === "deck" && plan.cardData ? plan.cardData : { title: plan.title },
    scheduledAt: plan.scheduledAt,
    planRef: planRefOf(plan),
  }));
  return { matches, scheduled };
}


// ---------------------------------------------------------------------------
// Amendment 1: who added / voted, the place vote, link targets, payload parse
// ---------------------------------------------------------------------------

/**
 * Line 2 of a time or place option (B-5): "Added by {name}" / "Suggested by
 * {name}" only when someone other than the plan's creator added it; voters with
 * the viewer first as "You", then the others in vote order; "No votes yet".
 */
export function optionVotersLine(
  option: { addedBy: string | null; voterIds: readonly string[] },
  plan: Pick<ChatPlan, "createdBy">,
  viewerId: string,
  nameOf: (userId: string | null) => string,
  t: PlanTranslate,
  kind: "time" | "place",
): string {
  const you = t("plan_voter_you");
  const adder = option.addedBy && option.addedBy !== plan.createdBy
    ? t(kind === "place" ? "plan_place_option_added_by" : "plan_option_added_by", {
        name: option.addedBy === viewerId ? you : nameOf(option.addedBy),
      })
    : null;
  const voters = [
    ...(option.voterIds.includes(viewerId) ? [you] : []),
    ...option.voterIds.filter((id) => id !== viewerId).map((id) => nameOf(id)),
  ];
  const tail = voters.length > 0 ? voters.join(", ") : t("plan_option_no_votes");
  return [adder, tail].filter(Boolean).join(" · ");
}

/** Most voters; a tie goes to the plan's own place, then list (server) order. */
export function leadingPlace<T extends Pick<ChatPlanPlaceOption, "voterIds" | "isOriginal">>(places: readonly T[]): T | null {
  let best: T | null = null;
  for (const option of places) {
    if (!best) {
      best = option;
      continue;
    }
    const more = option.voterIds.length > best.voterIds.length;
    const tieOriginal = option.voterIds.length === best.voterIds.length && option.isOriginal && !best.isOriginal;
    if (more || tieOriginal) best = option;
  }
  return best;
}

/** A place vote is on when the plan holds two or more place options. */
export function placePollActive(plan: { places?: ChatPlan["places"] }): boolean {
  return (plan.places ?? []).length >= 2;
}

export function applyPlaceVotePatch(
  payload: ChatPlansPayload,
  optionId: string,
  viewerId: string,
  on: boolean,
): ChatPlansPayload {
  const owner = payload.plans.find((plan) => (plan.places ?? []).some((option) => option.id === optionId));
  if (!owner) return payload;
  return patchPlan(payload, owner.id, (plan) => ({
    ...plan,
    places: plan.places.map((option) => {
      if (option.id !== optionId) return option;
      const without = option.voterIds.filter((id) => id !== viewerId);
      return { ...option, voterIds: on ? [...without, viewerId] : without };
    }),
  }));
}

/** The lock button's parts: the leading time and, with a place vote, the leading place. */
export function lockLabelParts(
  plan: Pick<ChatPlan, "options"> & { places?: ChatPlan["places"] },
  locale: string,
  timeZone?: string,
): { time: string; place: string | null } {
  const leader = leadingOption(plan.options);
  const time = leader ? shortPlanTime(leader.startsAt, locale, timeZone) : "";
  const place = placePollActive(plan) ? leadingPlace(plan.places ?? []) : null;
  const name = place ? placeOptionName(place) : "";
  return { time, place: name || null };
}

/** The place option a lock sends (`p_place_option_id`): the shown leader; never for deck plans. */
export function lockPlaceOptionId(plan: Pick<ChatPlan, "source"> & { places?: ChatPlan["places"] }): string | null {
  if (plan.source !== "chat") return null;
  return leadingPlace(plan.places ?? [])?.id ?? null;
}

export type MapsUrlBuilder = (input: {
  lat: number | null;
  lng: number | null;
  label: string | null;
  googlePlaceId?: string | null;
}) => string | null;

export type PlaceLinkTarget =
  | { kind: "mingla" }
  | { kind: "link"; url: string; label: string }
  | { kind: "maps"; url: string };

/**
 * What opening a place does: a Mingla place opens its Mingla card; a place not
 * on Mingla opens its own link, else the map (in Mingla's browser). Null when
 * there is nothing honest to open (no link, no coordinates, no name).
 * `mapsUrlOf` is `mapsWebUrl` from utils/inAppLink (injected so this file stays import-free).
 */
export function placeLinkTarget(
  place: {
    poolId: string | null;
    name: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
    link: Pick<ChatPlanLink, "url" | "domain" | "title"> | null;
    /** #4334 — a Google-sourced place's id; the map link opens that named place. */
    providerPlaceId?: string | null;
  },
  mapsUrlOf: MapsUrlBuilder,
): PlaceLinkTarget | null {
  if (place.poolId) return { kind: "mingla" };
  if (place.link?.url) return { kind: "link", url: place.link.url, label: place.link.title || place.link.domain };
  const url = mapsUrlOf({
    lat: place.lat,
    lng: place.lng,
    label: place.name || place.address || null,
    googlePlaceId: place.providerPlaceId ?? null,
  });
  return url ? { kind: "maps", url } : null;
}

/** The plan's own place as a link target (its attached link, when it has one). */
export function planPlaceTarget(
  plan: Pick<ChatPlan, "place" | "link" | "whereKind">,
  mapsUrlOf: MapsUrlBuilder,
): PlaceLinkTarget | null {
  if (!plan.place || (plan.whereKind !== "place" && plan.whereKind !== "address")) return null;
  return placeLinkTarget({ ...plan.place, link: plan.link ?? null }, mapsUrlOf);
}

/** The saved-card payload a Mingla place opens its expanded card from. */
export function placeExpansionPayload(
  place: Pick<ChatPlanPlaceOption, "poolId" | "name" | "address" | "photoUrl" | "lat" | "lng">,
  fallbackTitle: string,
): Record<string, unknown> | null {
  if (!place.poolId) return null;
  return {
    id: place.poolId,
    placePoolId: place.poolId,
    title: place.name ?? fallbackTitle,
    address: place.address ?? undefined,
    image: place.photoUrl ?? undefined,
    lat: place.lat ?? undefined,
    lng: place.lng ?? undefined,
    location: place.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : undefined,
  };
}

/** A cover image a plan card may show directly (link previews are never proxied). */
export function isHttpsImage(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https:\/\//i.test(url.trim());
}

// ---- payload parse (old servers omit the amendment-1 fields) ---------------

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizePlanLink(value: unknown): ChatPlanLink | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string" || typeof record.domain !== "string") return null;
  return {
    url: record.url,
    domain: record.domain,
    title: stringOrNull(record.title),
    imageUrl: stringOrNull(record.imageUrl),
    siteName: stringOrNull(record.siteName),
    fetchedAt: stringOrNull(record.fetchedAt),
  };
}

function normalizePlaceOption(value: unknown): ChatPlanPlaceOption | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") return null;
  const kind = record.kind === "address" || record.kind === "link" ? record.kind : "place";
  return {
    id: record.id,
    kind,
    poolId: stringOrNull(record.poolId),
    providerPlaceId: stringOrNull(record.providerPlaceId),
    name: stringOrNull(record.name),
    address: stringOrNull(record.address),
    lat: numberOrNull(record.lat),
    lng: numberOrNull(record.lng),
    photoUrl: stringOrNull(record.photoUrl),
    link: normalizePlanLink(record.link),
    addedBy: stringOrNull(record.addedBy),
    isOriginal: record.isOriginal === true,
    voterIds: Array.isArray(record.voterIds) ? record.voterIds.filter((id): id is string => typeof id === "string") : [],
  };
}

/** `chat_plans_for_conversation` with the amendment-1 fields defaulted (missing → [] / false / null). */
export function normalizeChatPlansPayload(payload: ChatPlansPayload): ChatPlansPayload {
  const plans = Array.isArray(payload.plans) ? payload.plans : [];
  return {
    ...payload,
    plans: plans.map((plan) => {
      const raw = plan as unknown as Record<string, unknown>;
      return {
        ...plan,
        link: normalizePlanLink(raw.link),
        places: Array.isArray(raw.places)
          ? raw.places.map(normalizePlaceOption).filter((option): option is ChatPlanPlaceOption => option !== null)
          : [],
        canAddPlace: raw.canAddPlace === true,
      };
    }),
  };
}

/**
 * A link on the plan (its own, or a place option's) that the server has never
 * tried to preview, on a plan older than 60 s: the card asks once per session.
 */
export function needsLinkPreviewRetry(
  plan: Pick<ChatPlan, "source" | "createdAt" | "link"> & { places?: ChatPlan["places"] },
  now: number,
): boolean {
  if (plan.source !== "chat") return false;
  const created = Date.parse(plan.createdAt);
  if (!Number.isFinite(created) || now - created < 60_000) return false;
  const links = [plan.link, ...(plan.places ?? []).map((option) => option.link)];
  return links.some((link) => link !== null && link !== undefined && link.fetchedAt === null);
}
