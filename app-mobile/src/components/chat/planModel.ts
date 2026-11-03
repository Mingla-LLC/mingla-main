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
  ChatPlanOption,
  ChatPlansPayload,
  ChatPlanRpcErrorCode,
  PlanQuoteSnapshot,
  PlanReaction,
  PlanRsvp,
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

/** A picked place: a pool row, a Mapbox row (after retrieve) or typed text. */
export interface PlanFormPlace {
  source: "pool" | "mapbox" | "typed";
  name: string;
  area: string | null;
  poolId?: string;
  mapboxId?: string;
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

export function canPostPlan(form: PlanFormDraft): boolean {
  const what =
    form.title.trim().length > 0 ||
    (form.where === "place" && form.place !== null) ||
    (form.where === "link" && linkDomainOf(form.link) !== "");
  if (!what) return false;
  if (form.when === "set") return form.date !== "";
  return form.openTimes || form.options.filter((option) => option.date !== "").length >= 2;
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

/** Prototype L427: a time vote with options I have not voted on, or no thumbs from me. */
export function needsMyVote(
  plan: Pick<ChatPlan, "whenMode" | "options" | "reactions">,
  viewerId: string,
): boolean {
  const pollPending = plan.whenMode === "poll" && plan.options.length > 0 && !viewerVotedAny(plan, viewerId);
  return pollPending || viewerReaction(plan, viewerId) === null;
}

/** Matches: still-deciding plans, the ones needing my vote first, then newest first. */
export function orderMatches<T extends Pick<ChatPlan, "status" | "createdAt" | "whenMode" | "options" | "reactions">>(
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
// Time labels (Intl only)
// ---------------------------------------------------------------------------

function partsOf(iso: string, locale: string, timeZone?: string): Record<string, string> | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  };
  const out: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat(locale, options).formatToParts(at)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
}

function clockOf(parts: Record<string, string>): string {
  const minute = parts.minute ?? "00";
  return parts.dayPeriod ? `${parts.hour}:${minute} ${parts.dayPeriod}` : `${parts.hour}:${minute}`;
}

/** "Fri 6 Nov · 8:00 PM" */
export function formatPlanTime(iso: string, locale: string, timeZone?: string): string {
  const parts = partsOf(iso, locale, timeZone);
  if (!parts) return "";
  return `${parts.weekday} ${parts.day} ${parts.month} · ${clockOf(parts)}`;
}

/** "Fri 8:00 PM" (the lock button and the quote note). */
export function shortPlanTime(iso: string, locale: string, timeZone?: string): string {
  const parts = partsOf(iso, locale, timeZone);
  if (!parts) return "";
  return `${parts.weekday} ${clockOf(parts)}`;
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
  snapshot: Pick<PlanQuoteSnapshot, "votedStartsAt" | "rsvp">,
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
  if (snapshot.rsvp === "going") parts.push(t("plan_quote_going"));
  else if (snapshot.rsvp === "maybe") parts.push(t("plan_quote_maybe"));
  else if (snapshot.rsvp === "cant") parts.push(t("plan_quote_cant"));
  if (parts.length === 0) return fallback ?? t("plan_quote_voting");
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The viewer's live picks on a plan, as a quote snapshot (the reply bar preview). */
export function viewerQuoteSnapshot(plan: ChatPlan, viewerId: string): PlanQuoteSnapshot {
  return {
    title: plan.title,
    votedStartsAt: plan.options.filter((option) => option.voterIds.includes(viewerId)).map((option) => option.startsAt),
    rsvp: viewerRsvp(plan, viewerId),
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
  return { title: record.title, votedStartsAt: voted, rsvp };
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
// Place results: pool first, then Mapbox, then the typed row
// MINGLA-INVARIANT: I-4261-PLACE-SEARCH-POOL-FIRST | issue #4261 | Place results list Mingla pool rows before Mapbox rows, and the typed address row last.
// ---------------------------------------------------------------------------

export interface PlacePoolRowInput {
  id: string;
  name: string;
  area: string | null;
  lat: number | null;
  lng: number | null;
}

export interface PlaceMapboxRowInput {
  mapboxId: string;
  name: string;
  area: string | null;
}

export type PlaceResultRow =
  | { kind: "pool"; key: string; name: string; area: string | null; onMingla: true; poolId: string; lat: number | null; lng: number | null }
  | { kind: "mapbox"; key: string; name: string; area: string | null; onMingla: false; mapboxId: string }
  | { kind: "typed"; key: string; name: string; area: null; onMingla: false };

function placeKey(name: string, area: string | null): string {
  const normal = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
  return `${normal(name)}|${normal(area ?? "")}`;
}

export function mergePlaceResults(
  pool: readonly PlacePoolRowInput[],
  mapbox: readonly PlaceMapboxRowInput[],
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
  for (const row of mapbox) {
    const key = placeKey(row.name, row.area);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ kind: "mapbox", key: `mapbox:${row.mapboxId}`, name: row.name, area: row.area, onMingla: false, mapboxId: row.mapboxId });
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

export type PlanAction = "create" | "vote" | "rsvp" | "reaction" | "addTime" | "lock" | "update" | "cancel";

export function planErrorKey(
  code: ChatPlanRpcErrorCode | "unknown",
  action: PlanAction,
  source: "chat" | "deck" = "chat",
): string {
  if (code === "unavailable") return "plan_unavailable";
  if (code === "conflict_too_many_times") return "plan_too_many_times";
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

/** The photo a plan shows: a chat plan's place photo, a deck match's card photo. */
export function planPhoto(plan: Pick<ChatPlan, "source" | "place" | "cardData">): string | null {
  if (plan.source === "chat") return plan.place?.photoUrl ?? null;
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
