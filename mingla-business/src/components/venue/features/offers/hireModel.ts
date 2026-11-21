/**
 * #4490 P4-2 — the Private hire editor (`ed-hire-times`, `ed-hire`,
 * `ed-hire-terms`, `ed-hire-book`): drafts, validation, payloads and plain
 * words (pure; no React, no services). Money is minor units of the brand
 * currency; weekdays are 0 = Monday; times are 24 h "HH:MM".
 *
 * A hire takes a whole space (or a named combination) for a session, plus
 * setup time before and cleanup time after. Price rows sit on one place and
 * one group size each; a row's largest group can't be more than its place
 * holds. Request first is the default (the venue answers before anything is
 * held). Reply and pay windows are venue-wide (reconciliation conflict 43).
 */
import type { HireCharge, HireHoursYouSet, RefundRung, VenueOffer } from "../../../../types/venueOffers";
import type { VenueSpace, VenueSpaceCombination } from "../../../../services/venueFeaturesService";
import {
  VENUE_LAYOUTS,
  venueLayoutLabel,
  type VenueLayout,
} from "@mingla/brand-rendering/venueOffers/layoutModel";
import { weekdaysSummary } from "../../../ui/fieldModels";
import { draftKey, minutesBeforeLabel, money, refundSummary } from "./offersModel";
import { extraIssue, type ExtraDraft } from "./packageModel";

// ---------------------------------------------------------------- steps

export type HireStepId = "spaces" | "times" | "price" | "extras" | "terms" | "book" | "review";

export const HIRE_STEPS: ReadonlyArray<{ id: HireStepId; label: string }> = [
  { id: "spaces", label: "Spaces" },
  { id: "times", label: "Times" },
  { id: "price", label: "Price" },
  { id: "extras", label: "Extras" },
  { id: "terms", label: "Deposit and terms" },
  { id: "book", label: "How guests book" },
  { id: "review", label: "Review" },
];

// ---------------------------------------------------------------- words

export const HIRE_CHARGES: ReadonlyArray<{ key: HireCharge; label: string; column: string; helper: string }> = [
  { key: "hire_fee", label: "A hire fee", column: "Hire fee", helper: "One price for the place." },
  { key: "min_spend", label: "A minimum spend", column: "Minimum spend", helper: "What the group spends at least, on the day." },
  { key: "per_guest", label: "Per guest", column: "Price per guest", helper: "A price for each guest." },
];

export const SESSION_PRESETS: ReadonlyArray<{ key: string; label: string; startTime: string; endTime: string }> = [
  { key: "full_day", label: "Full day", startTime: "12:00", endTime: "00:00" },
  { key: "evening", label: "Evening", startTime: "18:00", endTime: "00:00" },
  { key: "afternoon", label: "Afternoon", startTime: "12:00", endTime: "17:00" },
];

export const BUFFER_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "None" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1½ hours" },
  { value: 120, label: "2 hours" },
  { value: 180, label: "3 hours" },
  { value: 240, label: "4 hours" },
  { value: 360, label: "6 hours" },
];

export const NOTICE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "Any time before" },
  { value: 1440, label: "1 day ahead" },
  { value: 2880, label: "2 days ahead" },
  { value: 4320, label: "3 days ahead" },
  { value: 10080, label: "7 days ahead" },
  { value: 20160, label: "14 days ahead" },
  { value: 43200, label: "30 days ahead" },
];

export const ADVANCE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 90, label: "3 months ahead" },
  { value: 180, label: "6 months ahead" },
  { value: 365, label: "12 months ahead" },
  { value: 730, label: "2 years ahead" },
];

export const HIRE_BALANCE_DUE: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "On the day" },
  { value: 3, label: "3 days before" },
  { value: 7, label: "7 days before" },
  { value: 14, label: "14 days before" },
  { value: 30, label: "30 days before" },
  { value: 60, label: "60 days before" },
];

export const REPLY_WINDOWS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 12, label: "12 hours" },
  { value: 24, label: "24 hours" },
  { value: 48, label: "48 hours" },
  { value: 72, label: "72 hours" },
  { value: 168, label: "1 week" },
];

export const PAY_WINDOWS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1440, label: "24 hours" },
  { value: 2880, label: "48 hours" },
  { value: 4320, label: "72 hours" },
  { value: 10080, label: "1 week" },
];

export type HireRefundPreset = "flexible" | "standard" | "strict" | "custom";

const DAY = 1440;

export const HIRE_REFUND_PRESETS: ReadonlyArray<{ key: HireRefundPreset; label: string; ladder: RefundRung[] }> = [
  {
    key: "flexible",
    label: "Flexible",
    ladder: [
      { minMinutesBefore: 7 * DAY, refundBps: 10000 },
      { minMinutesBefore: 0, refundBps: 5000 },
    ],
  },
  {
    key: "standard",
    label: "Standard",
    ladder: [
      { minMinutesBefore: 30 * DAY, refundBps: 7500 },
      { minMinutesBefore: 15 * DAY, refundBps: 5000 },
      { minMinutesBefore: 7 * DAY, refundBps: 2500 },
    ],
  },
  {
    key: "strict",
    label: "Strict",
    ladder: [{ minMinutesBefore: 30 * DAY, refundBps: 5000 }],
  },
  { key: "custom", label: "Your own", ladder: [] },
];

