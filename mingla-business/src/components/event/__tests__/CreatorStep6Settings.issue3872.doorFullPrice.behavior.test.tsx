import { describe, expect, test } from "@jest/globals";
import {
  doorFullPriceNotice,
  DOOR_FULL_PRICE_NOTICE,
} from "../../discounts/discountUiContract";

describe("CreatorStep6Settings door-price decision", () => {
  test("renders only while in-person payments are enabled", () => {
    expect(doorFullPriceNotice(false)).toBeNull();
    expect(doorFullPriceNotice(true)).toBe(DOOR_FULL_PRICE_NOTICE);
    expect(DOOR_FULL_PRICE_NOTICE).toBe("Door sales are always full price.");
  });
});
