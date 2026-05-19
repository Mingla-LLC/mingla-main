/**
 * ORCH-0877 happy-path regression test #2 — smart-infer end-instant math +
 * computeMasterEndAtUtc lifecycle helper.
 *
 * Exercises:
 *   - `computeEndsAtUtcWithSmartInfer` — wraps to next day when endsAt ≤
 *     doorsOpen (Constitution #9-safe; returns null on incomplete input)
 *   - `computeMasterEndAtUtc` — preferred path (persisted masterEndAtUtc)
 *     vs legacy smart-infer fallback (no masterEndAtUtc; reads date +
 *     doorsOpen + endsAt + timezone)
 *
 * fails-on-revert verified at HEAD aa79f79c39be1bda08396f30dfdb79725d959e19
 *   - Pre-ORCH-0877 `computeMasterEndAtUtc` reconstructed end-instant from
 *     `event.date + event.endsAt` parsed in `event.timezone` with NO
 *     midnight-wrap. For a 22:00 → 02:00 input the function returned an
 *     instant ~20 hours BEFORE start (the same calendar day's 02:00).
 *     The cross-midnight assertion below FAILS on revert because the
 *     expected next-day UTC instant is replaced by the same-day instant.
 *   - `computeEndsAtUtcWithSmartInfer` is a NEW export; revert breaks
 *     the import.
 */

import {
  computeEndsAtUtcWithSmartInfer,
  computeMasterEndAtUtc,
} from "../eventDateMath";

describe("ORCH-0877 — computeEndsAtUtcWithSmartInfer", () => {
  test("returns null when inputs incomplete", () => {
    expect(computeEndsAtUtcWithSmartInfer(null, "22:00", "02:00", "UTC")).toBeNull();
    expect(computeEndsAtUtcWithSmartInfer("2026-05-18", "22:00", null, "UTC")).toBeNull();
  });

  test("returns same-day end when endsAt > doorsOpen", () => {
    const out = computeEndsAtUtcWithSmartInfer(
      "2026-05-18",
      "22:00",
      "23:00",
      "UTC",
    );
    expect(out).toBe("2026-05-18T23:00:00.000Z");
  });

  test("wraps to next day when endsAt ≤ doorsOpen (cross-midnight)", () => {
    const out = computeEndsAtUtcWithSmartInfer(
      "2026-05-18",
      "22:00",
      "02:00",
      "UTC",
    );
    // 22:00 UTC on May 18 → wraps to 02:00 UTC on May 19
    expect(out).toBe("2026-05-19T02:00:00.000Z");
  });

  test("respects target timezone for wrap decision", () => {
    // Europe/London BST = +01:00 on May 18 2026. 22:00 BST = 21:00 UTC;
    // 02:00 BST same date = 01:00 UTC same date — which is earlier than
    // start, so smart-infer wraps to the next-day BST 02:00 = 01:00 UTC May 19.
    const out = computeEndsAtUtcWithSmartInfer(
      "2026-05-18",
      "22:00",
      "02:00",
      "Europe/London",
    );
    expect(out).toBe("2026-05-19T01:00:00.000Z");
  });
});

describe("ORCH-0877 — computeMasterEndAtUtc (lifecycle helper)", () => {
  // Minimal LiveEvent stub shape — we only need the fields the helper reads.
  const baseEvent = {
    date: "2026-05-18",
    doorsOpen: "22:00",
    endsAt: "02:00",
    timezone: "UTC",
    masterEndAtUtc: null as string | null,
  };

  test("prefers persisted masterEndAtUtc when present", () => {
    const event = {
      ...baseEvent,
      masterEndAtUtc: "2099-01-01T00:00:00.000Z",
    } as unknown as Parameters<typeof computeMasterEndAtUtc>[0];
    expect(computeMasterEndAtUtc(event)).toBe("2099-01-01T00:00:00.000Z");
  });

  test("falls back to smart-infer when masterEndAtUtc is null (cross-midnight)", () => {
    const event = baseEvent as unknown as Parameters<
      typeof computeMasterEndAtUtc
    >[0];
    // 22:00 → 02:00 in UTC, smart-infer wraps to next day.
    // Pre-ORCH-0877 this returned 2026-05-18T02:00:00.000Z (20h before start).
    // Post-ORCH-0877 it returns 2026-05-19T02:00:00.000Z.
    expect(computeMasterEndAtUtc(event)).toBe("2026-05-19T02:00:00.000Z");
  });

  test("returns null when event.date is null", () => {
    const event = { ...baseEvent, date: null } as unknown as Parameters<
      typeof computeMasterEndAtUtc
    >[0];
    expect(computeMasterEndAtUtc(event)).toBeNull();
  });
});