// ---------------------------------------------------------------- drafts

export interface HireSessionDraft {
  key: string;
  label: string;
  startTime: string;
  endTime: string;
}

/** A place is "s:<spaceId>" or "c:<combinationId>". */
export type PlaceKey = string;

export interface HireRowDraft {
  key: string;
  /** Kept across edits (bookings point at it). Null = new. */
  optionId: string | null;
  place: PlaceKey | null;
  guestMin: number;
  guestMax: number;
  priceMinor: number | null;
  /** Empty = every day. */
  weekdays: number[];
  /** #4490 P4 follow-up: price x booked hours (sessions count their own length). */
  perHour: boolean;
}

/** #4490 P4 follow-up: "Hours you set" — the guest picks a start and a length. */
export const FLEX_STEP_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 60, label: "On the hour" },
  { value: 30, label: "Every 30 minutes" },
  { value: 15, label: "Every 15 minutes" },
];

export const FLEX_MIN_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 180, label: "3 hours" },
  { value: 240, label: "4 hours" },
  { value: 360, label: "6 hours" },
  { value: 480, label: "8 hours" },
];

export const FLEX_MAX_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "No limit" },
  { value: 240, label: "4 hours" },
  { value: 360, label: "6 hours" },
  { value: 480, label: "8 hours" },
  { value: 720, label: "12 hours" },
  { value: 1440, label: "24 hours" },
];

export interface HireDraft {
  name: string;
  summary: string;
  spaceIds: string[];
  combinationIds: string[];
  /** Fixed room setups guests may choose for this hire. */
  layouts: VenueLayout[];
  sessions: HireSessionDraft[];
  weekdays: number[];
  flexOn: boolean;
  flexStart: string;
  flexEnd: string;
  flexStep: number;
  flexMinMinutes: number;
  /** 0 = no limit. */
  flexMaxMinutes: number;
  setupMinutes: number;
  cleanupMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  charge: HireCharge;
  rows: HireRowDraft[];
  extraGuestOn: boolean;
  extraGuestMinor: number | null;
  overtimeOn: boolean;
  overtimeMinorPerHour: number | null;
  /** Paid add-ons guests choose while requesting the hire. */
  extras: ExtraDraft[];
  depositOn: boolean;
  depositKind: "percent" | "fixed";
  depositPercent: number;
  depositFixedMinor: number | null;
  balanceDueDaysBefore: number;
  damageDepositMinor: number | null;
  refundPreset: HireRefundPreset;
  customLadder: RefundRung[];
  /** #4490 P4 follow-up: guests may change their numbers online until a cut-off. */
  guestChangeOn: boolean;
  guestChangeCutoffMinutes: number;
  /** Guests may move the hire to another day online (the same space must be free). */
  dateChange: boolean;
  moveCutoffMinutes: number;
  maxChanges: number;
  changeFeePercent: number;
  mode: "request" | "instant";
  requestResponseHours: number;
  approvedPaymentMinutes: number;
}

export const placeKey = (kind: "space" | "combination", id: string): PlaceKey => `${kind === "space" ? "s" : "c"}:${id}`;

export function parsePlaceKey(key: PlaceKey | null): { spaceId: string | null; combinationId: string | null } {
  if (key === null) return { spaceId: null, combinationId: null };
  if (key.startsWith("s:")) return { spaceId: key.slice(2), combinationId: null };
  if (key.startsWith("c:")) return { spaceId: null, combinationId: key.slice(2) };
  return { spaceId: null, combinationId: null };
}

export function emptyHireRow(place: PlaceKey | null = null): HireRowDraft {
  return { key: draftKey("hire-row"), optionId: null, place, guestMin: 1, guestMax: 1, priceMinor: null, weekdays: [], perHour: false };
}

export function sessionFromPreset(key: string): HireSessionDraft {
  const p = SESSION_PRESETS.find((s) => s.key === key) ?? SESSION_PRESETS[0];
  return { key: draftKey("session"), label: p.label, startTime: p.startTime, endTime: p.endTime };
}

const sameLadder = (a: readonly RefundRung[], b: readonly RefundRung[]): boolean =>
  a.length === b.length && a.every((r, i) => r.minMinutesBefore === b[i].minMinutesBefore && r.refundBps === b[i].refundBps);

export function hirePresetFor(ladder: readonly RefundRung[]): HireRefundPreset {
  const sorted = [...ladder].sort((a, b) => b.minMinutesBefore - a.minMinutesBefore);
  for (const p of HIRE_REFUND_PRESETS) if (p.key !== "custom" && sameLadder(p.ladder, sorted)) return p.key;
  return "custom";
}

