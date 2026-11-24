/**
 * #4490 P2-4 — Offers and the Entry editor: drafts, validation, payloads and
 * plain words (pure; no React, no services). Money is minor units of the
 * brand currency; weekdays are 0 = Monday.
 */

import { money } from "./offerMoney";
import { weekdaysSummary } from "../../../ui/fieldModels";
import { builtPreset, type VenueFeatureKey, type VenueTypeKey } from "../../../../types/venueFeatures";
import type {
  BusyRule,
  CapacityOverride,
  DateChangeRule,
  EntryStyle,
  RefundRung,
  VenueCapacityPool,
  VenueOffer,
  VenueOfferKind,
  VenueOfferStatus,
  VenuePriceOption,
  VatMode,
} from "../../../../types/venueOffers";

// ---------------------------------------------------------------- words

export const ENTRY_STYLES: ReadonlyArray<{ key: EntryStyle; label: string; helper: string }> = [
  { key: "walk_in", label: "Walk-in", helper: "Come any time the venue is open that day." },
  { key: "day_pass", label: "Day pass", helper: "In and out all day on one pass." },
  { key: "timed_session", label: "Timed session", helper: "A set start time and length, with its own limit." },
];

export function entryStyleLabel(style: EntryStyle | null): string {
  return ENTRY_STYLES.find((s) => s.key === style)?.label ?? "Entry";
}

export const OFFER_KIND_LABEL: Readonly<Record<VenueOfferKind, string>> = {
  entry: "Entry",
  group_package: "Group package",
  private_hire: "Private hire",
  by_the_hour: "By the hour",
};

export const OFFER_STATUS: Readonly<Record<VenueOfferStatus, { label: string; variant: "ok" | "draft" | "warn" | "muted" }>> = {
  live: { label: "Live", variant: "ok" },
  draft: { label: "Draft", variant: "draft" },
  paused: { label: "Paused", variant: "warn" },
  archived: { label: "Archived", variant: "muted" },
};

export type NewOfferCardKey =
  | "entry"
  | "group_package"
  | "private_hire"
  | "by_the_hour"
  | "table_reservations"
  | "membership";

export interface NewOfferCard {
  key: NewOfferCardKey;
  label: string;
  helper: string;
  icon: "ticket" | "users" | "shield" | "clock" | "calendar" | "star";
  /** Buildable now. Cards that are not say why, and never pretend to open. */
  built: boolean;
}

export const NEW_OFFER_CARDS: readonly NewOfferCard[] = [
  { key: "entry", label: "Entry", helper: "Walk-in, day pass or timed session. Priced per guest.", icon: "ticket", built: true },
  { key: "group_package", label: "Group package", helper: "A per-guest deal for groups, with extras included.", icon: "users", built: true },
  { key: "private_hire", label: "Private hire", helper: "A space to themselves. By request, with a deposit.", icon: "shield", built: true },
  { key: "by_the_hour", label: "By the hour", helper: "A room, court, lane, table or desk.", icon: "clock", built: true },
  { key: "table_reservations", label: "Table reservations", helper: "A table at a time. Restaurants, bars, lounges.", icon: "calendar", built: true },
  // #4490 P6 — a monthly plan, built in Members › Plans.
  { key: "membership", label: "Membership", helper: "Monthly access with perks. Coworking, clubs.", icon: "star", built: true },
];

/** The feature each new-offer card sells under. */
export const OFFER_CARD_FEATURE: Readonly<Record<NewOfferCard["key"], VenueFeatureKey>> = {
  entry: "entry",
  group_package: "group_packages",
  private_hire: "private_hire",
  by_the_hour: "by_the_hour",
  table_reservations: "table_reservations",
  membership: "memberships",
};

/**
 * #4490 N57: the New offer cards follow the venue's features and type. Cards
 * for a feature that is on, or that the type usually uses, come first; the
 * rest wait behind "More ways to sell". Pure.
 */
export function splitOfferCards(
  cards: readonly NewOfferCard[],
  enabled: (key: VenueFeatureKey) => boolean,
  category: string | null,
): { main: NewOfferCard[]; more: NewOfferCard[] } {
  const preset = category === null ? [] : builtPreset(category as VenueTypeKey);
  const isMain = (c: NewOfferCard): boolean => enabled(OFFER_CARD_FEATURE[c.key]) || preset.includes(OFFER_CARD_FEATURE[c.key]);
  const main = cards.filter(isMain);
  if (main.length === 0) return { main: [...cards], more: [] };
  return { main, more: cards.filter((c) => !isMain(c)) };
}

// ---------------------------------------------------------------- money

export { money };

