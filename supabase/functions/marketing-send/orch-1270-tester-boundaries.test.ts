// ORCH-1270 [TESTER — adversarial] — TZ-boundary + termination-bound proofs on
// the REAL SHIPPED decideSmsDisposition.
//
// Run:
//   deno test --allow-read --allow-net --allow-env --no-check \
//     supabase/functions/marketing-send/orch-1270-tester-boundaries.test.ts
//
// DIFFERENT ANGLE than the implementor's orch-1270-defer.test.ts: that file
// RE-IMPLEMENTS the disposition logic in-test (so a bug in the shipped copy would
// still pass). This file IMPORTS the actual exported helper from index.ts and
// drives the exact send/defer FLIP boundaries (07:59 vs 08:00, 20:59 vs 21:00
// local; NG 19:xx vs 20:xx; NG midnight; a DST-transition instant) plus the
// EXACT termination boundaries (attempt 30 defers / 31 fails; age 23h59 defers /
// 24h01 fails). Importing boots index.ts's top-level serve() HTTP listener, so
// each test disables the resource/op sanitizer (the listener is harmless here).
//
// fails-on-revert (cite this point): flip the RC-1 defer branch back to the
// pre-ORCH-1270 terminal fail — in decideSmsDisposition, change the final
// `return { action: "defer", ... }` to `return { action: "fail", reason:
// "quiet_hours_unreachable" }`. Every "→ DEFER" boundary assertion below then
// FAILS (gets "fail"). A true whole-helper revert removes the export → import
// fails → this file errors out. Proven in the TEST report.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { decideSmsDisposition } from "./index.ts";

const t = (name: string, fn: () => void) =>
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });

const HOUR_MS = 60 * 60 * 1000;

// ── US Eastern (212 = America/New_York), summer EDT = UTC-4 ────────────────────
// Local hour is all that matters (isWithinQuietHours compares the hour integer).
t("US EDT hour 07 (07:30 local = 11:30Z) → DEFER (just before the 08:00 open)", () => {
  const d = decideSmsDisposition("+12125550000", "US", new Date("2026-07-15T11:30:00Z"), null);
  assertEquals(d.action, "defer");
});
t("US EDT hour 08 (08:30 local = 12:30Z) → SEND (window just opened)", () => {
  const d = decideSmsDisposition("+12125550000", "US", new Date("2026-07-15T12:30:00Z"), null);
  assertEquals(d.action, "send");
});
t("US EDT hour 20 (20:30 local = 00:30Z+1) → SEND (still inside, endHour is exclusive 21)", () => {
  const d = decideSmsDisposition("+12125550000", "US", new Date("2026-07-16T00:30:00Z"), null);
  assertEquals(d.action, "send");
});
t("US EDT hour 21 (21:30 local = 01:30Z+1) → DEFER (window closed at 21:00)", () => {
  const d = decideSmsDisposition("+12125550000", "US", new Date("2026-07-16T01:30:00Z"), null);
  assertEquals(d.action, "defer");
});

// ── US Eastern winter EST = UTC-5 (guard the offset isn't hard-coded to summer) ─
t("US EST hour 07 (07:30 local = 12:30Z Jan) → DEFER", () => {
  const d = decideSmsDisposition("+12125550000", "US", new Date("2026-01-15T12:30:00Z"), null);
  assertEquals(d.action, "defer");
});
t("US EST hour 08 (08:30 local = 13:30Z Jan) → SEND", () => {
  const d = decideSmsDisposition("+12125550000", "US", new Date("2026-01-15T13:30:00Z"), null);
  assertEquals(d.action, "send");
});

