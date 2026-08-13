import assert from "node:assert/strict";
import test from "node:test";
import { resolveUserPhoneE164 } from "../phone.mjs";

test("#1857 country metadata is provenance, never authority over strict E.164", () => {
  const fixtures = [
    ["  +2348034821689  ", "US", "+2348034821689"],
    ["+441279942348", "NG", "+441279942348"],
    ["+19194199222", undefined, "+19194199222"],
  ];

  for (const [raw, conflictingIso, expected] of fixtures) {
    assert.equal(resolveUserPhoneE164(raw, conflictingIso), expected);
  }
});

test("#1857 refuses ambiguous national evidence instead of guessing a default", () => {
  const ambiguous = [
    ["0803 482 1689", undefined],
    ["01279 942348", null],
    ["(919) 419-9222", "us"],
    ["(919) 419-9222", "USA"],
    ["(919) 419-9222", "ZZ"],
  ];

  for (const [raw, unusableIso] of ambiguous) {
    assert.equal(resolveUserPhoneE164(raw, unusableIso), null);
  }
});
