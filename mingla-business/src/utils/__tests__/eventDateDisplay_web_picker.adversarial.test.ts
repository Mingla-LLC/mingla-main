/**
 * ORCH-0877 — TESTER ADVERSARIAL regression test suite #4.
 *
 * Attacks T-ADV-06: Web HTML5 picker smart-infer end-to-end. On the
 * mingla-business Web preview, the wizard's HTML5 `<input type="time">`
 * picker has NO `min` attribute (unlike the iOS/Android picker that pre-
 * ORCH-0877 had `minimumDate = doorsOpen + 1 min`). Web users could
 * therefore author endsAt < doorsOpen pre-ORCH-0877, but the model layer
 * dropped the end-date, so the display layer rendered start-only.
 *
 * Post-ORCH-0877, the Web picker path must:
 *   - Stamp `endsAtUtc` via smart-infer on every endsAt commit.
 *   - Carry that UTC instant through publish + display.
 *   - Render cross-midnight correctly via `formatSingleDateLine`.
 *
 * This adversarial set verifies the END-TO-END formatter contract for the
 * Web picker scenario (operator picks doors 22:00 + ends 02:00 on Web),
 * including:
 *   - formatSingleDateLine renders cross-midnight string when only legacy
 *     fields are present (Web path before masterEndAtUtc is server-projected).
 *   - formatSingleDateLine renders cross-midnight string when both master
 *     UTC fields ARE present (post-publish refetch path).
 *   - isEndsAtNextDay helper handles HH:MM 24h boundary correctly.
 *
 * fails-on-revert verified at HEAD aa79f79c39be1bda08396f30dfdb79725d959e19.
 *   Pre-ORCH-0877:
 *     - formatSingleDateLine is 2-arg (date, doorsOpen). The 6-arg call
 *       below fails to compile.
 *     - isEndsAtNextDay export doesn't exist.
 *     - Cross-midnight rendering is impossible — the function has no
 *       endsAt parameter at all.
 *
 * DIFFERENT angle than implementor's happy-path:
 *   - Implementor tests the formatter happy paths with simple inputs.
 *   - This adversarial set probes the Web-picker SCENARIO (which pre-fix
 *     was the ONLY platform where cross-midnight authoring was possible)
 *     and verifies the full chain works end-to-end now that the model +
 *     formatter are widened.
 */

import {
  formatSingleDateLine,
  isEndsAtNextDay,
} from "../eventDateDisplay";