// ── NG (Africa/Lagos, WAT = UTC+1, no DST). endHour 20. ────────────────────────
t("NG hour 19 (19:30 WAT = 18:30Z) → SEND (before the 20:00 NG close)", () => {
  const d = decideSmsDisposition("+2348000000000", "NG", new Date("2026-07-15T18:30:00Z"), null);
  assertEquals(d.action, "send");
});
t("NG hour 20 (20:30 WAT = 19:30Z) → DEFER (NG window is 8-20, not 8-21)", () => {
  const d = decideSmsDisposition("+2348000000000", "NG", new Date("2026-07-15T19:30:00Z"), null);
  assertEquals(d.action, "defer");
});
t("NG WAT midnight (00:00 WAT = 23:00Z) → DEFER; next_attempt_at ≈ next 08:00 WAT (+8h)", () => {
  const now = new Date("2026-07-15T23:00:00Z");
  const d = decideSmsDisposition("+2348000000000", "NG", now, null);
  assertEquals(d.action, "defer");
  if (d.action !== "defer") throw new Error("unreachable");
  const delta = new Date(d.next_attempt_at).getTime() - now.getTime();
  // 8 hours until 08:00 WAT. Allow ±1 min for construction, must not collapse to the 5-min floor.
  assert(Math.abs(delta - 8 * HOUR_MS) < 60_000, `expected ~8h until open, got ${delta / HOUR_MS}h`);
  // The resolved instant must be 07:00Z (= 08:00 WAT) the next day.
  assertEquals(new Date(d.next_attempt_at).getUTCHours(), 7);
});

// ── Unknown timezone → terminal fail, NEVER infinite defer (real fn) ───────────
t("unrecognized US area code (500) → FAIL(unknown_timezone), not defer", () => {
  const d = decideSmsDisposition("+15005550000", "US", new Date("2026-07-15T02:00:00Z"), null);
  assertEquals(d.action, "fail");
  if (d.action !== "fail") throw new Error("unreachable");
  assertEquals(d.reason, "unknown_timezone");
});
t("null country / +44 UK → FAIL(unknown_timezone) (no market)", () => {
  const d = decideSmsDisposition("+447700900000", null, new Date("2026-07-15T02:00:00Z"), null);
  assertEquals(d.action, "fail");
  if (d.action !== "fail") throw new Error("unreachable");
  assertEquals(d.reason, "unknown_timezone");
});

// ── EXACT termination boundaries (attempt count) ───────────────────────────────
// Bound is `attempt > 30` where attempt = existing.attempt_count + 1.
const OOW = new Date("2026-07-15T11:30:00Z"); // 07:30 EDT → out of window, resolvable.
t("attempt_count 29 → attempt 30, 30 !> 30 → DEFER (boundary holds, still retryable)", () => {
  const d = decideSmsDisposition("+12125550000", "US", OOW, { status: "deferred", attempt_count: 29, created_at: OOW.toISOString() });
  assertEquals(d.action, "defer");
  if (d.action !== "defer") throw new Error("unreachable");
  assertEquals(d.attempt_count, 30);
});
t("attempt_count 30 → attempt 31, 31 > 30 → FAIL(quiet_hours_unreachable) (bounded, no infinite loop)", () => {
  const d = decideSmsDisposition("+12125550000", "US", OOW, { status: "deferred", attempt_count: 30, created_at: OOW.toISOString() });
  assertEquals(d.action, "fail");
  if (d.action !== "fail") throw new Error("unreachable");
  assertEquals(d.reason, "quiet_hours_unreachable");
});

// ── EXACT termination boundaries (age) ─────────────────────────────────────────
// Bound is `ageMs > 24h`.
t("age 23h59m → DEFER (still inside the 24h window)", () => {
  const created = new Date(OOW.getTime() - (23 * HOUR_MS + 59 * 60 * 1000)).toISOString();
  const d = decideSmsDisposition("+12125550000", "US", OOW, { status: "deferred", attempt_count: 3, created_at: created });
  assertEquals(d.action, "defer");
});
t("age 24h01m → FAIL(quiet_hours_unreachable) (aged out)", () => {
  const created = new Date(OOW.getTime() - (24 * HOUR_MS + 60 * 1000)).toISOString();
  const d = decideSmsDisposition("+12125550000", "US", OOW, { status: "deferred", attempt_count: 3, created_at: created });
  assertEquals(d.action, "fail");
  if (d.action !== "fail") throw new Error("unreachable");
  assertEquals(d.reason, "quiet_hours_unreachable");
});

// ── DST transition instant must not throw / must yield a sane action ───────────
// US spring-forward 2026: 2026-03-08, 02:00 EST → 03:00 EDT. 07:00Z is the gap.
t("US DST spring-forward instant → no throw, valid action", () => {
  const d = decideSmsDisposition("+12125550000", "US", new Date("2026-03-08T07:00:00Z"), null);
  assert(d.action === "send" || d.action === "defer" || d.action === "fail");
});