/** Venue VAT rate as a percent label ("7.5%"); null when unknown. */
export function vatRateLabel(bps: number | null): string | null {
  if (bps === null || bps <= 0) return null;
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function vatLine(mode: VatMode, bps: number | null): string {
  const rate = vatRateLabel(bps) ?? "VAT";
  if (mode === "none") return "No VAT charged";
  if (mode === "included") return `Prices include ${rate} VAT`;
  return `Prices + ${rate} VAT at checkout`;
}

// --------------------------------------------------------------- drafts

export interface BusyRuleDraft {
  key: string;
  weekdays: number[];
  from: string;
  to: string;
  amountMinor: number | null;
}

export interface PriceOptionDraft {
  /** Local key for React lists (stable before the server gives an id). */
  key: string;
  id: string | null;
  version: number | null;
  name: string;
  free: boolean;
  priceMinor: number | null;
  weekdays: number[];
  idCheck: boolean;
  idLabel: string;
  limitHours: boolean;
  startTime: string;
  endTime: string;
  /** Most guests on one booking of this price. */
  guestMax: number;
  multiDay: boolean;
  passDays: number;
  passWindowDays: number;
  busyRules: BusyRuleDraft[];
}

export type RefundPreset = "none" | "full_24h" | "full_24h_half_after" | "custom";

export interface EntryDraft {
  name: string;
  /** #4490 fix 2 (N80) — the one line guests see under the name. */
  summary: string;
  style: EntryStyle;
  sessionCapacity: number;
  options: PriceOptionDraft[];
  dailyLimit: number;
  keptForWalkIns: number;
  scheduleWeekdays: number[];
  startTime: string;
  endTime: string;
  sessionMinutes: number;
  sessionEveryMinutes: number;
  /** #4490 fix 2 (N82) — "Runs until" (last day on sale, YYYY-MM-DD); "" = no end. */
  endDate: string;
  refundPreset: RefundPreset;
  customLadder: RefundRung[];
  dateChange: boolean;
  dateChangeCutoffMinutes: number;
}

let keySeq = 0;
export function draftKey(prefix = "k"): string {
  keySeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${keySeq}`;
}

export function emptyOptionDraft(name = ""): PriceOptionDraft {
  return {
    key: draftKey("opt"),
    id: null,
    version: null,
    name,
    free: false,
    priceMinor: null,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    idCheck: false,
    idLabel: "",
    limitHours: false,
    startTime: "",
    endTime: "",
    guestMax: 10,
    multiDay: false,
    passDays: 2,
    passWindowDays: 2,
    busyRules: [],
  };
}

export function optionDraftFrom(option: VenuePriceOption): PriceOptionDraft {
  return {
    key: option.id,
    id: option.id,
    version: option.version,
    name: option.name,
    free: option.priceMinor === 0,
    priceMinor: option.priceMinor,
    weekdays: option.weekdays.length > 0 ? option.weekdays : [0, 1, 2, 3, 4, 5, 6],
    idCheck: option.eligibility !== null,
    idLabel: option.eligibility?.label ?? "",
    limitHours: option.startTime !== null && option.endTime !== null,
    startTime: option.startTime ?? "",
    endTime: option.endTime ?? "",
    guestMax: option.guestMax,
    multiDay: option.passDays != null,
    passDays: option.passDays ?? 2,
    passWindowDays: option.passWindowDays ?? option.passDays ?? 2,
    busyRules: option.busyRules.map((r) => ({
      key: draftKey("busy"),
      weekdays: r.weekdays,
      from: r.from,
      to: r.to,
      amountMinor: r.amountMinor,
    })),
  };
}

export const REFUND_PRESETS: ReadonlyArray<{ key: RefundPreset; label: string; helper: string; ladder: RefundRung[] }> = [
  { key: "none", label: "No refunds", helper: "Guests can't get money back once they've paid.", ladder: [] },
  {
    key: "full_24h",
    label: "Full refund up to 24 hours before",
    helper: "After that, no refund.",
    ladder: [{ minMinutesBefore: 1440, refundBps: 10000 }],
  },
  {
    key: "full_24h_half_after",
    label: "Full refund up to 24 hours, then half",
    helper: "Half back if they cancel later, until the day starts.",
    ladder: [
      { minMinutesBefore: 1440, refundBps: 10000 },
      { minMinutesBefore: 0, refundBps: 5000 },
    ],
  },
  { key: "custom", label: "Your own", helper: "Set how much comes back and when.", ladder: [] },
];

function sameLadder(a: readonly RefundRung[], b: readonly RefundRung[]): boolean {
  return a.length === b.length && a.every((r, i) => r.minMinutesBefore === b[i].minMinutesBefore && r.refundBps === b[i].refundBps);
}

export function presetForLadder(ladder: readonly RefundRung[]): RefundPreset {
  for (const preset of REFUND_PRESETS) {
    if (preset.key !== "custom" && sameLadder(preset.ladder, ladder)) return preset.key;
  }
  return "custom";
}

export function ladderForDraft(draft: Pick<EntryDraft, "refundPreset" | "customLadder">): RefundRung[] {
  if (draft.refundPreset === "custom") {
    return [...draft.customLadder].sort((a, b) => b.minMinutesBefore - a.minMinutesBefore);
  }
  return REFUND_PRESETS.find((p) => p.key === draft.refundPreset)?.ladder ?? [];
}

export function dateChangeForDraft(draft: Pick<EntryDraft, "dateChange" | "dateChangeCutoffMinutes">): DateChangeRule | null {
  if (!draft.dateChange) return null;
  return { allowedUntilMinutesBefore: draft.dateChangeCutoffMinutes, feeBps: 0, maxChanges: 1 };
}

/** The editor's starting point for a new or an existing Entry offer. */
export function entryDraftFrom(input: {
  offer: VenueOffer | null;
  pool: VenueCapacityPool | null;
  defaultOpen: string;
  defaultClose: string;
  defaultWeekdays: number[];
}): EntryDraft {
  const { offer, pool } = input;
  const ladder = offer?.policy?.refundLadder ?? [];
  const change = offer?.policy?.dateChangeRule ?? null;
  const schedule = offer?.schedule ?? null;
  return {
    name: offer?.name ?? "",
    summary: offer?.summary ?? "",
    style: offer?.entryStyle ?? "walk_in",
    sessionCapacity: offer?.sessionCapacity ?? 50,
    options: (offer?.options ?? []).map(optionDraftFrom),
    dailyLimit: pool?.dailyLimit ?? 0,
    keptForWalkIns: pool?.keptForWalkIns ?? 0,
    scheduleWeekdays:
      schedule !== null && schedule.weekdays.length > 0 ? schedule.weekdays : input.defaultWeekdays,
    startTime: schedule?.startTime ?? input.defaultOpen,
    endTime: schedule?.endTime ?? input.defaultClose,
    sessionMinutes: schedule?.sessionMinutes ?? 60,
    sessionEveryMinutes: schedule?.sessionEveryMinutes ?? schedule?.sessionMinutes ?? 60,
    endDate: schedule?.endDate ?? "",
    refundPreset: offer?.policy === null || offer === null ? "none" : presetForLadder(ladder),
    customLadder: offer?.policy !== null && offer !== null && presetForLadder(ladder) === "custom" ? ladder : [{ minMinutesBefore: 1440, refundBps: 10000 }],
    dateChange: change !== null && change.allowedUntilMinutesBefore !== null,
    dateChangeCutoffMinutes: change?.allowedUntilMinutesBefore ?? 120,
  };
}

// ----------------------------------------------------------- validation

export interface OptionIssues {
  name: string | null;
  price: string | null;
  weekdays: string | null;
  hours: string | null;
  idLabel: string | null;
  guestMax: string | null;
  busy: string | null;
  pass: string | null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function optionIssues(option: PriceOptionDraft, dailyLimit: number | null): OptionIssues {
  const busyBad = option.busyRules.some(
    (r) => r.weekdays.length === 0 || !TIME.test(r.from) || !TIME.test(r.to) || r.amountMinor === null,
  );
  return {
    // #4490 fix 2 (N58): a price with no name is saved as "Entry" / "Guest".
    name: null,
    price: !option.free && (option.priceMinor === null || option.priceMinor <= 0) ? "Enter a price, or switch this option to free" : null,
    weekdays: option.weekdays.length === 0 ? "Pick at least one day" : null,
    hours:
      option.limitHours && (!TIME.test(option.startTime) || !TIME.test(option.endTime))
        ? "Pick a start and an end time, or switch off Limit the hours"
        : option.limitHours && option.startTime === option.endTime
          ? "Start and end can't be the same time"
          : null,
    idLabel: option.idCheck && option.idLabel.trim().length === 0 ? "Say what ID to ask for" : null,
    guestMax:
      option.guestMax < 1
        ? "Allow at least 1 guest"
        : dailyLimit !== null && dailyLimit > 0 && option.guestMax > dailyLimit
          ? `Can't be more than your ${dailyLimit.toLocaleString("en-GB")} guests a day`
          : null,
    busy: busyBad ? "Each busy-time price needs days, a start, an end and a price" : null,
    pass:
      option.multiDay && (option.passDays < 2 || option.passDays > 60)
        ? "Days must be between 2 and 60"
        : option.multiDay && (option.passWindowDays < option.passDays || option.passWindowDays > 365)
          ? "Within must be at least Days, and no more than 365"
          : null,
  };
}

