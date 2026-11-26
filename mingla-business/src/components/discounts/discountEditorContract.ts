import type {
  BrandPriceRow,
  DiscountCombinesWith,
  DiscountDraft,
  DiscountKind,
  DiscountOfferingKind,
  DiscountOfferingRow,
  DiscountScopeKind,
  DiscountTarget,
} from "../../services/discountService";
import { currencyCodeOrNull, formatCurrency } from "../../utils/currency";

export const DISCOUNT_COMBINATION_LABELS: Record<DiscountCombinesWith, string> =
  {
    none: "Nothing else",
    automatic_only: "Automatic discounts",
    any: "Any eligible discount",
  };

export const DISCOUNT_KIND_OPTIONS: readonly {
  kind: DiscountKind;
  label: string;
}[] = Object.freeze([
  { kind: "code", label: "Code" },
  { kind: "automatic", label: "Automatic" },
  { kind: "sale_price", label: "Sale price" },
]);

export const DISCOUNT_KIND_DESCRIPTIONS: Readonly<
  Record<DiscountKind, string>
> = Object.freeze({
  code: "Buyers enter a code at checkout.",
  automatic: "The best eligible deal is applied automatically.",
  sale_price: "Show a lower price on selected items.",
});

// #4624: the scope options and labels live in a tiny module of their own so the
// discounts list can read the labels without pulling this contract into the
// shared web boot chunk (two lazy chunks importing one module hoist it).
export {
  DISCOUNT_SCOPE_LABELS,
  DISCOUNT_SCOPE_OPTIONS,
} from "./discountScopeLabels";

/**
 * #4624 D5: a sale price (set price) works on one specific item, so every
 * other scope card is disabled for it (bd_sale_price_items / bd_set_price_items).
 */
export const isDiscountScopeAvailable = (
  kind: DiscountKind,
  scope: DiscountScopeKind,
): boolean => kind !== "sale_price" || scope === "items";

export const SALE_PRICE_SCOPE_HELP = "Sale prices apply to specific items only.";

export const formatDiscountPreviewMoney = (
  minor: number,
  currencyCode: string | null,
): string => {
  const code = currencyCodeOrNull(currencyCode);
  return code === null ? "—" : formatCurrency(minor, code, true);
};

export const canCreateDiscountKind = (
  rank: number,
  kind: DiscountKind,
): boolean => kind === "code" || rank >= 30;

export const isDiscountDraftValid = (
  draft: DiscountDraft,
  rank: number,
): boolean =>
  draft.name.trim().length > 0 &&
  canCreateDiscountKind(rank, draft.kind) &&
  (draft.kind !== "code" ||
    /^[A-Z0-9]{4,16}$/.test(
      (draft.code ?? "").replace(/[\s-]/g, "").toUpperCase(),
    )) &&
  (draft.valueType === "percent"
    ? (draft.valueBps ?? 0) > 0 && (draft.valueBps ?? 0) <= 10000
    : (draft.valueMinor ?? 0) > 0) &&
  (draft.scopeKind === "brand" || draft.targets.length > 0) &&
  // #4624: a deleted target blocks Save on every scope until it is removed.
  !hasOrphanedDiscountTarget(draft.targets) &&
  (!draft.endsAt ||
    new Date(draft.endsAt).getTime() > new Date(draft.startsAt).getTime());

/**
 * #4624 D4: why Save is disabled, in the order the Host fixes things; null
 * exactly when the draft is valid. Shown above Save and as its a11y hint.
 */
export const discountSaveBlockedReason = (
  draft: DiscountDraft,
  rank: number,
): string | null => {
  if (!canCreateDiscountKind(rank, draft.kind)) {
    return "Your role can create codes only. Choose Code to save.";
  }
  if (draft.name.trim().length === 0) return "Add a name to save.";
  if (
    draft.kind === "code" &&
    !/^[A-Z0-9]{4,16}$/.test(
      (draft.code ?? "").replace(/[\s-]/g, "").toUpperCase(),
    )
  ) {
    return "Enter a code of 4 to 16 letters or numbers to save.";
  }
  if (
    draft.valueType === "percent"
      ? !((draft.valueBps ?? 0) > 0 && (draft.valueBps ?? 0) <= 10000)
      : !((draft.valueMinor ?? 0) > 0)
  ) {
    return draft.valueType === "percent"
      ? "Enter a percentage from 1 to 100 to save."
      : "Enter an amount above zero to save.";
  }
  if (hasOrphanedDiscountTarget(draft.targets)) {
    return draft.scopeKind === "listings"
      ? "Remove the deleted offering to save."
      : "Remove the deleted item to save.";
  }
  if (draft.scopeKind !== "brand" && draft.targets.length === 0) {
    switch (draft.scopeKind) {
      case "listing_kinds":
        return "Pick at least one offering type to save.";
      case "listings":
        return "Pick at least one offering to save.";
      case "items":
        return "Pick at least one item to save.";
      default: {
        const unreachable: never = draft.scopeKind;
        return unreachable;
      }
    }
  }
  if (
    draft.endsAt &&
    !(new Date(draft.endsAt).getTime() > new Date(draft.startsAt).getTime())
  ) {
    return "Set the end after the start to save.";
  }
  return null;
};

