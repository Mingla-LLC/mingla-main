/**
 * #4490 P3-2 — the Group package editor (`ed-pkg-price`, `ed-pkg`,
 * `ed-pkg-where`): drafts, validation, payloads and plain words (pure; no
 * React, no services). Money is minor units of the brand currency; weekdays
 * are 0 = Monday; times are 24 h "HH:MM".
 *
 * A P3 package is pool-only: it uses "any open space" and counts against the
 * venue's day limit, shared with Entry (reconciliation conflict 38). Named
 * spaces held exclusively arrive with P4.
 */
import type {
  DepositKind,
  InclusionKind,
  RefundRung,
  VenueCapacityPool,
  VenueOffer,
  VenuePriceOption,
} from "../../../../types/venueOffers";
import { weekdaysSummary } from "../../../ui/fieldModels";
import {
  REFUND_PRESETS,
  draftKey,
  minutesBeforeLabel,
  money,
  presetForLadder,
  refundSummary,
  type RefundPreset,
} from "./offersModel";

// ---------------------------------------------------------------- steps

export type PackageStepId = "basics" | "price" | "included" | "where" | "rules" | "review";

export const PACKAGE_STEPS: ReadonlyArray<{ id: PackageStepId; label: string }> = [
  { id: "basics", label: "Basics" },
  { id: "price", label: "Price and group size" },
  { id: "included", label: "What's included" },
  { id: "where", label: "Where and how long" },
  { id: "rules", label: "Deposit and rules" },
  { id: "review", label: "Review" },
];

// ---------------------------------------------------------------- drafts

/** How the group is charged. "by_size" = a price per guest that depends on the group's size. */
export type PackageCharge = "per_guest" | "per_group" | "by_size";

export const PACKAGE_CHARGES: ReadonlyArray<{ key: PackageCharge; label: string; helper: string }> = [
  { key: "per_guest", label: "Per guest", helper: "One price for each guest in the group." },
  { key: "per_group", label: "One price for the group", helper: "The same price whatever the group's size." },
  { key: "by_size", label: "Price by group size", helper: "A different price per guest for bigger groups." },
];

export interface PackageTierDraft {
  key: string;
  id: string | null;
  guestMin: number;
  guestMax: number;
  priceMinor: number | null;
}

export interface InclusionDraft {
  key: string;
  kind: InclusionKind;
  /** Perk text, staff role, the question, or the menu item's name. */
  label: string;
  menuItemId: string | null;
  /** Menu items: how many of it. Stored inside the label ("2 × Small chops"). */
  menuQty: number;
  qtyPer: "guest" | "booking";
  staffRatio: number;
  options: string[];
}

export interface ExtraDraft {
  key: string;
  /** Kept across edits: bookings point at it. Null = new. */
  id: string | null;
  name: string;
  priceMinor: number | null;
  per: "booking" | "guest";
}

export interface PackageDraft {
  name: string;
  summary: string;
  charge: PackageCharge;
  /** Per guest, or for the whole group. */
  priceMinor: number | null;
  guestMin: number;
  guestMax: number;
  tiers: PackageTierDraft[];
  inclusions: InclusionDraft[];
  extras: ExtraDraft[];
  weekdays: number[];
  firstStart: string;
  lastStart: string;
  /** Minutes between start times. */
  startEvery: number;
  durationMinutes: number;
  minNoticeMinutes: number;
  /** Only used when the venue has no day limit yet. */
  dailyLimit: number;
  depositKind: DepositKind;
  depositPercent: number;
  depositFixedMinor: number | null;
  balanceDueDaysBefore: number;
  refundPreset: RefundPreset;
  customLadder: RefundRung[];
  dateChange: boolean;
  moveCutoffMinutes: number;
  maxChanges: number;
  changeFeePercent: number;
  guestChangeCutoffMinutes: number;
}

export const START_EVERY_OPTIONS: ReadonlyArray<{ key: string; label: string; minutes: number }> = [
  // #4490 N43: "Every …" so these never read like the booking length below.
  { key: "60", label: "Every hour", minutes: 60 },
  { key: "90", label: "Every 1½ hours", minutes: 90 },
  { key: "120", label: "Every 2 hours", minutes: 120 },
  { key: "180", label: "Every 3 hours", minutes: 180 },
];

