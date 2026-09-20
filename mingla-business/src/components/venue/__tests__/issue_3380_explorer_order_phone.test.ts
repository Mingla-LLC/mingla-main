/**
 * issue #3380 — the Explorer "Who's ordering?" phone rules, executed.
 *
 * Lives in the Business jest suite (the one required gate) and imports the
 * app-mobile module by relative path; the module is React-Native-free by design
 * so it resolves here without an app-mobile install. The Explorer wiring is
 * pinned in app-mobile's issue-1793 consumer suite (T-3380-E1..E3).
 *
 * FAILS ON REVERT: delete consumerOrderPhone.ts and the suite cannot import;
 * start the picker on the device before the venue and the Lagos case fails;
 * drop the mobile rules and the landline case fails.
 */
import { describe, expect, test } from "@jest/globals";

import {
  consumerOrderPhoneFailure,
  consumerOrderPhoneStartCountry,
} from "../../../../../app-mobile/src/components/venueOrdering/consumerOrderPhone";

describe("#3380 Explorer ordering phone", () => {
  test("the picker starts on the venue's country, whatever the device says", () => {
    expect(consumerOrderPhoneStartCountry("NG")).toBe("NG");
    expect(consumerOrderPhoneStartCountry("us")).toBe("US");
  });

  test("an unknown venue country falls back to a real country, never a guess", () => {
    const start = consumerOrderPhoneStartCountry("XX");
    expect(start === null || /^[A-Z]{2}$/.test(start)).toBe(true);
    expect(start).not.toBe("XX");
  });

  test("a Lagos guest's normal number is accepted; empty is not an error", () => {
    expect(consumerOrderPhoneFailure("0803 123 4567", "NG")).toBeNull();
    expect(consumerOrderPhoneFailure("", "NG")).toBeNull();
  });

  test("a wrong number says exactly what is wrong, and names the right country", () => {
    expect(consumerOrderPhoneFailure("0803 123 45", "NG")?.message).toBe(
      "Nigerian mobile numbers have 10 digits after the 0 — you entered 8.",
    );
    const wrongFlag = consumerOrderPhoneFailure("08031234567", "GB");
    expect(wrongFlag?.suggestedCountryIso).toBe("NG");
    expect(wrongFlag?.message).toContain("Nigeria (+234)");
  });

  test("the order's 'ready' text needs a mobile, so a landline is refused", () => {
    expect(consumerOrderPhoneFailure("0201 234 5678", "NG")?.message).toMatch(
      /Nigerian mobile numbers start with 07, 08 or 09/,
    );
  });
});