export function optionHasIssue(option: PriceOptionDraft, dailyLimit: number | null): boolean {
  return Object.values(optionIssues(option, dailyLimit)).some((v) => v !== null);
}

export type EntryStepId = "basics" | "prices" | "capacity" | "rules" | "review";

export const ENTRY_STEPS: ReadonlyArray<{ id: EntryStepId; label: string }> = [
  { id: "basics", label: "Basics" },
  { id: "prices", label: "Price options" },
  { id: "capacity", label: "Capacity" },
  { id: "rules", label: "Rules" },
  { id: "review", label: "Review" },
];

/** A clickable wizard step must not bypass the save for the step being edited. */
export function shouldSaveEntryStepBeforeNavigation(
  dirty: boolean,
  current: EntryStepId,
  next: EntryStepId,
): boolean {
  return dirty && current !== "review" && current !== next;
}

/** The first problem on a step, in plain words (null = the step is complete). */
export function entryStepIssue(step: EntryStepId, draft: EntryDraft): string | null {
  if (step === "basics") {
    if (draft.name.trim().length === 0) return "Name this offer";
    return null;
  }
  if (step === "prices") {
    if (draft.options.length === 0) return "Add a price option";
    const index = draft.options.findIndex((o) => optionHasIssue(o, draft.dailyLimit > 0 ? draft.dailyLimit : null));
    if (index < 0) return null;
    const option = draft.options[index];
    const issues = optionIssues(option, draft.dailyLimit > 0 ? draft.dailyLimit : null);
    return `Fix ${optionNameOrDefault(option.name, index)}`;
  }
  if (step === "capacity") {
    if (draft.style === "timed_session") {
      if (draft.sessionCapacity < 1) return "Set how many fit in one session";
      if (draft.sessionMinutes < 15) return "Pick how long a session lasts";
      if (TIME.test(draft.startTime) && TIME.test(draft.endTime) && timedSessionStarts(draft).length === 0) {
        return "No session fits between opens and closes";
      }
    }
    if (draft.dailyLimit < 1) return draft.style === "timed_session" ? "Set how many fit in one session" : "Set how many guests a day";
    if (draft.keptForWalkIns > draft.dailyLimit) return "Kept for walk-ins is more than the day limit";
    const maxGuests = Math.max(0, ...draft.options.map((o) => o.guestMax));
    if (maxGuests > draft.dailyLimit) return "A price allows more guests than the day limit";
    if (draft.scheduleWeekdays.length === 0) return "Pick the days it's on sale";
    if (!TIME.test(draft.startTime) || !TIME.test(draft.endTime)) return "Pick when it opens and closes";
    if (draft.style === "timed_session" && draft.sessionMinutes < 15) return "Pick how long a session lasts";
    return null;
  }
  if (step === "rules") {
    if (draft.refundPreset === "custom") {
      if (draft.customLadder.length === 0) return "Add a refund rule, or pick No refunds";
      const minutes = draft.customLadder.map((r) => r.minMinutesBefore);
      if (new Set(minutes).size !== minutes.length) return "Two refund rules have the same time";
      if (draft.customLadder.some((r) => r.refundBps < 0 || r.refundBps > 10000)) return "A refund can't be more than 100%";
    }
    return null;
  }
  return null;
}

