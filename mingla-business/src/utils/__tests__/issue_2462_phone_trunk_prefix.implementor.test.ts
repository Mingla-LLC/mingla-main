/**
 * issue #2462 — NIGERIAN PHONE NUMBERS WERE SILENTLY CORRUPTED.
 *
 * `composeE164` was `dialCode + digits.replace(/\D/g,"")` with no normalisation.
 * `isValidE164` only asks "1–15 digits, first non-zero", so
 * `composeE164("+234","09076649069")` produced `"+23409076649069"` — 14 digits,
 * not a real Nigerian number — and it passed the client regex AND the server
 * regex `^\+[1-9][0-9]{1,14}$`. Confirmed against the production RPC: that exact
 * string was ACCEPTED.
 *
 * Measured on live rows: 17 of 71 We Go Again buyers, 19 of 114 platform-wide,
 * including a Nigerian number carrying the US dial code (`+109069902335`) and one
 * wrapped in the UK dial code (`+442348158037496`). Those guests reserved
 * successfully and could never receive their pass by SMS.
 *
 * FAILS ON REVERT: restore the one-line body and the trunk-zero and
 * wrong-country cases below fail.
 */
import { describe, expect, test } from "@jest/globals";

import { composeE164, isValidE164 } from "../phone";

describe("issue #2462 — composeE164 drops the national trunk prefix", () => {
  test("a Nigerian number typed the way Nigerians write it", () => {
    // THE BUG, verbatim from production session +23409076649069.
    expect(composeE164("+234", "09076649069")).toBe("+2349076649069");
  });

  test("a Nigerian number typed without the trunk zero is unchanged", () => {
    // Regression guard: the common-good path must not move.
    expect(composeE164("+234", "9071364247")).toBe("+2349071364247");
  });

  test("spaces and punctuation are still ignored", () => {
    expect(composeE164("+234", "0803 123 4567")).toBe("+2348031234567");
  });

  test("Italy KEEPS its leading zero — it is part of the subscriber number", () => {
    expect(composeE164("+39", "0612345678")).toBe("+390612345678");
  });

  test("a pasted full international number is not doubled", () => {
    // Guests paste their whole number into a field already showing +234.
    expect(composeE164("+234", "2348012345678")).toBe("+2348012345678");
  });

  test("a legitimate NANP number in area code 234 keeps its area code", () => {
    // The duplicate-country-code strip must NOT eat a real Ohio area code.
    expect(composeE164("+1", "2345551234")).toBe("+12345551234");
  });
});

describe("issue #2462 — composeE164 refuses numbers it cannot believe", () => {
  test("a Nigerian number sent on the US dial code is refused", () => {
    // Production row +109069902335 — the picker default was never changed.
    // Refusing is the point: the guest sees an invalid field instead of
    // reserving a pass against an address that can never receive it.
    expect(composeE164("+1", "09069902335")).toBeNull();
  });

  test("a Nigerian number wrapped in the UK dial code is refused", () => {
    // Production row +442348158037496.
    expect(composeE164("+44", "2348158037496")).toBeNull();
  });

  test("too many digits for Nigeria is refused", () => {
    expect(composeE164("+234", "080312345678")).toBeNull();
  });

  test("too few digits for Nigeria is refused", () => {
    expect(composeE164("+234", "80312345")).toBeNull();
  });

  test("empty and zero-only input stay null", () => {
    expect(composeE164("+234", "")).toBeNull();
    expect(composeE164("+234", "abc")).toBeNull();
    expect(composeE164("+234", "000")).toBeNull();
  });

  test("an uncharacterised country still works exactly as before", () => {
    // No NSN entry -> generic E.164 only. This table may make validation
    // stricter for countries we understand; it must never start rejecting one
    // we have not characterised.
    const composed = composeE164("+61", "412345678");
    expect(composed).toBe("+61412345678");
    expect(isValidE164(composed ?? "")).toBe(true);
  });

  test("the trunk zero is dropped for an uncharacterised country too", () => {
    // Stripping is the DEFAULT; the carve-out is Italy, not the other way round.
    expect(composeE164("+61", "0412345678")).toBe("+61412345678");
  });
});