export const DISCOUNT_LISTING_KIND_OPTIONS = [
  ["event", "Events"],
  ["experience", "Experiences"],
  ["trip", "Trips"],
  ["venue_order", "Venue food & drink"],
  ["reservation_deposit", "Reservation deposits"],
] as const;

export const isDiscountPriceSelectable = (price: BrandPriceRow): boolean =>
  price.discountsAllowed;

export function hasOrphanedDiscountTarget(targets: DiscountTarget[]): boolean {
  return targets.some((target) => target.orphanedAt != null);
}

// ---------------------------------------------------------------------------
// #4624 "Specific offerings" picker model (pure; the picker renders it).
// ---------------------------------------------------------------------------

export const DISCOUNT_OFFERING_GROUPS: readonly {
  kind: DiscountOfferingKind;
  label: string;
  singular: string;
}[] = Object.freeze([
  { kind: "event", label: "Events", singular: "event" },
  { kind: "experience", label: "Experiences", singular: "experience" },
  { kind: "trip", label: "Trips", singular: "trip" },
]);

export const OFFERINGS_HELP =
  "New tickets added to these offerings are included. Items with Allow discounts turned off are still excluded.";

export const offeringTarget = (id: string): DiscountTarget => ({
  targetKind: "event",
  targetId: id,
  listingKind: null,
});

const isEndedOffering = (row: DiscountOfferingRow): boolean =>
  row.status === "ended" || row.status === "cancelled";

const dayFormat = (iso: string, withWeekday: boolean): string | null => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat(
    "en-GB",
    withWeekday
      ? { weekday: "short", day: "numeric", month: "short" }
      : { day: "numeric", month: "short" },
  ).format(at);
};

/** "Fri 12 Dec", or "9–11 Jan" for a multi-day trip; null when undated. */
export const formatOfferingDate = (row: DiscountOfferingRow): string | null => {
  if (!row.nextStartAt) return null;
  const start = new Date(row.nextStartAt);
  const end = row.lastEndAt ? new Date(row.lastEndAt) : null;
  if (
    row.offeringKind === "trip" &&
    end !== null &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    end.toDateString() !== start.toDateString()
  ) {
    const sameMonth =
      start.getMonth() === end.getMonth() &&
      start.getFullYear() === end.getFullYear();
    const endText = dayFormat(row.lastEndAt as string, false);
    return sameMonth
      ? `${start.getDate()}–${endText ?? ""}`
      : `${dayFormat(row.nextStartAt, false) ?? ""} – ${endText ?? ""}`;
  }
  return dayFormat(row.nextStartAt, true);
};

/** The row's meta line (design §5, D6). */
export const offeringMeta = (row: DiscountOfferingRow): string => {
  if (!row.discountsAllowed) return "Discounts are off for this offering";
  if (isEndedOffering(row)) {
    const at = row.lastEndAt ?? row.nextStartAt;
    const date = at ? dayFormat(at, true) : null;
    const word = row.status === "cancelled" ? "Cancelled" : "Ended";
    return date ? `${word} · ${date}` : word;
  }
  const tickets =
    row.paidTicketCount === 0
      ? "No paid tickets yet"
      : `${row.paidTicketCount} paid ticket${row.paidTicketCount === 1 ? "" : "s"}`;
  const date = formatOfferingDate(row);
  return [row.status === "draft" ? "Draft" : null, date, tickets]
    .filter((part): part is string => part !== null)
    .join(" · ");
};

export interface DiscountOfferingGroupModel {
  kind: DiscountOfferingKind;
  label: string;
  singular: string;
  rows: DiscountOfferingRow[];
}

/**
 * Groups in Events / Experiences / Trips order; empty groups dropped. Ended or
 * cancelled offerings show only when selected (or kept visible after an
 * untick this sheet session) and lead their group.
 */
export const groupDiscountOfferings = (
  offerings: DiscountOfferingRow[],
  selectedIds: ReadonlySet<string>,
  keepVisibleIds: ReadonlySet<string> = new Set(),
): DiscountOfferingGroupModel[] =>
  DISCOUNT_OFFERING_GROUPS.map(({ kind, label, singular }) => {
    const ofKind = offerings.filter((row) => row.offeringKind === kind);
    const ended = ofKind.filter(
      (row) =>
        isEndedOffering(row) &&
        (selectedIds.has(row.id) || keepVisibleIds.has(row.id)),
    );
    const open = ofKind.filter((row) => !isEndedOffering(row));
    return { kind, label, singular, rows: [...ended, ...open] };
  }).filter((group) => group.rows.length > 0);

/** Targets the picker must show as "Deleted offering" with Remove. */
export const deletedOfferingTargets = (
  targets: DiscountTarget[],
  offerings: DiscountOfferingRow[] | null,
): DiscountTarget[] => {
  const known = new Set((offerings ?? []).map((row) => row.id));
  return targets.filter(
    (target) =>
      target.targetKind === "event" &&
      (target.orphanedAt != null ||
        (offerings !== null && !known.has(target.targetId ?? ""))),
  );
};

/** "None selected" / "1 selected" / "{n} selected". */
export const offeringCountLabel = (count: number): string =>
  count === 0 ? "None selected" : `${count} selected`;