export function hireLadder(draft: Pick<HireDraft, "refundPreset" | "customLadder">): RefundRung[] {
  if (draft.refundPreset === "custom") return [...draft.customLadder].sort((a, b) => b.minMinutesBefore - a.minMinutesBefore);
  return HIRE_REFUND_PRESETS.find((p) => p.key === draft.refundPreset)?.ladder ?? [];
}

/** The editor's starting point: the recommended defaults (spec B §8 Q6) or the saved offer. */
/** #4490 fix 2 (N83): the setup and cleanup a new hire starts with. */
export const HIRE_DEFAULT_SETUP_MINUTES = 180;
export const HIRE_DEFAULT_CLEANUP_MINUTES = 120;

export function hireDraftFrom(offer: VenueOffer | null): HireDraft {
  const h = offer?.hire ?? null;
  const deposit = offer?.deposit ?? null;
  const ladder = offer?.policy?.refundLadder ?? null;
  const rowsSorted = h === null ? [] : h.rows;
  const unitGuest = rowsSorted.some((r) => r.unit === "guest");
  return {
    name: offer?.name ?? "Private hire",
    summary: offer?.summary ?? "",
    spaceIds: h === null ? [] : h.spaces.filter((s) => !h.combinations.some((c) => c.spaceIds.includes(s.id)) || h.rows.some((r) => r.spaceId === s.id)).map((s) => s.id),
    combinationIds: h === null ? [] : h.combinations.map((c) => c.id),
    layouts: h?.layouts ?? [],
    sessions:
      h !== null && h.sessions.length > 0
        ? h.sessions.map((s) => ({ key: draftKey("session"), label: s.label, startTime: s.startTime, endTime: s.endTime }))
        : [sessionFromPreset("full_day")],
    weekdays: h !== null && h.sessions.length > 0 ? [...h.sessions[0].weekdays] : h?.hoursYouSet ? [...h.hoursYouSet.weekdays] : [0, 1, 2, 3, 4, 5, 6],
    flexOn: h?.hoursYouSet != null,
    flexStart: h?.hoursYouSet?.startTime ?? "10:00",
    flexEnd: h?.hoursYouSet?.endTime ?? "22:00",
    flexStep: h?.hoursYouSet?.stepMinutes ?? 60,
    flexMinMinutes: h?.hoursYouSet?.minMinutes ?? 240,
    flexMaxMinutes: h?.hoursYouSet?.maxMinutes ?? 0,
    setupMinutes: h?.setupMinutes ?? HIRE_DEFAULT_SETUP_MINUTES,
    cleanupMinutes: h?.cleanupMinutes ?? HIRE_DEFAULT_CLEANUP_MINUTES,
    minNoticeMinutes: offer?.minNoticeMinutes ?? 10080,
    maxAdvanceDays: offer?.maxAdvanceDays ?? 365,
    charge: h?.charge ?? (unitGuest ? "per_guest" : "hire_fee"),
    rows: rowsSorted.map((r) => ({
      key: draftKey("hire-row"),
      optionId: r.optionId,
      place: r.spaceId !== null ? placeKey("space", r.spaceId) : r.combinationId !== null ? placeKey("combination", r.combinationId) : null,
      guestMin: r.guestMin,
      guestMax: r.guestMax,
      priceMinor: r.priceMinor,
      weekdays: r.weekdays.length === 7 ? [] : [...r.weekdays],
      perHour: r.unit === "hour",
    })),
    extraGuestOn: h?.extraGuestMinor !== null && h?.extraGuestMinor !== undefined,
    extraGuestMinor: h?.extraGuestMinor ?? null,
    overtimeOn: h?.overtimeMinorPerHour !== null && h?.overtimeMinorPerHour !== undefined,
    overtimeMinorPerHour: h?.overtimeMinorPerHour ?? null,
    extras: (offer?.extras ?? []).map((extra) => ({
      key: draftKey("extra"),
      id: extra.id,
      name: extra.name,
      priceMinor: extra.priceMinor,
      per: extra.per,
    })),
    depositOn: deposit === null ? true : deposit.kind !== "none",
    depositKind: deposit?.kind === "fixed" ? "fixed" : "percent",
    depositPercent: deposit?.kind === "percent" && deposit.value !== null ? Math.round(deposit.value / 100) : 50,
    depositFixedMinor: deposit?.kind === "fixed" ? deposit.value : null,
    balanceDueDaysBefore: deposit?.balanceDueDaysBefore ?? 14,
    damageDepositMinor: h === null || h.damageDepositMinor === 0 ? null : h.damageDepositMinor,
    refundPreset: ladder === null ? "standard" : hirePresetFor(ladder),
    customLadder: ladder === null ? [] : [...ladder],
    guestChangeOn: (offer?.policy?.dateChangeRule?.guestChangeUntilMinutesBefore ?? null) !== null,
    guestChangeCutoffMinutes: offer?.policy?.dateChangeRule?.guestChangeUntilMinutesBefore ?? 10080,
    dateChange: (offer?.policy?.dateChangeRule?.allowedUntilMinutesBefore ?? null) !== null,
    moveCutoffMinutes: offer?.policy?.dateChangeRule?.allowedUntilMinutesBefore ?? 10080,
    maxChanges: offer?.policy?.dateChangeRule?.maxChanges ?? 1,
    changeFeePercent:
      offer?.policy?.dateChangeRule?.feeBps !== null && offer?.policy?.dateChangeRule?.feeBps !== undefined ? Math.round(offer.policy.dateChangeRule.feeBps / 100) : 0,
    mode: h?.bookingMode ?? "request",
    requestResponseHours: h?.requestResponseHours ?? 48,
    approvedPaymentMinutes: h?.approvedPaymentMinutes ?? 4320,
  };
}

