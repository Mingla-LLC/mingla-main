/**
 * Tester-owned adversarial guard for issue #3395.
 *
 * A browser or native bridge may preserve harmless whitespace/case in the
 * country field, and a pasted international number may disagree with a stale
 * picker. The server boundary must normalise the metadata but trust an explicit
 * 00 calling code over that stale metadata. This exercises the shared server
 * resolver, not the parser-only examples in the implementor guard.
 *
 * FAILS ON TRUE REVERT: reverting issue #3395 removes `_shared/buyerPhone.ts`,
 * so this suite cannot import; restoring the implementation makes both
 * transport-boundary matrices pass.
 */
import { describe, expect, test } from "@jest/globals";

import { resolveBuyerPhone } from "../../../../supabase/functions/_shared/buyerPhone";

describe("#3395 buyer phone transport metadata — tester adversarial", () => {
  test.each([
    ["0803 123 4567", " ng ", "+2348031234567"],
    ["07700 900123", "\tgb\n", "+447700900123"],
    ["(415) 555-0123", " us ", "+14155550123"],
  ])("normalises the transported ISO for %s", (raw, iso, expected) => {
    expect(resolveBuyerPhone(raw, iso)).toEqual({
      e164: expected,
      message: null,
      legacyNanpGuess: false,
    });
  });

  test.each([
    ["00234 803 123 4567", "GB", "+2348031234567"],
    ["0044 7700 900123", "NG", "+447700900123"],
    ["001 415 555 0123", "GB", "+14155550123"],
  ])(
    "lets explicit 00 calling code override stale %s metadata",
    (raw, iso, expected) => {
      expect(resolveBuyerPhone(raw, iso)).toEqual({
        e164: expected,
        message: null,
        legacyNanpGuess: false,
      });
    },
  );
});