describe("ORCH-0877 adversarial — Web HTML5 picker scenario end-to-end", () => {
  // ─── T-ADV-06a — Web operator picks 22:00 → 02:00 (smart-infer wrap) ──
  test("T-ADV-06a — Web-authored cross-midnight: legacy fields only (pre-publish state)", () => {
    // Pre-publish: master*Utc are still null on the draft. Formatter must
    // use the smart-infer fallback to render cross-midnight.
    const out = formatSingleDateLine(
      "2026-05-18",
      "22:00",
      "02:00",
      null, // masterStartAtUtc — not yet hydrated
      null, // masterEndAtUtc — not yet hydrated
      "Europe/London",
    );
    // Smart-infer: 02:00 ≤ 22:00 → wrap end to Tue 19 May
    expect(out).toContain("Mon 18 May");
    expect(out).toContain("Tue 19 May");
    expect(out).toContain("10 PM");
    expect(out).toContain("2 AM");
    expect(out).toContain(" – "); // en-dash with regular spaces
  });

  // ─── T-ADV-06b — same Web event after publish + refetch ───────────────
  test("T-ADV-06b — Web-authored event after publish — master*Utc populated, server-projection path", () => {
    // Post-publish: server view projects master_start_at + master_end_at.
    // Formatter must use the calendar-day comparison in event tz, not the
    // smart-infer fallback. Verify it agrees with the smart-infer path.
    const out = formatSingleDateLine(
      "2026-05-18",
      "22:00",
      "02:00",
      // BST = +01:00; 22:00 BST = 21:00 UTC; next-day 02:00 BST = 01:00 UTC.
      "2026-05-18T21:00:00.000Z",
      "2026-05-19T01:00:00.000Z",
      "Europe/London",
    );
    expect(out).toContain("Mon 18 May");
    expect(out).toContain("Tue 19 May");
    expect(out).toContain("10 PM");
    expect(out).toContain("2 AM");
  });

  // ─── T-ADV-06c — Web boundary: 23:59 → 00:00 wraps to next day ────────
  test("T-ADV-06c — boundary: endsAt 00:00 with doorsOpen 23:59 wraps next-day", () => {
    expect(isEndsAtNextDay("23:59", "00:00")).toBe(true);
    const out = formatSingleDateLine(
      "2026-05-18",
      "23:59",
      "00:00",
      null,
      null,
      "UTC",
    );
    expect(out).toContain("Mon 18 May");
    // 00:00 is midnight — formatter renders "12 AM" or "12:00 AM"
    // (formatTimeLabel converts h=0 → h12=12, isPm=false → "AM"
    //  with minutes=0 producing "12 AM")
    expect(out).toContain("12 AM");
    expect(out).toContain("Tue 19 May");
  });

  // ─── T-ADV-06d — exact-equal time wraps next-day (same-time = 24h event) ──
  test("T-ADV-06d — exact-equal time wraps: 22:00 → 22:00 (24h event semantic)", () => {
    expect(isEndsAtNextDay("22:00", "22:00")).toBe(true);
    // Note: in production the wizard validation rejects exact-equal at
    // publish (SPEC §5 Q5-SAME — event_end_must_differ_from_start). But
    // the FORMATTER pre-validation must still handle the input gracefully
    // (smart-infer wraps to next-day 22:00, a 24h event).
    const out = formatSingleDateLine(
      "2026-05-18",
      "22:00",
      "22:00",
      null,
      null,
      "UTC",
    );
    expect(out).toContain("Mon 18 May");
    expect(out).toContain("Tue 19 May");
    expect(out).toContain("10 PM");
  });

  // ─── T-ADV-06e — same-day-form NEVER renders weekday on end side ──────
  test("T-ADV-06e — same-day rendering has NO weekday prefix on end side", () => {
    const out = formatSingleDateLine(
      "2026-05-18",
      "22:00",
      "23:00",
      null,
      null,
      "UTC",
    );
    // Same-day: "Mon 18 May · 10 PM – 11 PM" — only ONE weekday
    const weekdayMatches = out.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g);
    expect(weekdayMatches).toHaveLength(1);
  });

  // ─── T-ADV-06f — Year is omitted from same-day form ───────────────────
  test("T-ADV-06f — same-day form omits year (D1 lock)", () => {
    const out = formatSingleDateLine(
      "2026-05-18",
      "22:00",
      "23:00",
      null,
      null,
      "UTC",
    );
    expect(out).not.toContain("2026");
  });

  // ─── T-ADV-06g — Cross-midnight form omits year on BOTH sides ─────────
  test("T-ADV-06g — cross-midnight form omits year on both sides (D1 lock)", () => {
    const out = formatSingleDateLine(
      "2026-05-18",
      "22:00",
      "02:00",
      null,
      null,
      "UTC",
    );
    expect(out).not.toContain("2026");
  });

  // ─── T-ADV-06h — D1 visual lock: uppercase AM/PM, en-dash, regular spaces ──
  test("T-ADV-06h — D1 visual lock: uppercase AM/PM, en-dash, regular spaces", () => {
    const out = formatSingleDateLine(
      "2026-05-18",
      "22:00",
      "23:00",
      null,
      null,
      "UTC",
    );
    expect(out).toContain(" – "); // en-dash U+2013 with regular spaces
    expect(out).not.toContain(" — "); // NOT em-dash
    expect(out).not.toContain(" "); // NOT thin space
    expect(out).toMatch(/\bAM\b|\bPM\b/); // uppercase meridiem
    expect(out).not.toMatch(/\bam\b|\bpm\b/); // never lowercase
  });
});
