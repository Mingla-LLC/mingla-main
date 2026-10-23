import { describe, expect, jest, test } from "@jest/globals";
import {
  canShowDiscountsOperation,
  DISCOUNTS_OPERATION_COPY,
} from "../../discounts/discountOperationContract";

describe("BrandProfileView discounts entry", () => {
  test("stays absent below rank 20, on access failure, and when the flag is off", () => {
    const open = jest.fn();
    expect(canShowDiscountsOperation(19, true, open)).toBe(false);
    expect(canShowDiscountsOperation(20, false, open)).toBe(false);
    expect(canShowDiscountsOperation(30, true, undefined)).toBe(false);
    expect(canShowDiscountsOperation(20, true, open)).toBe(true);
  });

  test("renders the exact Host operations row when access is on", () => {
    expect(DISCOUNTS_OPERATION_COPY).toEqual({
      label: "Discounts",
      sub: "Codes, automatic discounts and sale prices",
    });
  });
});