// ------------------------------------------------------------- payloads

/** #4490 fix 2 (N58): the name used when the host left it blank. */
export function optionNameOrDefault(name: string, index: number): string {
  const trimmed = name.trim();
  if (trimmed.length > 0) return trimmed;
  if (index === 0) return "Entry";
  return index === 1 ? "Guest" : `Guest ${index}`;
}

export function optionPayload(option: PriceOptionDraft, sortOrder: number): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: optionNameOrDefault(option.name, sortOrder),
    unit: "guest",
    guestMin: 1,
    guestMax: Math.max(1, option.guestMax),
    priceMinor: option.free ? 0 : option.priceMinor ?? 0,
    weekdays: [...option.weekdays].sort((a, b) => a - b),
    eligibility: option.idCheck ? { label: option.idLabel.trim(), checkAtGate: true } : null,
    busyRules: option.busyRules.map((r) => ({
      weekdays: [...r.weekdays].sort((a, b) => a - b),
      from: r.from,
      to: r.to,
      amount_minor: r.amountMinor ?? 0,
    })),
    sortOrder,
  };
  if (option.id !== null) payload.optionId = option.id;
  if (option.multiDay) {
    payload.passDays = option.passDays;
    payload.passWindowDays = option.passWindowDays;
  }
  if (option.limitHours) {
    payload.startTime = option.startTime;
    payload.endTime = option.endTime;
  }
  return payload;
}

