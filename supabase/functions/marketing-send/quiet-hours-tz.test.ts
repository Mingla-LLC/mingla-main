// META-ORCH-1161 go-live-prep [US quiet-hours recipient TZ] — implementor Step-0.5
// regression (P3-1 carry-forward).
//
// Run locally:
//   deno test --allow-read supabase/functions/marketing-send/quiet-hours-tz.test.ts
//
// Angle: BEHAVIOR + SOURCE-CONTRACT. The bug: US quiet-hours anchored EVERY +1
// number to America/New_York, so a West-Coast recipient could get a text at
// 5 AM local (8 AM ET — inside the Eastern window). The fix derives the recipient
// IANA zone from the NANP area code. This test re-implements the deployed
// area-code→TZ map + window logic and asserts:
//   - a West-Coast +1 (415, Pacific) at a moment that is 5 AM PT / 8 AM ET is
//     BLOCKED (was wrongly allowed under the Eastern anchor);
//   - the same instant for an Eastern +1 (212) at 8 AM ET is ALLOWED;
//   - an unknown area code → DENY (no Eastern guess);
//   - NG still uses the WAT window.
// It also asserts the live source carries the area-code map + the phone-aware
// signature so a TRUE LINE DELETION of the fix fails this test (fails-on-revert).

import { assert, assertEquals } from "jsr:@std/assert@1";

const SRC_PATH = "supabase/functions/marketing-send/index.ts";
const SRC = await Deno.readTextFile(SRC_PATH);

function srcContains(needle: string, why: string) {
  assert(SRC.includes(needle), `marketing-send/index.ts must contain \`${needle}\` (${why})`);
}

// ── Re-implementation of the deployed area-code→TZ + window logic ────────────
const US_AREACODE_TZ: Record<string, string> = {
  "212": "America/New_York", // NYC (Eastern)
  "202": "America/New_York", // DC (Eastern)
  "312": "America/Chicago", // Chicago (Central)
  "303": "America/Denver", // Denver (Mountain)
  "602": "America/Phoenix", // Phoenix (no DST)
  "415": "America/Los_Angeles", // SF (Pacific)
  "907": "America/Anchorage",
  "808": "Pacific/Honolulu",
};
const QUIET_HOURS = {
  US: { startHour: 8, endHour: 21 },
  NG: { startHour: 8, endHour: 20 },
} as const;

function resolveRecipientTz(phone: string, cc: string | null): string | null {
  const C = (cc ?? "").toUpperCase();
  if (C === "NG") return "Africa/Lagos";
  if (C === "US") {
    const digits = phone.replace(/[^0-9]/g, "");
    const national = digits.startsWith("1") ? digits.slice(1) : digits;
    return US_AREACODE_TZ[national.slice(0, 3)] ?? null;
  }
  return null;
}
function isWithinQuietHours(phone: string, cc: string | null, now: Date): boolean {
  const C = (cc ?? "").toUpperCase();
  if (C !== "US" && C !== "NG") return false;
  const tz = resolveRecipientTz(phone, cc);
  if (tz === null) return false;
  const market: "US" | "NG" = C === "NG" ? "NG" : "US";
  const { startHour, endHour } = QUIET_HOURS[market];
  let localHour: number;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
    localHour = parseInt(fmt.format(now), 10);
    if (Number.isNaN(localHour)) return false;
  } catch {
    return false;
  }
  return localHour >= startHour && localHour < endHour;
}

// A summer instant that is 08:00 America/New_York == 05:00 America/Los_Angeles
// (both observing DST in July → ET=UTC-4, PT=UTC-7). 12:00 UTC.
const EIGHT_AM_ET = new Date("2026-07-15T12:00:00Z");

Deno.test("West-Coast +1 at 5 AM local is BLOCKED while it's 8 AM Eastern (the bug fix)", () => {
  assertEquals(
    isWithinQuietHours("+14155550000", "US", EIGHT_AM_ET),
    false,
    "415 (Pacific) at 5 AM PT must be blocked — NOT judged in Eastern time",
  );
});

Deno.test("East-Coast +1 at 8 AM Eastern is ALLOWED at the same instant", () => {
  assertEquals(
    isWithinQuietHours("+12125550000", "US", EIGHT_AM_ET),
    true,
    "212 (Eastern) at 8 AM ET is inside the window",
  );
});

Deno.test("Central + Mountain recipients evaluate in their own zone", () => {
  // 8 AM ET == 7 AM CT == 6 AM MT (all before the 8 AM window start) → blocked.
  assertEquals(isWithinQuietHours("+13125550000", "US", EIGHT_AM_ET), false, "Chicago 7 AM blocked");
  assertEquals(isWithinQuietHours("+13035550000", "US", EIGHT_AM_ET), false, "Denver 6 AM blocked");
});

Deno.test("unknown US area code → conservative DENY (no Eastern guess)", () => {
  assertEquals(isWithinQuietHours("+15005550000", "US", EIGHT_AM_ET), false);
});

Deno.test("NG still uses the WAT window (8 AM–8 PM)", () => {
  // 8 AM ET == 13:00 WAT (UTC+1) → inside NG window.
  assertEquals(isWithinQuietHours("+2348000000000", "NG", EIGHT_AM_ET), true);
  // 23:00 UTC == 00:00 WAT → outside NG window.
  const midnightWat = new Date("2026-07-15T23:00:00Z");
  assertEquals(isWithinQuietHours("+2348000000000", "NG", midnightWat), false);
});

// ── fails-on-revert anchors ─────────────────────────────────────────────────
Deno.test("source carries the area-code map + phone-aware signature (anti-revert)", () => {
  srcContains("US_AREACODE_TZ", "the NANP area-code→IANA timezone map must exist");
  srcContains("resolveRecipientTz", "the per-phone TZ resolver must exist");
  srcContains("function isWithinQuietHours(\n  phone: string,", "isWithinQuietHours must take the phone (not just country)");
  srcContains("isWithinQuietHours(phone, countryCode, now)", "the call site must pass the phone");
  // The LOAD-BEARING derivation: the US branch of resolveRecipientTz MUST look up
  // the area code in the map — NOT return a fixed zone. A revert to a constant
  // (e.g. `return "America/New_York"`) deletes these exact lines → this fails.
  srcContains("const national = digits.startsWith(\"1\") ? digits.slice(1) : digits;", "area-code extraction must exist");
  srcContains("const areaCode = national.slice(0, 3);", "the 3-digit area code must be extracted");
  srcContains("return US_AREACODE_TZ[areaCode] ?? null;", "the US branch must map the area code, not hardcode a zone");
  // The OLD fixed-Eastern anchor comment must be gone.
  assert(
    !SRC.includes('US: "America/New_York", // conservative US-east anchor (earliest 9 PM cutoff)'),
    "the old fixed-Eastern US anchor must be removed (subtract-before-add)",
  );
});