// ---------------------------------------------------------------- places

export interface HirePlace {
  key: PlaceKey;
  kind: "space" | "combination";
  id: string;
  name: string;
  capacity: number;
  layoutCapacities: Partial<Record<VenueLayout, number>>;
  /** Plain detail: "Covered · 200 standing" or "The Lounge Side + Green Area North". */
  detail: string;
  hirable: boolean;
}

export function spaceCapacity(space: Pick<VenueSpace, "capacityStanding" | "capacitySeated">): number {
  return Math.max(space.capacityStanding ?? 0, space.capacitySeated ?? 0);
}

const SETTING_WORD: Record<string, string> = { indoor: "Indoor", covered: "Covered", outdoor: "Outdoor" };

/** Every place a hire could use: spaces marked "Can be hired", then combinations of them. */
export function hirePlaces(spaces: readonly VenueSpace[], combinations: readonly VenueSpaceCombination[]): HirePlace[] {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const out: HirePlace[] = spaces.map((s) => ({
    key: placeKey("space", s.id),
    kind: "space",
    id: s.id,
    name: s.name,
    capacity: spaceCapacity(s),
    layoutCapacities: {
      ...(s.capacityStanding !== null ? { standing: s.capacityStanding } : {}),
      ...(s.capacitySeated !== null ? { seated: s.capacitySeated } : {}),
      ...Object.fromEntries(s.layouts.map((row) => [row.layout, row.capacity])),
    },
    detail: [SETTING_WORD[s.setting] ?? null, `fits ${spaceCapacity(s).toLocaleString("en-GB")}`].filter(Boolean).join(" · "),
    hirable: s.canBeHired,
  }));
  for (const c of combinations) {
    const parts = c.spaceIds.map((id) => byId.get(id)).filter((s): s is VenueSpace => s !== undefined);
    if (parts.length === 0) continue;
    out.push({
      key: placeKey("combination", c.id),
      kind: "combination",
      id: c.id,
      name: c.name,
      capacity: parts.reduce((n, s) => n + spaceCapacity(s), 0),
      layoutCapacities: Object.fromEntries(
        VENUE_LAYOUTS.flatMap(({ key }) => {
          if (parts.length !== c.spaceIds.length) return [];
          const capacities = parts.map((part) =>
            key === "standing"
              ? part.capacityStanding
              : key === "seated"
                ? part.capacitySeated
                : part.layouts.find((row) => row.layout === key)?.capacity ?? null,
          );
          return capacities.every((capacity): capacity is number => capacity !== null)
            ? [[key, capacities.reduce((total, capacity) => total + capacity, 0)]]
            : [];
        }),
      ),
      detail: `${parts.map((p) => p.name).join(" + ")} · fits ${parts.reduce((n, s) => n + spaceCapacity(s), 0).toLocaleString("en-GB")}`,
      hirable: parts.length === c.spaceIds.length && parts.every((p) => p.canBeHired),
    });
  }
  return out;
}

/** The places this draft offers (picked spaces and combinations). */
export function chosenPlaces(draft: Pick<HireDraft, "spaceIds" | "combinationIds">, places: readonly HirePlace[]): HirePlace[] {
  return places.filter((p) => (p.kind === "space" ? draft.spaceIds.includes(p.id) : draft.combinationIds.includes(p.id)));
}

// ---------------------------------------------------------------- validation

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function sessionIssue(s: HireSessionDraft, all: readonly HireSessionDraft[]): string | null {
  if (s.label.trim().length === 0) return "Name this session";
  if (!TIME.test(s.startTime) || !TIME.test(s.endTime)) return "Pick a start and an end";
  if (s.startTime === s.endTime) return "A session can't start and end at the same time";
  if (all.filter((o) => o.label.trim().toLowerCase() === s.label.trim().toLowerCase()).length > 1) return "Give each session its own name";
  return null;
}

export interface HireRowIssues {
  place: string | null;
  guests: string | null;
  price: string | null;
}

export function rowIssues(row: HireRowDraft, places: readonly HirePlace[]): HireRowIssues {
  const place = row.place === null ? null : places.find((p) => p.key === row.place) ?? null;
  return {
    place: row.place === null || place === null ? "Pick a space" : null,
    guests:
      row.guestMin < 1 || row.guestMax < row.guestMin
        ? "Check the group size"
        : place !== null && row.guestMax > place.capacity
          ? `More than ${place.name} holds (${place.capacity.toLocaleString("en-GB")})`
          : null,
    price: row.priceMinor === null || row.priceMinor <= 0 ? "Enter a price" : null,
  };
}

