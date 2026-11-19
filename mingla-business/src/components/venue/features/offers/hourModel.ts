/**
 * #4490 P5-2 — the By the hour editor (`ed-hour`) as pure data: the draft,
 * the plain-word checks, the payloads `issue_4490_manage_hour` and
 * `issue_4490_manage_offer` take, and the price line. Unit-tested.
 *
 * Price rule (backend P5 deviation 2): per minute, pro rata to the hour price
 * (price × minutes / 60, half up), so 90 minutes at ₦12,000 is ₦18,000.
 */
import type { BusyRule, RefundRung, VenueOffer } from "../../../../types/venueOffers";

export type HourPlaceMode = "spaces" | "units";

export interface HourDraft {
  name: string;
  summary: string;
  placeMode: HourPlaceMode;
  spaceIds: string[];
  allocation: "all" | "any_one";
  unitCount: number;
  unitName: string;
  unitSeats: number;
  unitSetting: "indoor" | "covered" | "outdoor";
  priceMinor: number | null;
  /** #4490 fix 2 (N80): the smallest group one booking can be. */
  guestMin: number;
  guestMax: number;
  busyOn: boolean;
  busy: { weekdays: number[]; from: string; to: string; amountMinor: number | null };
  weekdays: number[];
  opens: string;
  closes: string;
  stepMinutes: 15 | 30 | 60;
  minMinutes: number;
  /** null = no limit (up to the day's closing). */
  maxMinutes: number | null;
  setupMinutes: number;
  cleanupMinutes: number;
  releaseOn: boolean;
  releaseMinutes: number;
  staffCanStart: boolean;
  refundPreset: HourRefundPreset;
  /** #4490 P5 follow-up — guests may move the booking to another time themselves. */
  moveOn: boolean;
  /** Up to this many minutes before it starts. */
  moveCutoffMinutes: number;
  /** How many times one booking can move. */
  maxMoves: number;
}

/** "Up to" choices for a guest moving a by-the-hour booking. */
export const HOUR_MOVE_CUTOFF_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 6 * 60, label: "6 hours before" },
  { value: 24 * 60, label: "24 hours before" },
  { value: 48 * 60, label: "2 days before" },
];

/** The date-change rule the policy saves (null = guests can't move it). */
export function hourMoveRule(d: Pick<HourDraft, "moveOn" | "moveCutoffMinutes" | "maxMoves">): { allowedUntilMinutesBefore: number; feeBps: number; maxChanges: number } | null {
  return d.moveOn ? { allowedUntilMinutesBefore: d.moveCutoffMinutes, feeBps: 0, maxChanges: d.maxMoves } : null;
}

export type HourRefundPreset = "flexible" | "standard" | "strict";

const H = 60;
export const HOUR_REFUND_PRESETS: ReadonlyArray<{ key: HourRefundPreset; label: string; helper: string; ladder: RefundRung[] }> = [
  {
    key: "flexible",
    label: "Flexible",
    helper: "Full refund up to 2 hours before.",
    ladder: [{ minMinutesBefore: 2 * H, refundBps: 10000 }],
  },
  {
    key: "standard",
    label: "Standard",
    helper: "Full refund up to 24 hours before, then 50% until it starts.",
    ladder: [
      { minMinutesBefore: 24 * H, refundBps: 10000 },
      { minMinutesBefore: 0, refundBps: 5000 },
    ],
  },
  {
    key: "strict",
    label: "No refunds",
    helper: "Guests can't get money back once they book.",
    ladder: [],
  },
];

export const STEP_OPTIONS: ReadonlyArray<{ key: "15" | "30" | "60"; label: string }> = [
  { key: "15", label: "15 min" },
  { key: "30", label: "30 min" },
  { key: "60", label: "1 hour" },
];

export const RELEASE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 20, label: "20 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "1 hour" },
];

export const HOUR_BUFFER_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "None" },
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
];

/** "30 minutes", "1 hour", "1 hour 30 minutes", "2 hours". */
export function minutesLabel(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  const hp = h === 0 ? "" : `${h} ${h === 1 ? "hour" : "hours"}`;
  const mp = r === 0 ? "" : `${r} minutes`;
  return [hp, mp].filter(Boolean).join(" ") || "0 minutes";
}

/** Shortest-booking choices: every step up to 8 hours. */
export function minLengthOptions(step: number): Array<{ value: number; label: string }> {
  const out: Array<{ value: number; label: string }> = [];
  for (let m = step; m <= 8 * 60; m += step) out.push({ value: m, label: minutesLabel(m) });
  return out;
}