export const BALANCE_DUE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "On the day" },
  { value: 1, label: "1 day before" },
  { value: 2, label: "2 days before" },
  { value: 3, label: "3 days before" },
  { value: 5, label: "5 days before" },
  { value: 7, label: "1 week before" },
  { value: 14, label: "2 weeks before" },
  { value: 30, label: "30 days before" },
];

export const CHANGE_CUTOFFS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "Until it starts" },
  { value: 120, label: "2 hours before" },
  { value: 720, label: "12 hours before" },
  { value: 1440, label: "24 hours before" },
  { value: 2880, label: "48 hours before" },
  { value: 4320, label: "3 days before" },
  { value: 10080, label: "1 week before" },
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const toMinutes = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The start times a first / last / every picks give ("12:00", "14:00", …). At most 24. */
export function startTimesFor(first: string, last: string, every: number): string[] {
  if (!TIME.test(first) || !TIME.test(last) || every < 15) return [];
  const from = toMinutes(first);
  const to = toMinutes(last);
  if (to < from) return [];
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 24; m += every) out.push(toTime(m));
  return out;
}

/** Read first / last / every back from saved start times. */
export function startPattern(times: readonly string[]): { first: string; last: string; every: number } | null {
  const sorted = [...times].filter((t) => TIME.test(t)).sort();
  if (sorted.length === 0) return null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const every = sorted.length > 1 ? toMinutes(sorted[1]) - toMinutes(sorted[0]) : 120;
  return { first, last, every: every >= 15 ? every : 120 };
}

export function emptyTier(min: number, max: number): PackageTierDraft {
  return { key: draftKey("tier"), id: null, guestMin: min, guestMax: max, priceMinor: null };
}

export function emptyExtra(): ExtraDraft {
  return { key: draftKey("extra"), id: null, name: "", priceMinor: null, per: "booking" };
}

export function newInclusion(kind: InclusionKind, label = "", menuItemId: string | null = null): InclusionDraft {
  return {
    key: draftKey("inc"),
    kind,
    label,
    menuItemId,
    menuQty: 1,
    qtyPer: kind === "menu_item" ? "guest" : "booking",
    staffRatio: 15,
    options: kind === "choice" ? [] : [],
  };
}

const QTY_LABEL = /^(\d{1,3}) × (.+)$/;

function chargeFor(options: readonly VenuePriceOption[]): PackageCharge {
  const live = options.filter((o) => o.status !== "archived");
  if (live.length > 1) return "by_size";
  if (live[0]?.unit === "booking") return "per_group";
  return "per_guest";
}

/** The editor's starting point for a new or an existing group package. */
export function packageDraftFrom(input: { offer: VenueOffer | null; pool: VenueCapacityPool | null }): PackageDraft {
  const { offer, pool } = input;
  const options = [...(offer?.options ?? [])].sort((a, b) => a.guestMin - b.guestMin || a.sortOrder - b.sortOrder);
  const first = options[0] ?? null;
  const charge = chargeFor(options);
  const pattern = startPattern(offer?.startTimes ?? []);
  const change = offer?.policy?.dateChangeRule ?? null;
  const ladder = offer?.policy?.refundLadder ?? [];
  const deposit = offer?.deposit ?? null;
  return {
    name: offer?.name ?? "",
    summary: offer?.summary ?? "",
    charge,
    priceMinor: first?.priceMinor ?? null,
    guestMin: charge === "by_size" ? Math.min(...options.map((o) => o.guestMin)) : first?.guestMin ?? 10,
    guestMax: charge === "by_size" ? Math.max(...options.map((o) => o.guestMax)) : first?.guestMax ?? 30,
    tiers:
      charge === "by_size"
        ? options.map((o) => ({ key: o.id, id: o.id, guestMin: o.guestMin, guestMax: o.guestMax, priceMinor: o.priceMinor }))
        : [],
    inclusions: (offer?.inclusions ?? []).map((i) => {
      const m = i.kind === "menu_item" ? QTY_LABEL.exec(i.label) : null;
      return {
        key: draftKey("inc"),
        kind: i.kind,
        label: m !== null ? m[2] : i.label,
        menuItemId: i.menuItemId,
        menuQty: m !== null ? Number(m[1]) : 1,
        qtyPer: i.qtyPer ?? (i.kind === "menu_item" ? "guest" : "booking"),
        staffRatio: i.staffRatio ?? 15,
        options: i.options ?? [],
      };
    }),
    extras: (offer?.extras ?? []).map((e) => ({ key: e.id, id: e.id, name: e.name, priceMinor: e.priceMinor, per: e.per })),
    weekdays: offer?.schedule?.weekdays.length ? offer.schedule.weekdays : [0, 1, 2, 3, 4, 5, 6],
    firstStart: pattern?.first ?? "12:00",
    lastStart: pattern?.last ?? "18:00",
    startEvery: pattern?.every ?? 120,
    durationMinutes: offer?.durationMinutes ?? 180,
    minNoticeMinutes: offer?.minNoticeMinutes ?? 4320,
    dailyLimit: pool?.dailyLimit ?? 200,
    depositKind: deposit?.kind ?? (offer === null ? "percent" : "none"),
    depositPercent: deposit?.kind === "percent" && deposit.value !== null ? Math.round(deposit.value / 100) : 50,
    depositFixedMinor: deposit?.kind === "fixed" ? deposit.value : null,
    balanceDueDaysBefore: deposit?.balanceDueDaysBefore ?? 2,
    refundPreset: offer === null || offer.policy === null ? "full_24h" : presetForLadder(ladder),
    customLadder:
      offer?.policy !== null && offer !== null && presetForLadder(ladder) === "custom"
        ? ladder
        : [{ minMinutesBefore: 4320, refundBps: 10000 }],
    dateChange: change !== null && change.allowedUntilMinutesBefore !== null,
    moveCutoffMinutes: change?.allowedUntilMinutesBefore ?? 1440,
    maxChanges: change?.maxChanges ?? 1,
    changeFeePercent: change?.feeBps !== null && change?.feeBps !== undefined ? Math.round(change.feeBps / 100) : 0,
    guestChangeCutoffMinutes: change?.guestChangeUntilMinutesBefore ?? 2880,
  };
}

