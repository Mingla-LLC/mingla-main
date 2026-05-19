/**
 * ORCH-0877 happy-path regression test #1 — cross-midnight event-date
 * display formatter.
 *
 * Exercises `formatSingleDateLine` across the four canonical branches:
 *   - Date TBD               (no date)
 *   - Start-only             (no endsAt)
 *   - Same-day inline range  ("Sat 18 May · 10 PM – 11 PM")
 *   - Cross-midnight range   ("Sat 18 May · 10 PM – Sun 19 May · 2 AM")
 *
 * fails-on-revert verified at HEAD aa79f79c39be1bda08396f30dfdb79725d959e19
 *   - Pre-ORCH-0877 the function signature is `(date, doorsOpen)` with no
 *     `endsAt` parameter; calling with the new 6-arg signature is a TS
 *     compile error AND a runtime no-op (endsAt ignored). Revert the SPEC
 *     §4.5 widening and these assertions fail with the start-only string.
 */

import {
  formatSingleDateLine,
  isEndsAtNextDay,
} from "../eventDateDisplay";

describe("ORCH-0877 — formatSingleDateLine cross-midnight + same-day", () => {
  test("returns 'Date TBD' when date is null", () => {
    expect(
      formatSingleDateLine(null, null, null, null, null, null),
    ).toBe("Date TBD");
  });

  test("renders start-only when endsAt is null", () => {
    expect(
      formatSingleDateLine(
        "2026-05-18",
        "22:00",
        null,
        null,
        null,
        "Europe/London",
      ),
    ).toMatch(/Mon 18 May · 10 PM$/);
  });

  test("renders same-day range (no year) with uppercase AM/PM", () => {
    const out = formatSingleDateLine(
      "2026-05-18",
      "22:00",
      "23:00",
      null,
      null,
      "Europe/London",
    );
    // Mon 18 May · 10 PM – 11 PM
    expect(out).toContain("10 PM");
    expect(out).toContain("11 PM");
    expect(out).toContain(" – ");
    // Year MUST be omitted on same-day form
    expect(out).not.toContain("2026");
  });

  test("renders cross-midnight range with weekday prefix on end side", () => {
    // 10 PM Mon → 2 AM Tue, smart-infer fallback path (no master*Utc)
    const out = formatSingleDateLine(
      "2026-05-18",
      "22:00",
      "02:00",
      null,
      null,
      "Europe/London",
    );
    // Cross-midnight string: "Mon 18 May · 10 PM – Tue 19 May · 2 AM"
    expect(out).toContain("10 PM");
    expect(out).toContain("2 AM");
    expect(out).toContain(" – ");
    // The end-side MUST carry a weekday prefix (smart-infer wraps to Tue)
    expect(out).toMatch(/Tue 19 May/);
  });

  test("isEndsAtNextDay returns true when end-time-of-day ≤ start", () => {
    expect(isEndsAtNextDay("22:00", "02:00")).toBe(true);
    expect(isEndsAtNextDay("22:00", "22:00")).toBe(true); // equal → wrap
    expect(isEndsAtNextDay("22:00", "23:00")).toBe(false);
    expect(isEndsAtNextDay(null, "02:00")).toBe(false);
    expect(isEndsAtNextDay("22:00", null)).toBe(false);
  });

  test("uses masterEndAtUtc + timezone when provided (server-projection path)", () => {
    // 18 May 22:00 BST = 21:00 UTC; 19 May 02:00 BST = 01:00 UTC.
    // Same wall-clock event but in Europe/London where BST is +01:00.
    const out = formatSingleDateLine(
      "2026-05-18",
      "22:00",
      "02:00",
      "2026-05-18T21:00:00.000Z",
      "2026-05-19T01:00:00.000Z",
      "Europe/London",
    );
    // When the master UTC instants are provided, the formatter compares
    // calendar days in the event's tz and renders cross-midnight with the
    // server-derived end weekday/time.
    expect(out).toContain("10 PM");
    expect(out).toContain("2 AM");
    expect(out).toMatch(/Tue 19 May/);
  });
});