export function hireStepIssue(step: HireStepId, draft: HireDraft, places: readonly HirePlace[]): string | null {
  switch (step) {
    case "spaces":
      if (draft.name.trim().length === 0) return "Name this offer";
      if (draft.spaceIds.length + draft.combinationIds.length === 0) return "Pick at least one space";
      if (chosenPlaces(draft, places).some((place) => draft.layouts.some((layout) => place.layoutCapacities[layout] === undefined))) {
        return "Add every chosen layout to every space in this hire";
      }
      return null;
    case "times": {
      if (draft.sessions.length === 0) return "Add a session";
      for (const s of draft.sessions) {
        const issue = sessionIssue(s, draft.sessions);
        if (issue !== null) return issue;
      }
      if (draft.weekdays.length === 0) return "Pick the days it can be hired";
      {
        const flex = flexIssue(draft);
        if (flex !== null) return flex;
      }
      if (draft.overtimeOn && (draft.overtimeMinorPerHour === null || draft.overtimeMinorPerHour <= 0)) return "Enter the price per hour for running over";
      return null;
    }
    case "price": {
      const chosen = chosenPlaces(draft, places);
      if (draft.rows.length === 0) return "Add a price for at least one space";
      for (const row of draft.rows) {
        const i = rowIssues(row, chosen);
        if (i.place !== null) return i.place;
        if (i.guests !== null) return i.guests;
        if (i.price !== null) return i.price;
      }
      return null;
    }
    case "extras":
      if (draft.extraGuestOn && (draft.extraGuestMinor === null || draft.extraGuestMinor <= 0)) return "Enter the price per extra guest";
      for (const extra of draft.extras) {
        const issue = extraIssue(extra);
        if (issue !== null) return `${extra.name.trim() || "An extra"}: ${issue}`;
      }
      return null;
    case "terms":
      if (draft.depositOn && draft.depositKind === "percent" && (draft.depositPercent < 1 || draft.depositPercent > 99)) {
        return "A deposit is 1% to 99% of the total";
      }
      if (draft.depositOn && draft.depositKind === "fixed" && (draft.depositFixedMinor === null || draft.depositFixedMinor <= 0)) {
        return "Enter the deposit";
      }
      if (draft.refundPreset === "custom" && new Set(draft.customLadder.map((r) => r.minMinutesBefore)).size !== draft.customLadder.length) {
        return "Each refund rule needs its own time";
      }
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- payloads

export function spacesPayload(draft: HireDraft): Record<string, unknown> {
  return { spaceIds: [...draft.spaceIds], combinationIds: [...draft.combinationIds] };
}

export function layoutsPayload(draft: Pick<HireDraft, "layouts">): Record<string, unknown> {
  return { layouts: [...draft.layouts] };
}

/** "Hours you set" checks, in plain words (null when off or fine). */
export function flexIssue(draft: Pick<HireDraft, "flexOn" | "flexStart" | "flexEnd" | "flexStep" | "flexMinMinutes" | "flexMaxMinutes">): string | null {
  if (!draft.flexOn) return null;
  if (draft.flexStart === draft.flexEnd) return "\"Hours you set\" needs different start and end times";
  const open = flexOpenMinutes(draft.flexStart, draft.flexEnd);
  if (draft.flexMinMinutes > open) return `The shortest booking (${minutesWords(draft.flexMinMinutes)}) is longer than the hours you're open for it`;
  if (draft.flexMinMinutes % draft.flexStep !== 0) return "The shortest booking must fit the start-time steps";
  if (draft.flexMaxMinutes > 0 && draft.flexMaxMinutes < draft.flexMinMinutes) return "The longest booking can't be shorter than the shortest";
  return null;
}

/** Minutes between two clock times; an end at or before the start runs past midnight. */
export function flexOpenMinutes(start: string, end: string): number {
  const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const d = toMin(end) - toMin(start);
  return d > 0 ? d : d + 1440;
}

export function minutesWords(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} minutes`;
  return `${h} ${h === 1 ? "hour" : "hours"}${m > 0 ? ` ${m} min` : ""}`;
}

export function flexPayload(draft: HireDraft): Record<string, unknown> {
  if (!draft.flexOn) return { enabled: false };
  return {
    enabled: true,
    weekdays: [...draft.weekdays].sort((a, b) => a - b),
    startTime: draft.flexStart,
    endTime: draft.flexEnd,
    stepMinutes: draft.flexStep,
    minMinutes: draft.flexMinMinutes,
    maxMinutes: draft.flexMaxMinutes > 0 ? draft.flexMaxMinutes : null,
  };
}

/** Whether the saved "Hours you set" already matches the draft (so nothing is written). */
export function sameFlex(saved: HireHoursYouSet | null, draft: HireDraft): boolean {
  if (!draft.flexOn) return saved === null;
  return (
    saved !== null &&
    saved.startTime === draft.flexStart &&
    saved.endTime === draft.flexEnd &&
    saved.stepMinutes === draft.flexStep &&
    saved.minMinutes === draft.flexMinMinutes &&
    (saved.maxMinutes ?? 0) === draft.flexMaxMinutes &&
    JSON.stringify([...saved.weekdays].sort((a, b) => a - b)) === JSON.stringify([...draft.weekdays].sort((a, b) => a - b))
  );
}

export function flexWords(draft: Pick<HireDraft, "flexOn" | "flexStart" | "flexEnd" | "flexMinMinutes" | "flexMaxMinutes">): string | null {
  if (!draft.flexOn) return null;
  return `Hours you set ${draft.flexStart}–${draft.flexEnd} · at least ${minutesWords(draft.flexMinMinutes)}${draft.flexMaxMinutes > 0 ? `, up to ${minutesWords(draft.flexMaxMinutes)}` : ""}`;
}

export function sessionsPayload(draft: HireDraft): Record<string, unknown> {
  return {
    sessions: draft.sessions.map((s) => ({ label: s.label.trim(), startTime: s.startTime, endTime: s.endTime })),
    weekdays: [...draft.weekdays].sort((a, b) => a - b),
  };
}

/** A row's name, as guests and staff see it ("The Lounge Side · 60–150 guests"). */
export function rowName(row: HireRowDraft, places: readonly HirePlace[]): string {
  const place = places.find((p) => p.key === row.place);
  const days = row.weekdays.length === 0 || row.weekdays.length === 7 ? "" : ` · ${weekdaysSummary(row.weekdays)}`;
  return `${place?.name ?? "Space"} · ${row.guestMin}–${row.guestMax} guests${days}`.slice(0, 80);
}

export function rowPayload(row: HireRowDraft, draft: HireDraft, places: readonly HirePlace[], sortOrder: number): Record<string, unknown> {
  const { spaceId, combinationId } = parsePlaceKey(row.place);
  return {
    ...(row.optionId !== null ? { optionId: row.optionId } : {}),
    name: rowName(row, places),
    ...(spaceId !== null ? { spaceId } : { combinationId }),
    unit: row.perHour ? "hour" : draft.charge === "per_guest" ? "guest" : "booking",
    guestMin: row.guestMin,
    guestMax: row.guestMax,
    priceMinor: row.priceMinor ?? 0,
    ...(row.weekdays.length > 0 && row.weekdays.length < 7 ? { weekdays: [...row.weekdays].sort((a, b) => a - b) } : { weekdays: [0, 1, 2, 3, 4, 5, 6] }),
    sortOrder,
  };
}

export function termsPayload(draft: HireDraft): Record<string, unknown> {
  return {
    hireCharge: draft.charge,
    depositKind: draft.depositOn ? draft.depositKind : "none",
    ...(draft.depositOn
      ? {
          depositValue: draft.depositKind === "percent" ? draft.depositPercent * 100 : draft.depositFixedMinor ?? 0,
          balanceDueDaysBefore: draft.balanceDueDaysBefore,
        }
      : {}),
    damageDepositMinor: draft.damageDepositMinor ?? 0,
    setupMinutes: draft.setupMinutes,
    cleanupMinutes: draft.cleanupMinutes,
    extraGuestMinor: draft.extraGuestOn ? draft.extraGuestMinor : null,
    overtimeMinorPerHour: draft.overtimeOn ? draft.overtimeMinorPerHour : null,
  };
}

/** The hire's change rules for `manage_package set_change_rules` (both off = no changes online). */
export function hireChangeRulesPayload(
  draft: Pick<HireDraft, "guestChangeOn" | "guestChangeCutoffMinutes" | "dateChange" | "moveCutoffMinutes" | "maxChanges" | "changeFeePercent">,
): { allowedUntilMinutesBefore: number | null; maxChanges: number | null; feeBps: number | null; guestChangeUntilMinutesBefore: number | null } {
  return {
    allowedUntilMinutesBefore: draft.dateChange ? draft.moveCutoffMinutes : null,
    maxChanges: draft.dateChange ? draft.maxChanges : null,
    feeBps: draft.dateChange ? draft.changeFeePercent * 100 : null,
    guestChangeUntilMinutesBefore: draft.guestChangeOn ? draft.guestChangeCutoffMinutes : null,
  };
}

export function hireChangeWords(draft: Pick<HireDraft, "guestChangeOn" | "guestChangeCutoffMinutes" | "dateChange" | "moveCutoffMinutes" | "maxChanges" | "changeFeePercent">): string {
  const guests = draft.guestChangeOn ? `Numbers up to ${minutesBeforeLabel(draft.guestChangeCutoffMinutes)}` : null;
  const move = draft.dateChange
    ? `Another day up to ${minutesBeforeLabel(draft.moveCutoffMinutes)}${draft.maxChanges > 1 ? `, ${draft.maxChanges} times` : ", once"}${draft.changeFeePercent > 0 ? `, ${draft.changeFeePercent}% fee` : ""}`
    : null;
  if (guests === null && move === null) return "Changes are agreed with you, not online";
  return [guests, move].filter((x): x is string => x !== null).join(" · ");
}

export function bookingPayload(draft: HireDraft): Record<string, unknown> {
  return {
    mode: draft.mode,
    requestResponseHours: draft.requestResponseHours,
    approvedPaymentMinutes: draft.approvedPaymentMinutes,
  };
}

// ---------------------------------------------------------------- summaries

export function bufferWords(minutes: number): string {
  return BUFFER_OPTIONS.find((o) => o.value === minutes)?.label.toLowerCase() ?? `${minutes} minutes`;
}

export function sessionWords(s: Pick<HireSessionDraft, "label" | "startTime" | "endTime">): string {
  const past = s.endTime <= s.startTime && s.endTime !== s.startTime;
  return `${s.label} ${s.startTime}–${s.endTime}${past && s.endTime !== "00:00" ? " (next day)" : ""}`;
}

export function hirePriceLine(draft: HireDraft, currency: string | null): string {
  const prices = draft.rows.map((r) => r.priceMinor).filter((p): p is number => p !== null && p > 0);
  if (prices.length === 0) return "No price yet";
  const from = money(Math.min(...prices), currency);
  if (draft.rows.every((r) => r.perHour)) return `From ${from} an hour`;
  if (draft.charge === "per_guest") return `From ${from} a guest`;
  // #4490 N45: a minimum spend is never summarised as a price.
  return draft.charge === "min_spend" ? `Minimum spend from ${from}` : `From ${from}`;
}

/**
 * #4490 N45/N68: one price row in words, naming its days when it is not
 * every day, so a weekday and a weekend row never read as the same thing.
 * "The Main Hall · 50–600 guests · Fri, Sat and Sun: ₦4,200,000".
 */
export function hireRowWords(row: HireRowDraft, placeName: string, charge: HireCharge, currency: string | null): string {
  const days = row.weekdays.length > 0 && row.weekdays.length < 7 ? ` · ${weekdaysSummary(row.weekdays)}` : "";
  const unit = row.perHour ? " an hour" : charge === "per_guest" ? " a guest" : "";
  return `${placeName} · ${row.guestMin}–${row.guestMax} guests${days}: ${row.priceMinor !== null ? `${money(row.priceMinor, currency)}${unit}` : "—"}`;
}

export function hireDepositLine(draft: HireDraft, currency: string | null): string {
  if (!draft.depositOn) return "Paid in full to hold the date";
  const due = HIRE_BALANCE_DUE.find((o) => o.value === draft.balanceDueDaysBefore)?.label.toLowerCase() ?? `${draft.balanceDueDaysBefore} days before`;
  const dep = draft.depositKind === "percent" ? `${draft.depositPercent}% deposit` : `${money(draft.depositFixedMinor ?? 0, currency)} deposit`;
  return `${dep} holds the date, the rest ${due}`;
}

export function modeLine(draft: Pick<HireDraft, "mode" | "requestResponseHours" | "approvedPaymentMinutes">): string {
  const reply = REPLY_WINDOWS.find((o) => o.value === draft.requestResponseHours)?.label ?? `${draft.requestResponseHours} hours`;
  const pay = PAY_WINDOWS.find((o) => o.value === draft.approvedPaymentMinutes)?.label ?? `${Math.round(draft.approvedPaymentMinutes / 60)} hours`;
  return draft.mode === "request"
    ? `Request first · you reply within ${reply}, then they pay within ${pay}`
    : "Book instantly · the guest pays the deposit and the date is theirs";
}

export function hireReviewItems(
  draft: HireDraft,
  places: readonly HirePlace[],
  currency: string | null,
): Array<{ key: string; label: string; value: string }> {
  const chosen = chosenPlaces(draft, places);
  return [
    { key: "name", label: "Name", value: draft.name.trim() || "—" },
    { key: "spaces", label: "Spaces", value: chosen.length > 0 ? chosen.map((p) => p.name).join(", ") : "None yet" },
    { key: "layouts", label: "Layouts guests can pick", value: draft.layouts.length > 0 ? draft.layouts.map(venueLayoutLabel).join(", ") : "Not asked" },
    { key: "sessions", label: "Sessions", value: [...draft.sessions.map(sessionWords), flexWords(draft)].filter((x): x is string => x !== null).join(", ") },
    { key: "days", label: "Days", value: weekdaysSummary(draft.weekdays) },
    {
      key: "buffers",
      label: "Setup and cleanup",
      // #4490 fix 2 (N83): the starting values are ours; say so, and where to change them.
      value: `Setup ${bufferWords(draft.setupMinutes)} before · cleanup ${bufferWords(draft.cleanupMinutes)} after${
        draft.setupMinutes === HIRE_DEFAULT_SETUP_MINUTES && draft.cleanupMinutes === HIRE_DEFAULT_CLEANUP_MINUTES
          ? " · our starting times, change them on Times"
          : ""
      }`,
    },
    {
      key: "prices",
      label: `${HIRE_CHARGES.find((c) => c.key === draft.charge)?.column ?? "Price"} by group size`,
      value:
        draft.rows.length === 0
          ? "No prices yet"
          : draft.rows
              .map((r) => hireRowWords(r, chosen.find((p) => p.key === r.place)?.name ?? "Space", draft.charge, currency))
              .join("\n"),
    },
    {
      key: "extras",
      label: "Extras",
      value:
        [
          draft.extraGuestOn && draft.extraGuestMinor !== null ? `${money(draft.extraGuestMinor, currency)} per extra guest` : null,
          draft.overtimeOn && draft.overtimeMinorPerHour !== null ? `${money(draft.overtimeMinorPerHour, currency)} per hour running over` : null,
          ...draft.extras.map((extra) => `${extra.name.trim()} · ${money(extra.priceMinor ?? 0, currency)} per ${extra.per}`),
        ]
          .filter(Boolean)
          .join(" · ") || "None",
    },
    { key: "deposit", label: "Paying", value: hireDepositLine(draft, currency) },
    {
      key: "damage",
      label: "Damage deposit",
      value: draft.damageDepositMinor !== null && draft.damageDepositMinor > 0 ? `${money(draft.damageDepositMinor, currency)}, refundable` : "None",
    },
    { key: "refunds", label: "If the guest cancels", value: refundSummary(hireLadder(draft)) },
    { key: "changes", label: "Changes", value: hireChangeWords(draft) },
    { key: "mode", label: "How guests book", value: modeLine(draft) },
    {
      key: "notice",
      label: "Booking window",
      value: `${NOTICE_OPTIONS.find((o) => o.value === draft.minNoticeMinutes)?.label ?? minutesBeforeLabel(draft.minNoticeMinutes)} · up to ${ADVANCE_OPTIONS.find((o) => o.value === draft.maxAdvanceDays)?.label ?? `${draft.maxAdvanceDays} days ahead`}`,
    },
  ];
}

export interface HireReadinessLine {
  text: string;
  step: HireStepId | null;
}

export function hireReadinessLine(reason: string): HireReadinessLine {
  switch (reason) {
    case "feature_off":
      return { text: "Private hire is switched off for this venue. Turn it on in Settings › Venue type and features.", step: null };
    case "no_spaces":
      return { text: "Pick the spaces guests can hire.", step: "spaces" };
    case "no_price_option":
      return { text: "Add a price for at least one space.", step: "price" };
    case "hire_price_space_missing":
      return { text: "A price row is on a space this offer no longer uses.", step: "price" };
    case "layout_capacity_missing":
      return { text: "Every layout guests can pick needs a capacity on every priced space.", step: "spaces" };
    case "guest_max_over_capacity":
      return { text: "A price row allows more guests than its space holds.", step: "price" };
    case "option_unit_invalid":
      return { text: "Check how the price is charged.", step: "price" };
    case "no_policy":
      return { text: "Choose what happens if the guest cancels.", step: "terms" };
    case "no_schedule":
    case "no_start_times":
      return { text: "Set the sessions guests can hire.", step: "times" };
    case "kind_not_available_yet":
      return { text: "Private hire isn't available on this venue yet.", step: null };
    case "stay_venue":
      return { text: "Stays can't sell private hire yet.", step: null };
    default:
      return { text: "Something on this offer still needs finishing.", step: null };
  }
}

/** Plain words for hire-only refusals; null = use the shared offer copy. */
export function hireErrorCopy(code: string, detail: string | null = null): string | null {
  switch (code) {
    case "hire_spaces_invalid":
      return "Pick at least one space or combination.";
    case "hire_space_not_hirable":
      return "One of those spaces can't be hired. Switch on “Can be hired” for it in Spaces first.";
    case "hire_space_in_use":
      return "A price row still uses a space you removed. Remove that row first, then try again.";
    case "option_over_space_capacity": {
      try {
        const d = detail === null ? null : (JSON.parse(detail) as { capacity?: number; placeName?: string });
        if (d !== null && typeof d.capacity === "number") {
          return `More than ${d.placeName ?? "that space"} holds (${d.capacity.toLocaleString("en-GB")}). Lower the largest group.`;
        }
      } catch {
        // fall through to the plain line
      }
      return "A row allows more guests than its space holds. Lower the largest group.";
    }
    case "hire_price_space_missing":
      return "Pick a space for every price row.";
    case "hire_sessions_invalid":
      return "Check your sessions: each needs its own name, a start and an end (up to 6).";
    case "hire_terms_invalid":
      return "Check setup, cleanup and the prices on this step.";
    case "hire_booking_invalid":
      return "Pick how long you take to reply and how long guests have to pay.";
    case "hire_layouts_invalid":
      return "Pick layouts from the fixed list, without repeats.";
    case "deposit_invalid":
      return "Check the deposit: 1% to 99%, or an amount, and when the rest is due.";
    case "offer_kind_invalid":
      return "That setting is for private hire only.";
    default:
      return null;
  }
}