/** Longest-booking choices: "No limit", then steps from the shortest up to 24 hours (no 60-minute cap). */
export function maxLengthOptions(step: number, min: number): Array<{ value: number; label: string }> {
  const out: Array<{ value: number; label: string }> = [{ value: 0, label: "No limit" }];
  for (let m = Math.max(step, min); m <= 24 * 60; m += m < 4 * 60 ? step : 60) out.push({ value: m, label: minutesLabel(m) });
  return out;
}

export function hourDraftFrom(offer: VenueOffer | null): HourDraft {
  const h = offer?.hour ?? null;
  const option = offer?.options.find((o) => o.status === "active") ?? offer?.options[0] ?? null;
  const busy = option?.busyRules[0] ?? null;
  const ladder = offer?.policy?.refundLadder ?? null;
  const preset: HourRefundPreset =
    ladder === null
      ? "flexible"
      : (HOUR_REFUND_PRESETS.find((p) => JSON.stringify(p.ladder) === JSON.stringify(ladder))?.key ??
        (ladder.length === 0 ? "strict" : "standard"));
  const step = h?.stepMinutes === 15 || h?.stepMinutes === 30 ? h.stepMinutes : 60;
  return {
    name: offer?.name ?? "",
    summary: offer?.summary ?? "",
    placeMode: h !== null && h.places.length > 0 ? "spaces" : "units",
    spaceIds: h?.places.map((p) => p.id) ?? [],
    allocation: h?.allocation ?? "any_one",
    unitCount: 1,
    unitName: offer?.name ?? "",
    unitSeats: 4,
    unitSetting: "indoor",
    priceMinor: option?.priceMinor ?? h?.pricePerHourMinor ?? null,
    guestMin: option?.guestMin ?? 1,
    guestMax: option?.guestMax ?? 10,
    busyOn: busy !== null,
    busy: busy !== null
      ? { weekdays: [...busy.weekdays], from: busy.from.slice(0, 5), to: busy.to.slice(0, 5), amountMinor: busy.amountMinor }
      : { weekdays: [4, 5, 6], from: "18:00", to: "23:00", amountMinor: null },
    weekdays: h?.hours?.weekdays ?? [0, 1, 2, 3, 4, 5, 6],
    opens: h?.hours?.startTime ?? "09:00",
    closes: h?.hours?.endTime ?? "21:00",
    stepMinutes: step,
    minMinutes: h?.minMinutes ?? 60,
    maxMinutes: h?.maxMinutes ?? null,
    setupMinutes: h?.setupMinutes ?? 0,
    cleanupMinutes: h?.cleanupMinutes ?? 0,
    releaseOn: h?.noShowReleaseMinutes != null,
    releaseMinutes: h?.noShowReleaseMinutes ?? 15,
    staffCanStart: h?.staffCanStart ?? false,
    refundPreset: preset,
    moveOn: (offer?.policy?.dateChangeRule?.allowedUntilMinutesBefore ?? null) !== null,
    moveCutoffMinutes: offer?.policy?.dateChangeRule?.allowedUntilMinutesBefore ?? 120,
    maxMoves: offer?.policy?.dateChangeRule?.maxChanges ?? 1,
  };
}

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Minutes the place is open a day (closing past midnight counts to the next day). */
export function openMinutes(opens: string, closes: string): number {
  const a = toMin(opens);
  const b = toMin(closes);
  return b > a ? b - a : b + 24 * 60 - a;
}

export interface HourIssues {
  name: string | null;
  place: string | null;
  price: string | null;
  days: string | null;
  hours: string | null;
  length: string | null;
  busy: string | null;
}

export function hourIssues(d: HourDraft, ctx: { savedPlaces: number }): HourIssues {
  const open = d.opens.length > 0 && d.closes.length > 0 ? openMinutes(d.opens, d.closes) : 0;
  return {
    name: d.name.trim().length === 0 ? "Name it, like Boardroom or Pool table." : null,
    place:
      d.placeMode === "spaces"
        ? d.spaceIds.length === 0
          ? "Pick the space (or spaces) guests book."
          : null
        : ctx.savedPlaces === 0 && d.unitName.trim().length === 0
          ? "Name the units, like Pool table."
          : null,
    price: d.priceMinor === null || d.priceMinor <= 0 ? "Enter the price per hour." : null,
    days: d.weekdays.length === 0 ? "Pick at least one day." : null,
    hours: d.opens.length === 0 || d.closes.length === 0 ? "Pick when it opens and closes." : d.opens === d.closes ? "Opening and closing can't be the same time." : null,
    length:
      d.minMinutes % d.stepMinutes !== 0
        ? `The shortest booking must be in steps of ${minutesLabel(d.stepMinutes)}.`
        : open > 0 && d.minMinutes > open
          ? "The shortest booking is longer than the hours it's open."
          : d.maxMinutes !== null && d.maxMinutes < d.minMinutes
            ? "The longest booking can't be shorter than the shortest."
            : null,
    busy:
      d.busyOn && (d.busy.weekdays.length === 0 || d.busy.from.length === 0 || d.busy.to.length === 0 || d.busy.amountMinor === null || d.busy.amountMinor <= 0)
        ? "A busy-time price needs days, a start, an end and a price."
        : null,
  };
}