// ----------------------------------------------------------- validation

export interface TierIssue {
  key: string;
  text: string;
}

/** The largest group the venue can take (the shared day limit). */
export function groupCap(pool: VenueCapacityPool | null, draft: Pick<PackageDraft, "dailyLimit">): number {
  return Math.max(1, pool?.dailyLimit ?? draft.dailyLimit);
}

export function tierIssues(draft: PackageDraft, cap: number): TierIssue[] {
  if (draft.charge !== "by_size") return [];
  const out: TierIssue[] = [];
  const sorted = [...draft.tiers].sort((a, b) => a.guestMin - b.guestMin);
  sorted.forEach((t, i) => {
    if (t.priceMinor === null || t.priceMinor <= 0) out.push({ key: t.key, text: "Enter a price per guest" });
    else if (t.guestMax < t.guestMin) out.push({ key: t.key, text: "Largest must be at least the smallest" });
    else if (t.guestMax > cap) out.push({ key: t.key, text: `Can't be more than ${cap.toLocaleString("en-GB")} guests` });
    else if (i > 0 && t.guestMin <= sorted[i - 1].guestMax) {
      out.push({ key: t.key, text: `Starts inside the ${sorted[i - 1].guestMin}–${sorted[i - 1].guestMax} range` });
    }
  });
  return out;
}

export function inclusionIssue(item: InclusionDraft): string | null {
  if (item.label.trim().length === 0) {
    return item.kind === "choice" ? "Write the question guests answer" : item.kind === "staff" ? "Name the role" : "Say what's included";
  }
  if (item.label.trim().length > 80) return "Keep it under 80 characters";
  if (item.kind === "choice" && (item.options.length < 2 || item.options.length > 10)) return "Give guests 2 to 10 options";
  if (item.kind === "menu_item" && item.menuItemId === null) return "Pick the menu item";
  return null;
}

export function extraIssue(extra: ExtraDraft): string | null {
  if (extra.name.trim().length === 0) return "Name this extra";
  if (extra.priceMinor === null || extra.priceMinor < 0) return "Enter a price";
  return null;
}

