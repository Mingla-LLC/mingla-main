import type {
  BrandPriceRow,
  DiscountCombinesWith,
  DiscountDraft,
  DiscountKind,
  DiscountTarget,
} from "../../services/discountService";

export const DISCOUNT_COMBINATION_LABELS: Record<DiscountCombinesWith, string> =
  {
    none: "Nothing else",
    automatic_only: "Automatic discounts",
    any: "Any eligible discount",
  };

export const DISCOUNT_KIND_OPTIONS: ReadonlyArray<{
  kind: DiscountKind;
  label: string;
}> = Object.freeze([
  { kind: "code", label: "Code" },
  { kind: "automatic", label: "Automatic" },
  { kind: "sale_price", label: "Sale price" },
]);

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
  (!draft.endsAt ||
    new Date(draft.endsAt).getTime() > new Date(draft.startsAt).getTime());

export const DISCOUNT_LISTING_KIND_OPTIONS = [
  ["event", "Events"],
  ["experience", "Experiences"],
  ["trip", "Trips"],
  ["venue_order", "Venue food & drink"],
  ["reservation_deposit", "Reservation deposits"],
] as const;

export const isDiscountPriceSelectable = (price: BrandPriceRow): boolean =>
  price.discountsAllowed;

export const hasOrphanedDiscountTarget = (targets: DiscountTarget[]): boolean =>
  targets.some((target) => target.orphanedAt != null);
