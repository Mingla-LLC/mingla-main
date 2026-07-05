import { describe, expect, test } from "@jest/globals";

import { normalizePickerDurationMs } from "../coverPickerVideoTrimUpload";

/**
 * ORCH-1308 — the browser reports `<video>.duration` in FRACTIONAL seconds, so
 * the web cover path produced a non-integer millisecond duration (e.g. a 17.97s
 * clip → 17971.995 ms). That value flowed into the upload-intent edge and hit
 * the INTEGER `source_duration_ms` / `trim_end_ms` columns, so Postgres rejected
 * the INSERT ("invalid input syntax for type integer: 17971.995") → the intent
 * 500'd → "Could not create a video processing job." (deterministically found in
 * the prod postgres logs). Every duration that reaches those columns MUST be a
 * whole millisecond.
 */
describe("ORCH-1308 — picker duration is always a whole millisecond", () => {
  test("a fractional ms duration is rounded to an integer", () => {
    const result = normalizePickerDurationMs(17971.995);
    expect(result).toBe(17972);
    expect(Number.isInteger(result)).toBe(true);
  });

  test("a fractional seconds duration (<1000) is scaled then rounded to an integer", () => {
    // 17.9719 s → 17971.9 ms → 17972 ms
    const result = normalizePickerDurationMs(17.9719);
    expect(result).toBe(17972);
    expect(Number.isInteger(result)).toBe(true);
  });

  test("an already-integer ms duration is unchanged", () => {
    expect(normalizePickerDurationMs(29000)).toBe(29000);
  });

  test("non-finite / null / negative inputs collapse to 0 (never NaN, never fractional)", () => {
    expect(normalizePickerDurationMs(null)).toBe(0);
    expect(normalizePickerDurationMs(undefined)).toBe(0);
    expect(normalizePickerDurationMs(Number.NaN)).toBe(0);
    expect(Number.isInteger(normalizePickerDurationMs(0.4))).toBe(true);
  });

  test("a range of realistic fractional durations all yield integers", () => {
    for (const s of [1.333, 5.5, 12.04, 28.999, 30.001]) {
      const result = normalizePickerDurationMs(s * 1000);
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});