/** The first problem on a step, in plain words (null = the step is complete). */
export function packageStepIssue(step: PackageStepId, draft: PackageDraft, pool: VenueCapacityPool | null): string | null {
  const cap = groupCap(pool, draft);
  if (step === "basics") {
    if (draft.name.trim().length === 0) return "Name this package";
    return null;
  }
  if (step === "price") {
    if (draft.charge === "by_size") {
      if (draft.tiers.length < 2) return "Add at least two group sizes, or charge per guest";
      return tierIssues(draft, cap)[0]?.text ?? null;
    }
    if (draft.priceMinor === null || draft.priceMinor <= 0) return "Enter a price";
    if (draft.guestMin < 1) return "The smallest group is at least 1";
    if (draft.guestMax < draft.guestMin) return "The largest group can't be smaller than the smallest";
    if (draft.guestMax > cap) return `The largest group can't be more than the ${cap.toLocaleString("en-GB")} a day the venue takes`;
    return null;
  }
  if (step === "included") {
    const bad = draft.inclusions.find((i) => inclusionIssue(i) !== null);
    if (bad !== undefined) return inclusionIssue(bad);
    const labels = draft.inclusions.filter((i) => i.kind === "choice").map((i) => i.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) return "Two questions have the same wording";
    const extra = draft.extras.find((e) => extraIssue(e) !== null);
    if (extra !== undefined) return `${extra.name.trim() || "An extra"}: ${extraIssue(extra)}`;
    return null;
  }
  if (step === "where") {
    if (draft.weekdays.length === 0) return "Pick the days groups can book";
    const times = startTimesFor(draft.firstStart, draft.lastStart, draft.startEvery);
    if (!TIME.test(draft.firstStart) || !TIME.test(draft.lastStart)) return "Pick the first and last start times";
    if (times.length === 0) return "The last start can't be before the first";
    if (draft.durationMinutes < 15) return "Pick how long a booking lasts";
    if (pool === null && draft.dailyLimit < 1) return "Set how many guests the venue takes a day";
    return null;
  }
  if (step === "rules") {
    if (draft.depositKind === "percent" && (draft.depositPercent < 1 || draft.depositPercent > 99)) {
      return "A deposit is 1% to 99%";
    }
    if (draft.depositKind === "fixed" && (draft.depositFixedMinor === null || draft.depositFixedMinor <= 0)) {
      return "Enter the deposit amount";
    }
    if (draft.refundPreset === "custom") {
      if (draft.customLadder.length === 0) return "Add a refund rule, or pick No refunds";
      const minutes = draft.customLadder.map((r) => r.minMinutesBefore);
      if (new Set(minutes).size !== minutes.length) return "Two refund rules have the same time";
    }
    return null;
  }
  return null;
}

// ------------------------------------------------------------- payloads

export interface OptionWrite {
  optionId: string | null;
  payload: Record<string, unknown>;
}

/** The price options this draft saves (one, or one per group size). */
export function packageOptionWrites(draft: PackageDraft, existing: readonly VenuePriceOption[]): OptionWrite[] {
  const name = draft.name.trim().slice(0, 80) || "Package";
  if (draft.charge === "by_size") {
    return [...draft.tiers]
      .sort((a, b) => a.guestMin - b.guestMin)
      .map((t, i) => ({
        optionId: t.id,
        payload: {
          ...(t.id !== null ? { optionId: t.id } : {}),
          name: `${t.guestMin} to ${t.guestMax} guests`,
          unit: "guest",
          guestMin: t.guestMin,
          guestMax: t.guestMax,
          priceMinor: t.priceMinor ?? 0,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          eligibility: null,
          busyRules: [],
          sortOrder: i,
        },
      }));
  }
  const keep = [...existing].sort((a, b) => a.guestMin - b.guestMin)[0] ?? null;
  return [
    {
      optionId: keep?.id ?? null,
      payload: {
        ...(keep !== null ? { optionId: keep.id } : {}),
        name,
        unit: draft.charge === "per_group" ? "booking" : "guest",
        guestMin: draft.guestMin,
        guestMax: draft.guestMax,
        priceMinor: draft.priceMinor ?? 0,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        eligibility: null,
        busyRules: [],
        sortOrder: 0,
      },
    },
  ];
}

/** Was this saved option written the same way (only changed options are re-sent)? */
export function optionWriteChanged(write: OptionWrite, saved: VenuePriceOption | undefined): boolean {
  if (saved === undefined) return true;
  const p = write.payload;
  return (
    saved.name !== p.name ||
    saved.unit !== p.unit ||
    saved.guestMin !== p.guestMin ||
    saved.guestMax !== p.guestMax ||
    saved.priceMinor !== p.priceMinor ||
    saved.sortOrder !== p.sortOrder
  );
}

