// META-ORCH-1161 go-live-prep [US quiet-hours recipient TZ] — TESTER adversarial.
//
// Run: deno test --allow-read supabase/functions/marketing-send/quiet-hours-tz.tester.test.ts
//
// DIFFERENT ANGLE from the implementor's quiet-hours-tz.test.ts: that test
// RE-IMPLEMENTS resolveRecipientTz/isWithinQuietHours with a HAND-PICKED 8-entry
// area-code map, so it can pass even if the SHIPPED map in index.ts is wrong for
// a real code. This test extracts the ACTUAL US_AREACODE_TZ map verbatim from the
// deployed source and asserts against THAT, plus the boundary cases the
// implementor did not cover:
//   - 8:30 AM Eastern is ALLOWED (just inside the window-open boundary);
//   - exactly 9:00 PM (21:00) is BLOCKED (window is [8,21) — endHour exclusive);
//   - exactly 8:00 AM is ALLOWED (startHour inclusive);
//   - Phoenix (no-DST) is judged in America/Phoenix, NOT America/Denver, in summer;
//   - NG at exactly 8:00 PM (20:00 WAT) is BLOCKED (endHour exclusive);
//   - a null country code → DENY;
//   - the shipped map actually contains the real SF + NYC codes (anti-drift on the
//     LIVE map, not a re-implemented copy).
//
// fails-on-revert: the source-anchor block fails on a true line-deletion of the
// US area-code branch (a revert to a fixed America/New_York anchor).

import { assert, assertEquals } from "jsr:@std/assert@1";

const SRC = await Deno.readTextFile("supabase/functions/marketing-send/index.ts");

// ── Extract the ACTUAL US_AREACODE_TZ map from the deployed source ───────────
// The source builds it via add("<tz>", ["code", ...]) calls. Parse those.
function extractShippedMap(src: string): Record<string, string> {
  const start = src.indexOf("const US_AREACODE_TZ");
  assert(start >= 0, "US_AREACODE_TZ must exist in the shipped source");
  const end = src.indexOf("})();", start);
  assert(end > start, "US_AREACODE_TZ IIFE must terminate");
  const block = src.slice(start, end);
  const map: Record<string, string> = {};
  const addRe = /add\(\s*"([^"]+)"\s*,\s*\[([\s\S]*?)\]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = addRe.exec(block)) !== null) {
    const tz = m[1];
    for (const codeMatch of m[2].matchAll(/"(\d{3})"/g)) {
      map[codeMatch[1]] = tz;
    }
  }
  return map;
}
const SHIPPED = extractShippedMap(SRC);
const QUIET = { US: { startHour: 8, endHour: 21 }, NG: { startHour: 8, endHour: 20 } } as const;

function resolveTz(phone: string, cc: string | null): string | null {
  const C = (cc ?? "").toUpperCase();
  if (C === "NG") return "Africa/Lagos";
  if (C === "US") {
    const digits = phone.replace(/[^0-9]/g, "");
    const national = digits.startsWith("1") ? digits.slice(1) : digits;
    return SHIPPED[national.slice(0, 3)] ?? null;
  }
  return null;
}
function withinWindow(phone: string, cc: string | null, now: Date): boolean {
  const C = (cc ?? "").toUpperCase();
  if (C !== "US" && C !== "NG") return false;
  const tz = resolveTz(phone, cc);
  if (tz === null) return false;
  const market: "US" | "NG" = C === "NG" ? "NG" : "US";
  const { startHour, endHour } = QUIET[market];
  let h: number;
  try {
    h = parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now),
      10,
    );
    if (Number.isNaN(h)) return false;
  } catch {
    return false;
  }
  return h >= startHour && h < endHour;
}

Deno.test("the SHIPPED map maps real SF (415→Pacific) and NYC (212→Eastern) codes", () => {
  assertEquals(SHIPPED["415"], "America/Los_Angeles");
  assertEquals(SHIPPED["212"], "America/New_York");
  assertEquals(SHIPPED["602"], "America/Phoenix"); // no-DST
});

Deno.test("window-open boundary: 8:00 AM ET is ALLOWED, 7:59 AM is BLOCKED", () => {
  // 12:00 UTC = 8:00 ET (summer, UTC-4) → allowed.
  assertEquals(withinWindow("+12125550000", "US", new Date("2026-07-15T12:00:00Z")), true);
  // 11:59 UTC = 7:59 ET → blocked.
  assertEquals(withinWindow("+12125550000", "US", new Date("2026-07-15T11:59:00Z")), false);
});

Deno.test("8:30 AM Eastern is ALLOWED (implementor only tested 8:00 exact)", () => {
  assertEquals(withinWindow("+12125550000", "US", new Date("2026-07-15T12:30:00Z")), true);
});

Deno.test("window-close boundary: 21:00 (9 PM) ET is BLOCKED — endHour exclusive", () => {
  // 01:00 UTC next day = 21:00 ET prior day (summer). 20:59 ET allowed.
  assertEquals(withinWindow("+12125550000", "US", new Date("2026-07-16T01:00:00Z")), false);
  assertEquals(withinWindow("+12125550000", "US", new Date("2026-07-16T00:59:00Z")), true);
});

Deno.test("Phoenix (no-DST) judged in America/Phoenix, NOT Denver, in summer", () => {
  // Summer: Denver=UTC-6 (MDT), Phoenix=UTC-7 (MST, no DST). At 14:00 UTC →
  // Denver 8:00 (allowed) but Phoenix 7:00 (blocked). Proves the Phoenix zone is used.
  const t = new Date("2026-07-15T14:00:00Z");
  assertEquals(withinWindow("+16025550000", "US", t), false, "Phoenix 7 AM must be blocked");
  assertEquals(withinWindow("+13035550000", "US", t), true, "Denver 8 AM allowed (control)");
});

Deno.test("NG 20:00 WAT (8 PM) is BLOCKED — endHour exclusive; 19:59 allowed", () => {
  // WAT = UTC+1. 19:00 UTC = 20:00 WAT → blocked. 18:58 UTC = 19:58 WAT → allowed.
  assertEquals(withinWindow("+2348000000000", "NG", new Date("2026-07-15T19:00:00Z")), false);
  assertEquals(withinWindow("+2348000000000", "NG", new Date("2026-07-15T18:58:00Z")), true);
});

Deno.test("null/empty country code → conservative DENY", () => {
  assertEquals(withinWindow("+12125550000", null, new Date("2026-07-15T12:00:00Z")), false);
  assertEquals(withinWindow("+12125550000", "", new Date("2026-07-15T12:00:00Z")), false);
});

Deno.test("anti-revert: the US branch derives the zone from the area code", () => {
  assert(SRC.includes("US_AREACODE_TZ[areaCode] ?? null"),
    "the US branch must map the area code, not return a fixed zone");
  assert(SRC.includes("const areaCode = national.slice(0, 3);"),
    "area-code extraction must exist");
  assert(!/US:\s*\{\s*tz:\s*"America\/New_York"/.test(SRC),
    "no fixed-Eastern US anchor may remain");
});
