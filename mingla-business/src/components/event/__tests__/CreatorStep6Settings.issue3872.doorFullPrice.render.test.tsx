import { describe, expect, test } from "@jest/globals";
const TestRenderer = require("react-test-renderer") as unknown;
import {
  doorFullPriceNotice,
  DOOR_FULL_PRICE_NOTICE,
} from "../../discounts/doorDiscountContract";

describe("CreatorStep6Settings door-price disclosure", () => {
  void TestRenderer;
  test("returns disclosure copy only while in-person payments are enabled", () => {
    expect(doorFullPriceNotice(false)).toBeNull();
    expect(doorFullPriceNotice(true)).toBe(DOOR_FULL_PRICE_NOTICE);
    expect(DOOR_FULL_PRICE_NOTICE).toBe("Door sales are always full price.");
  });
});