export function inclusionsPayload(draft: PackageDraft): Array<Record<string, unknown>> {
  return draft.inclusions.map((i) => {
    const label = i.label.trim();
    if (i.kind === "menu_item") {
      return {
        kind: "menu_item",
        label: (i.menuQty > 1 ? `${i.menuQty} × ${label}` : label).slice(0, 80),
        menuItemId: i.menuItemId,
        qtyPer: i.qtyPer,
      };
    }
    if (i.kind === "staff") return { kind: "staff", label, staffRatio: i.staffRatio };
    if (i.kind === "choice") return { kind: "choice", label, options: i.options.map((o) => o.trim()).filter((o) => o.length > 0) };
    return { kind: i.kind, label };
  });
}

export function extrasPayload(draft: Pick<PackageDraft, "extras">): Array<Record<string, unknown>> {
  return draft.extras.map((e) => ({
    ...(e.id !== null ? { id: e.id } : {}),
    name: e.name.trim(),
    priceMinor: e.priceMinor ?? 0,
    per: e.per,
  }));
}

export function staffRoleFor(draft: PackageDraft): string | null {
  const staff = draft.inclusions.find((i) => i.kind === "staff" && i.label.trim().length > 0);
  return staff === undefined ? null : staff.label.trim().replace(/^(a|an|one)\s+/i, "").slice(0, 60);
}

export function paymentPayload(draft: PackageDraft): Record<string, unknown> {
  if (draft.depositKind === "none") return { depositKind: "none" };
  return {
    depositKind: draft.depositKind,
    depositValue: draft.depositKind === "percent" ? draft.depositPercent * 100 : draft.depositFixedMinor ?? 0,
    balanceDueDaysBefore: draft.balanceDueDaysBefore,
  };
}

export function ladderFor(draft: Pick<PackageDraft, "refundPreset" | "customLadder">): RefundRung[] {
  if (draft.refundPreset === "custom") return [...draft.customLadder].sort((a, b) => b.minMinutesBefore - a.minMinutesBefore);
  return REFUND_PRESETS.find((p) => p.key === draft.refundPreset)?.ladder ?? [];
}

export function changeRulesPayload(draft: PackageDraft): Record<string, unknown> {
  return {
    allowedUntilMinutesBefore: draft.dateChange ? draft.moveCutoffMinutes : null,
    maxChanges: draft.dateChange ? draft.maxChanges : null,
    feeBps: draft.dateChange ? draft.changeFeePercent * 100 : null,
    guestChangeUntilMinutesBefore: draft.guestChangeCutoffMinutes,
  };
}

// ------------------------------------------------------ summaries (copy)

export function priceLine(draft: PackageDraft, currency: string | null): string {
  if (draft.charge === "by_size") {
    const prices = draft.tiers.map((t) => t.priceMinor).filter((p): p is number => p !== null && p > 0);
    if (prices.length === 0) return "No price yet";
    return `from ${money(Math.min(...prices), currency)} a guest`;
  }
  if (draft.priceMinor === null) return "No price yet";
  return draft.charge === "per_group" ? `${money(draft.priceMinor, currency)} for the group` : `${money(draft.priceMinor, currency)} a guest`;
}

export function groupSizeLine(draft: PackageDraft): string {
  return `${draft.guestMin.toLocaleString("en-GB")} to ${draft.guestMax.toLocaleString("en-GB")} guests`;
}

