/**
 * ORCH-0877 — TESTER ADVERSARIAL regression test suite #1.
 *
 * Attacks angles NOT covered by the implementor's happy-path tests:
 *   - T-ADV-01 DST spring-forward (America/New_York, Mar second Sunday)
 *   - T-ADV-02 DST fall-back (America/New_York, Nov first Sunday)
 *   - T-ADV-03 Year boundary (Dec 31 23:30 → Jan 1 01:30)
 *
 * fails-on-revert verified at HEAD aa79f79c39be1bda08396f30dfdb79725d959e19.
 *   Pre-ORCH-0877 `computeMasterEndAtUtc` reconstructed end-instant from
 *   `event.date + event.endsAt` parsed in tz with NO midnight-wrap. For
 *   every assertion below the pre-revert function would return the SAME
 *   calendar day's end-time (~20-24h before start), failing each `toBe`.
 *   The new `computeEndsAtUtcWithSmartInfer` exports also don't exist
 *   pre-revert; the import fails to resolve.
 *
 * DIFFERENT angle than implementor's happy-path:
 *   - Implementor covered UTC-only timezone + simple 22:00→02:00 case.
 *   - This adversarial set targets timezone-edge conditions (DST transitions,
 *     year rollover) where the implementor's midnight-wrap could in theory
 *     produce wrong UTC instants if Postgres/JS engine semantics differ.
 *     Smart-infer is a CLIENT helper so it doesn't touch Postgres — but it
 *     uses `localWallClockToUtcInstant` which IS tz-aware via Intl.
 */

import {
  computeEndsAtUtcWithSmartInfer,
} from "../eventDateMath";

describe("ORCH-0877 adversarial — DST + year-boundary smart-infer", () => {
  // ─── T-ADV-01 — DST spring-forward ───────────────────────────────────
  test("T-ADV-01 — DST spring-forward: 23:00 Sat → 02:30 Sun in America/New_York on Mar 8 2026", () => {
    // Mar 8 2026 is the second Sunday in March → DST jumps 02:00 → 03:00 EST→EDT.
    // The wall-clock instant "02:30 EST" on Mar 8 does NOT exist.
    // The smart-infer helper uses localWallClockToUtcInstant which falls back
    // through Intl.DateTimeFormat; Postgres + JS both resolve missing-hour
    // wall-clock by skipping forward, so 02:30 resolves to 03:30 EDT = 07:30 UTC.
    //
    // Start: Mar 7 (Sat) 23:00 EST = Mar 8 04:00 UTC.
    // End wall clock: Mar 8 (Sun) 02:30 — non-existent; Intl skips to 03:30 EDT
    //   = Mar 8 07:30 UTC.
    const out = computeEndsAtUtcWithSmartInfer(
      "2026-03-07",
      "23:00",
      "02:30",
      "America/New_York",
    );
    // Smart-infer wraps because 02:30 (next-day-time) ≤ 23:00 (door-time).
    // The wrapped end is on Mar 8. Intl/Postgres skips the missing 02:30 EST
    // and resolves to 03:30 EDT = 07:30 UTC.
    // Some engines anchor differently; assert the UTC instant is on Mar 8
    // and reflects 3-4.5 hours ahead of start (allowing engine variation).
    expect(out).not.toBeNull();
    const endMs = Date.parse(out as string);
    const startMs = Date.parse("2026-03-08T04:00:00.000Z");
    expect(endMs).toBeGreaterThan(startMs); // never before start
    expect(endMs - startMs).toBeGreaterThan(2.5 * 3600 * 1000); // > 2.5h gap
    expect(endMs - startMs).toBeLessThan(5 * 3600 * 1000); // < 5h gap (DST envelope)
  });

  // ─── T-ADV-02 — DST fall-back ────────────────────────────────────────
  test("T-ADV-02 — DST fall-back: 23:00 Sat → 02:00 Sun in America/New_York on Nov 1 2026", () => {
    // Nov 1 2026 is the first Sunday in November → DST falls back 02:00 EDT → 01:00 EST.
    // The wall-clock instant "01:30 EDT/EST" on Nov 1 is AMBIGUOUS (occurs twice).
    // We use 02:00 (post-fall-back, unambiguously EST).
    //
    // Start: Oct 31 (Sat) 23:00 EDT = Nov 1 03:00 UTC.
    // End wall clock: Nov 1 (Sun) 02:00 EST = Nov 1 07:00 UTC.
    // Total event duration = 4 hours (includes the extra fall-back hour).
    const out = computeEndsAtUtcWithSmartInfer(
      "2026-10-31",
      "23:00",
      "02:00",
      "America/New_York",
    );
    expect(out).not.toBeNull();
    const endMs = Date.parse(out as string);
    const startMs = Date.parse("2026-11-01T03:00:00.000Z");
    expect(endMs).toBeGreaterThan(startMs);
    // Fall-back: event runs 4 wall-clock hours but 4h UTC distance is what we
    // expect because the end wall-clock is in EST (post-fallback).
    // Allow 3-5h envelope for engine variation on ambiguous wall-clock resolution.
    expect(endMs - startMs).toBeGreaterThanOrEqual(3 * 3600 * 1000);
    expect(endMs - startMs).toBeLessThanOrEqual(5 * 3600 * 1000);
  });

  // ─── T-ADV-03 — Year boundary ────────────────────────────────────────
  test("T-ADV-03 — Year boundary: Dec 31 23:30 → Jan 1 01:30 (UTC)", () => {
    // Smart-infer should correctly roll year + month, not just the day-of-month.
    const out = computeEndsAtUtcWithSmartInfer(
      "2025-12-31",
      "23:30",
      "01:30",
      "UTC",
    );
    expect(out).toBe("2026-01-01T01:30:00.000Z");
  });

  test("T-ADV-03b — Year boundary same-day (no wrap): Dec 31 22:00 → Dec 31 23:30", () => {
    // No wrap when end-time > start-time on same date.
    const out = computeEndsAtUtcWithSmartInfer(
      "2025-12-31",
      "22:00",
      "23:30",
      "UTC",
    );
    expect(out).toBe("2025-12-31T23:30:00.000Z");
  });

  // ─── T-ADV-03c — Month boundary in non-leap year ─────────────────────
  test("T-ADV-03c — Month boundary (Feb 28 → Mar 1 in 2027, non-leap)", () => {
    const out = computeEndsAtUtcWithSmartInfer(
      "2027-02-28",
      "23:00",
      "03:00",
      "UTC",
    );
    expect(out).toBe("2027-03-01T03:00:00.000Z");
  });

  // ─── T-ADV-03d — Leap year month boundary ────────────────────────────
  test("T-ADV-03d — Leap year boundary (Feb 28 2028 → Feb 29 2028)", () => {
    const out = computeEndsAtUtcWithSmartInfer(
      "2028-02-28",
      "23:00",
      "03:00",
      "UTC",
    );
    expect(out).toBe("2028-02-29T03:00:00.000Z");
  });
});