export function hourIssueList(i: HourIssues): string[] {
  return [i.name, i.place, i.price, i.days, i.hours, i.length, i.busy].filter((x): x is string => x !== null);
}

/** The price option (one per hour price). */
export function hourOptionPayload(d: HourDraft, optionId: string | null): Record<string, unknown> {
  const busyRules: BusyRule[] = d.busyOn
    ? [{ weekdays: [...d.busy.weekdays].sort((a, b) => a - b), from: d.busy.from, to: d.busy.to, amountMinor: d.busy.amountMinor ?? 0 }]
    : [];
  const payload: Record<string, unknown> = {
    name: "Per hour",
    unit: "hour",
    guestMin: Math.max(1, Math.min(d.guestMin, d.guestMax)),
    guestMax: Math.max(1, d.guestMax, d.guestMin),
    priceMinor: d.priceMinor ?? 0,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    eligibility: null,
    busyRules: busyRules.map((r) => ({ weekdays: r.weekdays, from: r.from, to: r.to, amount_minor: r.amountMinor })),
    sortOrder: 0,
  };
  if (optionId !== null) payload.optionId = optionId;
  return payload;
}

export function hourPlacePayload(d: HourDraft, offerId: string): Record<string, unknown> {
  if (d.placeMode === "units") {
    return {
      offerId,
      units: { count: d.unitCount, name: d.unitName.trim(), seats: d.unitSeats, setting: d.unitSetting },
    };
  }
  return { offerId, spaceIds: [...d.spaceIds].sort(), allocation: d.spaceIds.length > 1 ? d.allocation : "all" };
}

export function hourHoursPayload(d: HourDraft, offerId: string): Record<string, unknown> {
  return { offerId, weekdays: [...d.weekdays].sort((a, b) => a - b), startTime: d.opens, endTime: d.closes };
}

export function hourLengthPayload(d: HourDraft, offerId: string): Record<string, unknown> {
  return { offerId, stepMinutes: d.stepMinutes, minMinutes: d.minMinutes, maxMinutes: d.maxMinutes };
}

export function hourRulesPayload(d: HourDraft, offerId: string): Record<string, unknown> {
  return {
    offerId,
    bufferBeforeMinutes: d.setupMinutes,
    bufferAfterMinutes: d.cleanupMinutes,
    noShowReleaseMinutes: d.releaseOn ? d.releaseMinutes : null,
    staffCanStart: d.staffCanStart,
  };
}

export function hourLadder(d: HourDraft): RefundRung[] {
  return HOUR_REFUND_PRESETS.find((p) => p.key === d.refundPreset)?.ladder ?? [];
}

/** Price × minutes / 60, half up (the server's rule). */
export function hourPriceFor(pricePerHourMinor: number, minutes: number): number {
  return Math.round((pricePerHourMinor * minutes) / 60);
}

/** Plain words for the readiness reasons a by-the-hour offer adds. */
export function hourReadinessCopy(reason: string): string | null {
  switch (reason) {
    case "no_hours":
      return "Set the days and hours it can be booked.";
    case "option_unit_invalid":
      return "The price must be per hour.";
    case "no_spaces":
      return "Pick the space (or units) guests book.";
    case "no_price_option":
      return "Enter the price per hour.";
    case "no_policy":
      return "Choose your refund rules.";
    default:
      return null;
  }
}

/** Plain words for every manage_hour refusal. */
export function hourErrorCopy(code: string): string | null {
  switch (code) {
    case "hour_spaces_invalid":
      return "Pick spaces from this venue.";
    case "hour_units_invalid":
      return "Units need a name, 1 to 50 of them and the seats each one has.";
    case "hour_space_in_use":
      return "That unit has bookings ahead, so it can't be changed. Keep it, or cancel those bookings first.";
    case "schedule_weekdays_invalid":
      return "Pick at least one day.";
    case "schedule_times_invalid":
      return "Pick when it opens and closes.";
    case "hour_length_invalid":
      return "Check the booking lengths: the shortest must be in steps and no longer than the longest.";
    case "hour_rules_invalid":
      return "Setup and cleanup can be up to 4 hours; release after 5 minutes to 4 hours.";
    case "offer_kind_invalid":
      return "This isn't a By the hour offer.";
    default:
      return null;
  }
}