export function durationWords(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  if (minutes > 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${minutes} min`;
}

export function depositLine(draft: Pick<PackageDraft, "depositKind" | "depositPercent" | "depositFixedMinor" | "balanceDueDaysBefore">, currency: string | null): string {
  if (draft.depositKind === "none") return "Paid in full when they book";
  const due = BALANCE_DUE_OPTIONS.find((o) => o.value === draft.balanceDueDaysBefore)?.label.toLowerCase() ?? `${draft.balanceDueDaysBefore} days before`;
  const dep =
    draft.depositKind === "percent"
      ? `${draft.depositPercent}% deposit`
      : `${money(draft.depositFixedMinor ?? 0, currency)} deposit`;
  return `${dep}, the rest ${due === "on the day" ? "on the day" : due}`;
}

/** "Half now" for 50%, "30% now" otherwise, "₦50,000 now" for a fixed deposit. */
export function depositChoiceLabel(draft: Pick<PackageDraft, "depositKind" | "depositPercent" | "depositFixedMinor">, currency: string | null): string | null {
  if (draft.depositKind === "none") return null;
  if (draft.depositKind === "percent") return draft.depositPercent === 50 ? "Half now" : `${draft.depositPercent}% now`;
  return `${money(draft.depositFixedMinor ?? 0, currency)} now`;
}

export function changeLine(draft: PackageDraft): string {
  const guests = `Numbers and extras up to ${minutesBeforeLabel(draft.guestChangeCutoffMinutes)}`;
  if (!draft.dateChange) return `${guests}. Guests can't move the day.`;
  const times = draft.maxChanges === 1 ? "once" : `${draft.maxChanges} times`;
  const fee = draft.changeFeePercent > 0 ? `, ${draft.changeFeePercent}% fee` : ", free";
  return `${guests}. Move the day up to ${minutesBeforeLabel(draft.moveCutoffMinutes)}, ${times}${fee}.`;
}

export function inclusionLine(item: InclusionDraft): string {
  const label = item.label.trim() || "Unnamed";
  switch (item.kind) {
    case "menu_item":
      return `${item.menuQty > 1 ? `${item.menuQty} × ` : ""}${label} ${item.qtyPer === "guest" ? "each" : "for the group"}`;
    case "staff":
      return `${label}, 1 for every ${item.staffRatio} guests`;
    case "choice":
      return `${label}: ${item.options.length > 0 ? item.options.join(" / ") : "no options yet"}`;
    default:
      return label;
  }
}

export function startTimesLine(draft: PackageDraft): string {
  const times = startTimesFor(draft.firstStart, draft.lastStart, draft.startEvery);
  return times.length === 0 ? "No start times yet" : times.join(" · ");
}

export function reviewItems(draft: PackageDraft, pool: VenueCapacityPool | null, currency: string | null): Array<{ key: string; label: string; value: string }> {
  return [
    { key: "price", label: "Price", value: priceLine(draft, currency) },
    { key: "size", label: "Group size", value: groupSizeLine(draft) },
    {
      key: "included",
      label: "Included",
      value: draft.inclusions.length === 0 ? "Nothing listed" : draft.inclusions.map(inclusionLine).join(" · "),
    },
    {
      key: "extras",
      label: "Extras",
      value:
        draft.extras.length === 0
          ? "None"
          : draft.extras.map((e) => `${e.name.trim()} ${money(e.priceMinor ?? 0, currency)} ${e.per === "guest" ? "a guest" : "a booking"}`).join(" · "),
    },
    {
      key: "when",
      label: "Starts",
      value: `${weekdaysSummary(draft.weekdays)} · ${startTimesLine(draft)} · each booking lasts ${durationWords(draft.durationMinutes)}`,
    },
    { key: "where", label: "Where", value: `Any open space · counts against ${pool !== null ? `the ${pool.dailyLimit.toLocaleString("en-GB")} guests a day` : "the day limit"}` },
    { key: "notice", label: "Book at least", value: draft.minNoticeMinutes <= 0 ? "Any time before" : minutesBeforeLabel(draft.minNoticeMinutes).replace(/ before$/, " ahead") },
    { key: "pay", label: "Paying", value: depositLine(draft, currency) },
    { key: "refunds", label: "Refunds", value: refundSummary(ladderFor(draft)) },
    { key: "changes", label: "Changes", value: changeLine(draft) },
  ];
}

export interface PackageReadinessLine {
  text: string;
  step: PackageStepId | null;
}

export function packageReadinessLine(reason: string): PackageReadinessLine {
  switch (reason) {
    case "feature_off":
      return { text: "Group packages are switched off for this venue. Turn them on in Settings › Venue type and features.", step: null };
    case "no_price_option":
      return { text: "Set the price.", step: "price" };
    case "option_unit_invalid":
      return { text: "Check how the price is charged.", step: "price" };
    case "guest_max_over_capacity":
      return { text: "The largest group is more than the venue takes in a day.", step: "price" };
    case "no_policy":
      return { text: "Choose your refund rules.", step: "rules" };
    case "no_schedule":
    case "no_start_times":
      return { text: "Set the start times.", step: "where" };
    case "no_day_limit":
      return { text: "Set how many guests the venue takes a day.", step: "where" };
    case "stay_venue":
      return { text: "Stays can't sell group packages yet.", step: null };
    default:
      return { text: "Something on this package still needs finishing.", step: null };
  }
}

/** Plain words for package-only refusals (the shared copy covers the rest). */
export function packageErrorCopy(code: string): string | null {
  switch (code) {
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
    default:
      return null;
  }
}

/** The F4 warning: the brand can't take payments online yet. */
export const ONLINE_PAYMENTS_OFF =
  "Guests can't pay online until your brand's payments are set up. You can still publish; guests see it as sold at the venue only.";
