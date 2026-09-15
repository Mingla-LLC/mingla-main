/**
 * issue #3380 — the ordering rails read a guest's phone WITH their country.
 *
 * `venue-order-create` ("Who's ordering?") and `venue-order-staff` ("Send the
 * bill to their phone") both used `normalizePhoneE164`, which knew "+…" or ten
 * digits it assumed were American. A Lagos guest's `0803 123 4567` was refused
 * and `803 123 4567` became +1 803 123 4567.
 *
 * Lives in the Business jest suite (the required gate) because no existing Deno
 * lane lists a new file and new workflow wrappers are forbidden (#2148).
 *
 * The wiring of both functions is proven in the Deno ordering suites
 * (T-3380-P1 in issue_1793_guest_ordering, T-3380-P2 in issue_1792_waiter_mode),
 * which run the edge-function source; this file proves the resolver's behaviour.
 *
 * FAILS ON REVERT: delete `_shared/buyerPhone.ts` and the suite cannot import;
 * restore a "ten digits are American" reading with a known country and the
 * country cases fail.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LEGACY_NANP_REFUSAL,
  legacyNanpGuessAllowed,
  resolveBuyerPhone,
} from "../../../../supabase/functions/_shared/buyerPhone";

describe("#3380 resolveBuyerPhone — new clients send the country", () => {
  test.each([
    ["0803 123 4567", "NG"],
    ["803 123 4567", "NG"],
    ["+234 803 123 4567", "NG"],
  ])("%s with %s → +2348031234567", (raw, iso) => {
    expect(resolveBuyerPhone(raw, iso)).toEqual({
      e164: "+2348031234567",
      message: null,
      legacyNanpGuess: false,
    });
  });

  test("ten digits with a KNOWN country are never assumed to be American", () => {
    expect(resolveBuyerPhone("8031234567", "NG").e164).toBe("+2348031234567");
    expect(resolveBuyerPhone("7700 900123", "GB").e164).toBe("+447700900123");
    expect(resolveBuyerPhone("4155550123", "US").e164).toBe("+14155550123");
  });

  test("a number that does not fit the chosen country says exactly why", () => {
    const result = resolveBuyerPhone("0803 123 45", "NG");
    expect(result.e164).toBeNull();
    expect(result.message).toBe(
      "Nigerian mobile numbers have 10 digits after the 0 — you entered 8.",
    );
  });

  test("a Nigerian mobile typed under GB is refused instead of becoming a UK number", () => {
    const result = resolveBuyerPhone("0803 123 4567", "GB");
    expect(result.e164).toBeNull();
    expect(result.message).toContain("Nigerian number");
  });

  test.each([
    "garbage4155550123",
    "+234abc8031234567",
  ])("unsupported characters are refused instead of erased: %s", (raw) => {
    const result = resolveBuyerPhone(raw, undefined);
    expect(result.e164).toBeNull();
    expect(result.legacyNanpGuess).toBe(false);
  });

  test("00 international entry needs no country metadata", () => {
    expect(resolveBuyerPhone("0044 7700 900123", undefined)).toEqual({
      e164: "+447700900123",
      message: null,
      legacyNanpGuess: false,
    });
  });

  test("malformed explicit country metadata never enables the legacy +1 guess", () => {
    expect(resolveBuyerPhone("8031234567", "NGA")).toEqual({
      e164: null,
      message: LEGACY_NANP_REFUSAL,
      legacyNanpGuess: false,
    });
  });

  test("a country the rules do not characterise asks for the +code", () => {
    const result = resolveBuyerPhone("0412 345 678", "AU");
    expect(result.e164).toBeNull();
    expect(result.message).toBe(LEGACY_NANP_REFUSAL);
    expect(resolveBuyerPhone("+61 412 345 678", "AU").e164).toBe("+61412345678");
  });
});

describe("#3380 resolveBuyerPhone — deployed clients keep working", () => {
  test("an E.164 value passes through byte-for-byte, country or not", () => {
    for (const phone of ["+2348031234567", "+14155550123", "+23409076649069"]) {
      expect(resolveBuyerPhone(phone, undefined)).toEqual({
        e164: phone,
        message: null,
        legacyNanpGuess: false,
      });
      expect(resolveBuyerPhone(phone, "GB").e164).toBe(phone);
    }
  });

  test("a +number typed with spaces is read, not refused", () => {
    expect(resolveBuyerPhone("+234 803 123 4567", undefined).e164).toBe(
      "+2348031234567",
    );
  });

  test("bare ten digits keep the old reading but are flagged as a guess", () => {
    expect(resolveBuyerPhone("4155550123", undefined)).toEqual({
      e164: "+14155550123",
      message: null,
      legacyNanpGuess: true,
    });
    expect(resolveBuyerPhone("14155550123", null).legacyNanpGuess).toBe(true);
  });

  test("0803… without a country is refused with a way to fix it", () => {
    expect(resolveBuyerPhone("08031234567", undefined)).toEqual({
      e164: null,
      message: LEGACY_NANP_REFUSAL,
      legacyNanpGuess: false,
    });
  });

  test("an empty field keeps the generic 'we need a phone number' copy", () => {
    expect(resolveBuyerPhone("", "NG")).toEqual({
      e164: null,
      message: null,
      legacyNanpGuess: false,
    });
    expect(resolveBuyerPhone(undefined, "NG").message).toBeNull();
  });

  test("the ten-digit guess is believed only at a North American venue", () => {
    expect(legacyNanpGuessAllowed("US")).toBe(true);
    expect(legacyNanpGuessAllowed("ca")).toBe(true);
    expect(legacyNanpGuessAllowed(null)).toBe(false);
    expect(legacyNanpGuessAllowed(undefined)).toBe(false);
    expect(legacyNanpGuessAllowed("")).toBe(false);
    expect(legacyNanpGuessAllowed("NG")).toBe(false);
    expect(legacyNanpGuessAllowed("GB")).toBe(false);
  });

  test("the Deno import is type-checked without a blanket suppression", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../../supabase/functions/_shared/buyerPhone.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*\/\/\s*@ts-ignore\b/m);
  });
});
