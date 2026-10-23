import { describe, expect, test } from "@jest/globals";
import type { DiscountDraft } from "../../../services/discountService";
import {
  canCreateDiscountKind,
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
});