/** True when a saved option differs from its draft (only changed options are re-sent). */
export function optionChanged(option: PriceOptionDraft, saved: VenuePriceOption | undefined, sortOrder: number): boolean {
  if (saved === undefined) return true;
  const a = optionPayload(option, sortOrder);
  const b = optionPayload(optionDraftFrom(saved), saved.sortOrder);
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function schedulePayload(draft: EntryDraft): Record<string, unknown> {
  const base: Record<string, unknown> = {
    mode: draft.style === "timed_session" ? "sessions" : "full_day",
    weekdays: [...draft.scheduleWeekdays].sort((a, b) => a - b),
    startTime: draft.startTime,
    endTime: draft.endTime,
  };
  // #4490 fix 2 (N82): "Runs until" — the server stops making days after it.
  if (/^\d{4}-\d{2}-\d{2}$/.test(draft.endDate)) base.endDate = draft.endDate;
  if (draft.style === "timed_session") {
    base.sessionMinutes = draft.sessionMinutes;
    base.sessionEveryMinutes = draft.sessionEveryMinutes;
  }
  return base;
}

// --------------------------------------------- timed sessions (N82)

function minutesOf(hhmm: string): number | null {
  if (!TIME.test(hhmm)) return null;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function clockOf(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Session start times in one day: from Opens, a new one every interval, the
 * last one ending by Closes (a close at or before the open runs past midnight).
 * The same rule the server uses to make the day's windows.
 */
export function timedSessionStarts(
  draft: Pick<EntryDraft, "startTime" | "endTime" | "sessionMinutes" | "sessionEveryMinutes">,
): string[] {
  const open = minutesOf(draft.startTime);
  let close = minutesOf(draft.endTime);
  if (open === null || close === null) return [];
  if (close <= open) close += 1440;
  const length = Math.max(15, draft.sessionMinutes);
  const every = Math.max(15, draft.sessionEveryMinutes);
  const starts: string[] = [];
  for (let t = open; t + length <= close && starts.length < 200; t += every) starts.push(clockOf(t));
  return starts;
}

/** Guests a day for a timed offer: sessions × guests per session. */
export function timedDayTotal(draft: EntryDraft): number {
  return timedSessionStarts(draft).length * Math.max(0, draft.sessionCapacity);
}

/** "10:00, 10:30 … 17:30 · 16 sessions · 25 each" (null when no session fits). */
export function timedSessionPreview(draft: EntryDraft): string | null {
  const starts = timedSessionStarts(draft);
  if (starts.length === 0) return null;
  const head =
    starts.length <= 3 ? starts.join(", ") : `${starts[0]}, ${starts[1]} … ${starts[starts.length - 1]}`;
  return `${head} · ${starts.length} ${starts.length === 1 ? "session" : "sessions"} · ${draft.sessionCapacity} each`;
}

// ------------------------------------------------------ summaries (copy)

export function minutesBeforeLabel(minutes: number): string {
  if (minutes <= 0) return "until it starts";
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? "24 hours before" : `${d} days before`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "1 hour before" : `${h} hours before`;
  }
  return `${minutes} min before`;
}

export function refundSummary(ladder: readonly RefundRung[]): string {
  if (ladder.length === 0) return "No refunds";
  return [...ladder]
    .sort((a, b) => b.minMinutesBefore - a.minMinutesBefore)
    .map((r) => {
      const pct = r.refundBps === 10000 ? "Full refund" : r.refundBps === 0 ? "No refund" : `${r.refundBps / 100}% back`;
      return r.minMinutesBefore <= 0 ? `${pct} until it starts` : `${pct} up to ${minutesBeforeLabel(r.minMinutesBefore)}`;
    })
    .join(", then ");
}

export function dateChangeSummary(rule: DateChangeRule | null): string {
  if (rule === null || rule.allowedUntilMinutesBefore === null) return "Guests can't move to another day";
  return `Move to another day up to ${minutesBeforeLabel(rule.allowedUntilMinutesBefore)}, once, free`;
}

export function timeRangeLabel(start: string | null, end: string | null): string | null {
  if (start === null || end === null) return null;
  if (end === "00:00") return `${start} until 00:00`;
  return `${start}–${end}${end <= start ? " (next day)" : ""}`;
}

/** "₦4,000 per guest · Mon to Thu · ID check". */
export function optionSummary(option: VenuePriceOption, currency: string | null): string {
  const parts = [option.priceMinor === 0 ? "Free" : `${money(option.priceMinor, currency)} per guest`, weekdaysSummary(option.weekdays)];
  const hours = timeRangeLabel(option.startTime, option.endTime);
  if (hours !== null) parts.push(hours);
  if (option.eligibility !== null) parts.push(`${option.eligibility.label} checked at the gate`);
  if (option.passDays != null && option.passWindowDays != null) {
    parts.push(multiDayPassSummary(option.passDays, option.passWindowDays));
  }
  // #4490 fix 2 (N77): the most guests on one booking.
  parts.push(`up to ${option.guestMax} on one booking`);
  return parts.join(" · ");
}

export function multiDayPassSummary(days: number, windowDays: number, capital = false): string {
  const text = days === windowDays
    ? `${days} days in a row`
    : `any ${days} days within ${windowDays} days from the start day`;
  return capital ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

/**
 * Lowest price label for the list ("₦4,000 per guest", "from ₦4,000").
 * #4490 W3 fix 2 (W3-N16): a live offer's lowest price is the server's guest
 * "from" (`offer.guestFrom`, the one owner the guest page and card read), so
 * the Host list and the guest page never show two prices for one offer; a
 * draft or paused offer (no guest "from") lists the host's own prices.
 */
export function priceColumn(offer: VenueOffer, currency: string | null): string {
  if (offer.options.length === 0) return "No price yet";
  const guest = offer.guestFrom ?? null;
  const ownLowest = Math.min(...offer.options.map((o) => o.priceMinor));
  if (offer.kind === "private_hire") {
    const lowest = guest?.fromMinor ?? ownLowest;
    const max = Math.max(...offer.options.map((o) => o.guestMax));
    const perGuest = guest !== null ? guest.unit === "guest" : offer.options.some((o) => o.unit === "guest");
    // #4490 N68: a weekend price is named with its days, never folded into "from".
    const dayPrices = offer.options.filter((o) => o.weekdays.length > 0 && o.weekdays.length < 7);
    const days =
      dayPrices.length > 0
        ? ` · ${dayPrices.map((o) => `${weekdaysSummary(o.weekdays)} ${money(o.priceMinor, currency)}`).join(", ")}`
        : "";
    return `from ${money(lowest, currency)}${perGuest ? " a guest" : ""}${days} · up to ${max.toLocaleString("en-GB")} guests`;
  }
  if (offer.kind === "by_the_hour") {
    const lowest = guest?.fromMinor ?? ownLowest;
    return `${lowest !== ownLowest ? "from " : ""}${money(lowest, currency)} an hour`;
  }
  if (offer.kind === "group_package") {
    const lowest = guest?.fromMinor ?? ownLowest;
    const perGroup =
      guest !== null ? guest.unit === "booking" : offer.options.length === 1 && offer.options[0].unit === "booking";
    const min = Math.min(...offer.options.map((o) => o.guestMin));
    const max = Math.max(...offer.options.map((o) => o.guestMax));
    const several = offer.options.length > 1 || lowest !== ownLowest;
    const price = perGroup
      ? `${several ? "from " : ""}${money(lowest, currency)} a group`
      : `${several ? "from " : ""}${money(lowest, currency)} a guest`;
    return `${price} · ${min}–${max} guests`;
  }
  const prices = offer.options.map((o) => o.priceMinor);
  // The guest "from" may be a busy-time price below every listed price.
  const lowest = guest?.fromMinor ?? Math.min(...prices);
  if (lowest === 0 && prices.every((p) => p === 0)) return "Free";
  // #4490 fix 2 (N77): a free option beside paid ones reads "Free – ₦x"
  // (the lowest paid price), never "from ₦0".
  const paid = prices.filter((p) => p > 0);
  if (lowest === 0) {
    const cheapest = Math.min(...paid);
    return `Free – ${money(cheapest, currency)}${new Set(paid).size > 1 ? "+" : ""} per guest`;
  }
  const label = `${money(lowest, currency)} per guest`;
  return new Set(prices).size > 1 || lowest !== Math.min(...prices) ? `from ${label}` : label;
}

export function whenColumn(offer: VenueOffer): string {
  if (offer.kind === "private_hire") {
    const sessions = offer.hire?.sessions ?? [];
    if (sessions.length === 0) return "No sessions yet";
    const days = weekdaysSummary(sessions[0].weekdays);
    return `${days} · ${sessions.map((s) => s.label).join(", ")}`;
  }
  if (offer.kind === "group_package") {
    if (offer.startTimes.length === 0) return "No start times yet";
    const days = weekdaysSummary(offer.schedule?.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
    const hours = offer.durationMinutes !== null && offer.durationMinutes % 60 === 0 ? `${offer.durationMinutes / 60} h` : `${offer.durationMinutes ?? 0} min`;
    return `${days} · starts ${offer.startTimes.join(", ")} · ${hours}`;
  }
  const s = offer.schedule;
  if (s === null) return "No times yet";
  const days = weekdaysSummary(s.weekdays);
  const hours = timeRangeLabel(s.startTime, s.endTime);
  if (s.mode === "sessions" && s.sessionMinutes !== null) {
    return `${days} · ${s.sessionMinutes} min sessions${hours !== null ? ` · ${hours}` : ""}`;
  }
  return hours === null ? days : `${days} · ${hours}`;
}

export function kindLine(offer: VenueOffer): string {
  if (offer.kind === "private_hire") {
    // The places the host priced (a combination counts once, not its parts).
    const priced = new Set((offer.hire?.rows ?? []).map((r) => r.spaceId ?? r.combinationId ?? r.optionId)).size;
    const places = priced > 0 ? priced : (offer.hire?.combinations.length ?? 0) + (offer.hire?.spaces.length ?? 0);
    return `Private hire · ${places} ${places === 1 ? "space" : "spaces"} · ${offer.confirmationMode === "request" ? "request first" : "book instantly"}`;
  }
  if (offer.kind === "by_the_hour") {
    const places = offer.hour?.places ?? [];
    const length = offer.hour?.minMinutes != null ? ` · from ${offer.hour.minMinutes >= 60 && offer.hour.minMinutes % 60 === 0 ? `${offer.hour.minMinutes / 60} h` : `${offer.hour.minMinutes} min`}` : "";
    return `By the hour · ${places.length} ${places.length === 1 ? "place" : "places"}${length}`;
  }
  if (offer.kind === "group_package") {
    const min = offer.options.length > 0 ? Math.min(...offer.options.map((o) => o.guestMin)) : null;
    const max = offer.options.length > 0 ? Math.max(...offer.options.map((o) => o.guestMax)) : null;
    return `Group package${min !== null && max !== null ? ` · ${min}–${max} guests` : ""}${offer.deposit !== null && offer.deposit.kind !== "none" ? " · deposit" : ""}`;
  }
  const style = offer.kind === "entry" ? entryStyleLabel(offer.entryStyle) : OFFER_KIND_LABEL[offer.kind];
  const id = offer.options.some((o) => o.eligibility !== null) ? " · ID checked at the gate" : "";
  return `${OFFER_KIND_LABEL[offer.kind]}${offer.kind === "entry" ? ` · ${style}` : ""}${id}`;
}

// ------------------------------------------------- readiness and errors

export interface ReadinessLine {
  text: string;
  step: EntryStepId | null;
}

export function readinessLine(reason: string): ReadinessLine {
  switch (reason) {
    case "feature_off":
      return { text: "Entry is switched off for this venue. Turn it on in Settings › Venue type and features.", step: null };
    case "no_price_option":
      return { text: "Add at least one price option.", step: "prices" };
    case "no_policy":
      return { text: "Choose your refund rules.", step: "rules" };
    case "no_schedule":
      return { text: "Set the days and times it's on sale.", step: "capacity" };
    case "no_day_limit":
      return { text: "Set how many guests can come a day.", step: "capacity" };
    case "guest_max_over_capacity":
      return { text: "A price allows more guests on one booking than the day limit.", step: "prices" };
    case "no_spaces":
      return { text: "Pick the spaces it uses.", step: "basics" };
    case "no_hours":
      return { text: "Set the days and hours it can be booked.", step: null };
    case "option_unit_invalid":
      return { text: "The price must be per hour.", step: null };
    case "stay_venue":
      return { text: "Stays can't sell offers yet.", step: null };
    case "kind_not_available_yet":
    case "deposit_not_available_yet":
      return { text: "This kind of offer can't be sold yet.", step: null };
    default:
      return { text: "Something on this offer still needs finishing.", step: null };
  }
}

/** Plain words for a server refusal on the host side. Never a raw code. */
export function offerErrorCopy(code: string, detail: string | null = null): string {
  switch (code) {
    case "not_authorized":
    case "forbidden":
      return "You don't have permission to change offers at this venue. Ask a brand owner or admin.";
    case "offers_not_enabled":
      return "Selling offers isn't switched on for your brand yet.";
    case "offer_not_on_stay_venue":
      return "Stays can't sell offers yet.";
    case "venue_not_found":
      return "This venue was removed.";
    case "offer_not_found":
      return "This offer was removed. We've loaded the latest list.";
    case "stale_write":
      return "Someone else saved this first. Reload to see their changes, then try again.";
    case "offer_archived":
      return "This offer was archived, so it can't be changed.";
    case "offer_name_required":
      return "Name this offer.";
    case "entry_style_required":
      return "Pick Walk-in, Day pass or Timed session.";
    case "session_capacity_required":
      return "Set how many fit in one session.";
    case "pool_daily_limit_invalid":
      return "Set a day limit from 1 to 100,000 guests.";
    case "pool_kept_invalid":
    case "pool_kept_over_limit":
      return "Kept for walk-ins can't be more than the day limit.";
    case "pool_limit_below_option_max":
      return "The day limit is lower than the most guests a price allows on one booking.";
    case "pool_not_found":
      return "That day limit was removed. We've loaded the latest.";
    case "pool_in_use":
      return "Another offer still uses this day limit.";
    case "option_name_required":
      return "Give every price a name guests will recognise.";
    case "option_guests_invalid":
      return "Check the number of guests on each price.";
    case "option_price_invalid":
      return "Enter a price, or switch the option to free.";
    case "option_weekdays_invalid":
      return "Pick at least one day for each price.";
    case "option_times_invalid":
      return "Each price needs both a start and an end time, or neither.";
    case "option_eligibility_invalid":
      return "Say what ID to ask for at the gate.";
    case "option_busy_rules_invalid":
      return "Each busy-time price needs days, a start, an end and a price.";
    case "option_not_found":
      return "That price was removed. We've loaded the latest.";
    case "offer_needs_one_option":
      return "A live offer needs at least one price. Add another before removing this one.";
    case "refund_ladder_invalid":
      return "Check your refund rules: each needs a different time and at most 100% back.";
    case "date_change_rule_invalid":
      return "Check the rule for moving to another day.";
    case "schedule_mode_invalid":
    case "schedule_times_invalid":
      return "Pick when it opens and closes.";
    case "schedule_weekdays_invalid":
      return "Pick the days it's on sale.";
    case "schedule_sessions_invalid":
      return "Sessions must be between 15 minutes and 24 hours.";
    case "offer_not_ready":
      return `Not ready to publish yet. ${readinessLine(detail ?? "").text}`;
    case "offer_invalid_transition":
      return "That change isn't possible from its current state. We've loaded the latest.";
    case "override_invalid":
      return "Pick a date and a limit from 0 to 100,000.";
    case "booking_settings_invalid":
      return "Hold time must be 5 to 60 minutes and the booking window 1 to 730 days.";
    case "offer_idempotency_conflict":
    case "idempotency_key_invalid":
      return "That didn't go through. Try again.";
    case "network":
      return "You're offline or the connection dropped. Your changes are still here, so try again.";
    // #4490 P3 — group packages
    case "inclusions_invalid":
      return "Check what's included: each line needs words, and a question needs 2 to 10 options.";
    case "inclusion_menu_item_not_found":
      return "One of the menu items was removed. Pick it again from your menu.";
    case "extras_invalid":
      return "Check your extras: each needs a name and a price, and you can have up to 20.";
    case "staff_role_label_invalid":
      return "Name the staff role in 60 characters or fewer.";
    case "deposit_invalid":
      return "Check the deposit: 1% to 99%, or an amount, and when the rest is due.";
    case "offer_kind_invalid":
      return "That setting is for group packages only.";
    case "option_unit_invalid":
      return "Check how the price is charged.";
    case "notice_invalid":
      return "Pick how far ahead groups must book.";
    case "pool_not_for_kind":
      return "This kind of offer can't use the day limit.";
    // #4490 P3 — bookings and money
    case "offer_amount_over_balance":
      return "That's more than they still owe. Lower the amount.";
    case "offer_nothing_to_pay":
      return "Nothing is owed on this booking.";
    case "offer_reminder_too_soon":
      return "A reminder went out in the last 10 minutes. Try again a little later.";
    case "offer_guest_email_required":
      return "This booking has no email, so a reminder can't be sent. Call or message the guest instead.";
    case "offer_change_not_allowed":
      return "This booking can't be changed that way.";
    case "offer_change_too_late":
      return "It's too late to change this booking.";
    case "offer_change_nothing":
      return "That's the same as the booking now. Change something first.";
    case "offer_sold_out":
      return "There isn't room for that many on that day.";
    case "offer_window_unavailable":
      return "That time is no longer available. Pick another.";
    case "offer_guests_out_of_range":
      return "That number of guests is outside this package's group size.";
    case "offer_extra_unavailable":
      return "That extra is no longer offered.";
    case "offer_booking_not_found":
      return "This booking was removed or isn't at this venue.";
    case "offer_cancel_preview_invalid":
      return "The refund changed. Check it again before you cancel.";
    case "offer_amount_too_large":
      return "This payment is too large to take in one go. Ask for a smaller deposit, or record it as paid to the venue.";
    case "balance_link_unavailable":
      return "This booking's pay link can't be shown here. Take the money at the door instead.";
    // #4490 P4 follow-ups: changing a hire, the damage deposit, "Hours you set".
    case "offer_space_taken":
      return "That space is already booked then (setup and cleanup count too). Pick another day or time.";
    case "offer_capacity_conflict":
      return "That day's guest limit is already used up. Pick another day.";
    case "deposit_release_too_early":
      return "The damage deposit can be returned once the hire has ended.";
    case "deposit_nothing_to_release":
      return "There's no damage deposit held for this booking.";
    case "deposit_keep_invalid":
      return "You can keep at most what the guest paid as a damage deposit.";
    case "deposit_keep_reason_required":
      return "Say why you're keeping part of the damage deposit (3 to 500 characters). The guest sees it.";
    case "deposit_hold_reason_required":
      return "Say why you're holding the damage deposit (3 to 500 characters).";
    case "hire_flexible_invalid":
      return "Check \"Hours you set\": a start and an end, and a shortest booking of at least 30 minutes that fits the steps.";
    default:
      return "Couldn't save. Your changes are still here, so try again.";
  }
}

// --------------------------------------------------------- the gate

/** The venue's weekday (0 = Monday) and HH:MM right now, in its own timezone. */
export function venueClock(timezone: string, now: Date = new Date()): { weekday: number; time: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const weekday = names.indexOf(get("weekday"));
    return { weekday: weekday < 0 ? (now.getDay() + 6) % 7 : weekday, time: `${get("hour")}:${get("minute")}` };
  } catch {
    return {
      weekday: (now.getDay() + 6) % 7,
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    };
  }
}

function inWindow(time: string, from: string, to: string): boolean {
  if (from === to) return true;
  return from < to ? time >= from && time < to : time >= from || time < to;
}

/** Can this price be sold at the gate right now? */
export function optionSellableNow(option: VenuePriceOption, clock: { weekday: number; time: string }): boolean {
  if (!option.weekdays.includes(clock.weekday)) return false;
  if (option.startTime !== null && option.endTime !== null && !inWindow(clock.time, option.startTime, option.endTime)) {
    return false;
  }
  return true;
}

/** The price that applies now (a busy-time price replaces the base price). */
export function priceNow(option: VenuePriceOption, clock: { weekday: number; time: string }): number {
  const rule = option.busyRules.find(
    (r: BusyRule) => r.weekdays.includes(clock.weekday) && inWindow(clock.time, r.from, r.to),
  );
  return rule?.amountMinor ?? option.priceMinor;
}

export interface GateEstimate {
  lines: Array<{ name: string; guests: number; amountMinor: number }>;
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  guests: number;
}

/** What the gate sale will cost (the server computes the final total; it uses the same rules). */
export function gateEstimate(input: {
  options: readonly VenuePriceOption[];
  counts: Readonly<Record<string, number>>;
  vatMode: VatMode;
  vatRateBps: number | null;
  clock: { weekday: number; time: string };
}): GateEstimate {
  const lines = input.options
    .filter((o) => (input.counts[o.id] ?? 0) > 0)
    .map((o) => ({ name: o.name, guests: input.counts[o.id] ?? 0, amountMinor: priceNow(o, input.clock) * (input.counts[o.id] ?? 0) }));
  const subtotal = lines.reduce((sum, l) => sum + l.amountMinor, 0);
  const rate = input.vatRateBps ?? 0;
  let vat = 0;
  if (input.vatMode === "added") vat = Math.round((subtotal * rate) / 10000);
  else if (input.vatMode === "included") vat = Math.round(subtotal - subtotal / (1 + rate / 10000));
  return {
    lines,
    subtotalMinor: subtotal,
    vatMinor: vat,
    totalMinor: input.vatMode === "added" ? subtotal + vat : subtotal,
    guests: lines.reduce((sum, l) => sum + l.guests, 0),
  };
}

// ----------------------------------------------------------- day limits

export interface DayLimitDraft {
  poolId: string;
  localDate: string;
  closed: boolean;
  dailyLimit: number;
  keptForWalkIns: number;
}

export function overrideLine(o: CapacityOverride, pool: VenueCapacityPool | undefined): string {
  if (o.closed) return "No entry that day";
  const limit = o.dailyLimit ?? pool?.dailyLimit ?? 0;
  const kept = o.keptForWalkIns ?? pool?.keptForWalkIns ?? 0;
  return `${limit.toLocaleString("en-GB")} guests · ${kept.toLocaleString("en-GB")} kept for walk-ins`;
}

export function dayLimitIssue(draft: DayLimitDraft, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.localDate)) return "Pick a date.";
  if (draft.localDate < today) return "Pick today or a later date.";
  if (!draft.closed && draft.keptForWalkIns > draft.dailyLimit) return "Kept for walk-ins can't be more than the day's limit.";
  return null;
}

