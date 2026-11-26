import { describe, expect, test } from "@jest/globals";
import type { DiscountDraft } from "../../../services/discountService";
import {
  applyDiscountKindChange,
  canCreateDiscountKind,
  discountSaveBlockedReason,
  DISCOUNT_COMBINATION_LABELS,
  DISCOUNT_KIND_OPTIONS,
  isDiscountDraftValid,
} from "../discountEditorContract";

const validCode = (): DiscountDraft => ({
  brandId: "brand-1",
  kind: "code",
  code: "SAVE10",
  name: "Save ten",
  valueType: "percent",
  valueBps: 1000,
  valueMinor: null,
  scopeKind: "brand",
  combinesWith: "automatic_only",
  startsAt: "2027-01-01T00:00:00.000Z",
  endsAt: "2027-01-02T00:00:00.000Z",
  targets: [],
});

describe("DiscountEditSheet Host decision contract", () => {
  test("renders every Host-controlled discount choice and its validation", () => {
    expect(DISCOUNT_KIND_OPTIONS).toEqual([
      { kind: "code", label: "Code" },
      { kind: "automatic", label: "Automatic" },
      { kind: "sale_price", label: "Sale price" },
    ]);
    expect(DISCOUNT_COMBINATION_LABELS).toEqual({
      none: "Nothing else",
      automatic_only: "Automatic discounts",
      any: "Any eligible discount",
    });
    expect(isDiscountDraftValid(validCode(), 20)).toBe(true);
    expect(isDiscountDraftValid({ ...validCode(), code: "BAD" }, 20)).toBe(
      false,
    );
    expect(isDiscountDraftValid({ ...validCode(), valueBps: 10001 }, 20)).toBe(
      false,
    );
  });

  test("keeps automatic and sale-price creation behind rank 30", () => {
    expect(canCreateDiscountKind(20, "code")).toBe(true);
    expect(canCreateDiscountKind(20, "automatic")).toBe(false);
    expect(canCreateDiscountKind(20, "sale_price")).toBe(false);
    expect(canCreateDiscountKind(30, "automatic")).toBe(true);
    expect(canCreateDiscountKind(30, "sale_price")).toBe(true);
  });
  test("#4624 P2-1: switching to Sale price clears offering targets so Save is blocked until an item is picked", () => {
    const withOffering: DiscountDraft = {
      ...validCode(),
      scopeKind: "listings",
      targets: [
        { targetKind: "event", targetId: "e1", listingKind: null, orphanedAt: null },
      ],
    };
    const next = applyDiscountKindChange(withOffering, "sale_price");
    expect(next.scopeKind).toBe("items");
    expect(next.targets).toEqual([]);
    expect(isDiscountDraftValid({ ...next, name: "Sale", valueMinor: 500 }, 30)).toBe(false);
    expect(discountSaveBlockedReason({ ...next, name: "Sale", valueMinor: 500 }, 30)).toBe(
      "Pick at least one item to save.",
    );
  });

  test("#4624 P2-1: a kind change that keeps the scope keeps its targets", () => {
    const items: DiscountDraft = {
      ...validCode(),
      scopeKind: "items",
      targets: [
        { targetKind: "ticket_type", targetId: "t1", listingKind: null, orphanedAt: null },
      ],
    };
    expect(applyDiscountKindChange(items, "sale_price").targets).toHaveLength(1);
  });
});
