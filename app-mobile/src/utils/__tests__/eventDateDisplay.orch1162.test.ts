// ORCH-1162 Bug 1 — consumer event/experience date line restores the meridiem.
// (implementor-owned happy-path; Deno-runnable — eventDateDisplay.ts is pure,
// only Intl.)
//
// THE FIX (F-1): `formatTimeInTz` was pinned to "en-GB" (a 24h-default locale),
// so the date line rendered "00:15"/"19:00" on every device and the trailing
// `.replace(/\bam\b/)` was dead post-processing (en-GB emits no am/pm — a
// tell-tale latent 24h bug). It now reads the hour via an h23 formatToParts in
// the supplied tz and converts to "7:15 PM"/"12 AM" with the :00 suppressed,
// PRESERVING the timeZone argument.
//
// FAILS-ON-REVERT: revert formatTimeInTz to the en-GB Intl call (no hour12 /
// no h23-convert) and these assertions FAIL — the output has no "PM"/"AM" and
// is "19:15"/"00:00". Verified by true line-deletion in the implementation
// report.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { formatEventDateLine } from "../eventDateDisplay.ts";

Deno.test("TC-1: formatEventDateLine renders a meridiem, not 24h", () => {
  // 2026-06-17T23:15:00Z in America/New_York = 7:15 PM (EDT, UTC-4).
  const line = formatEventDateLine({
    masterDateUtc: "2026-06-17T23:15:00Z",
    masterEndAtUtc: null,
    timezone: "America/New_York",
  });
  assert(
    line.includes("7:15 PM"),
    `expected "7:15 PM" in "${line}" — en-GB 24h regression if "19:15" appears`,
  );
  assert(!line.includes("19:15"), `must NOT render 24h "19:15": "${line}"`);
});

Deno.test("TC-1b: midnight + on-hour minute suppression", () => {
  // 2026-06-18T04:00:00Z in America/New_York = 12 AM (midnight, EDT).
  const line = formatEventDateLine({
    masterDateUtc: "2026-06-18T04:00:00Z",
    masterEndAtUtc: null,
    timezone: "America/New_York",
  });
  assert(line.includes("12 AM"), `expected "12 AM" in "${line}"`);
  // :00 is suppressed → never "12:00".
  assert(!line.includes("12:00"), `:00 must be suppressed: "${line}"`);
});

Deno.test("TC-1c: start–end range both carry meridiem", () => {
  // 23:00Z = 7 PM EDT, next day 02:00Z = 10 PM EDT (same calendar day).
  const line = formatEventDateLine({
    masterDateUtc: "2026-06-17T23:00:00Z",
    masterEndAtUtc: "2026-06-18T02:00:00Z",
    timezone: "America/New_York",
  });
  assert(line.includes("7 PM"), `start "7 PM" expected: "${line}"`);
  assert(line.includes("10 PM"), `end "10 PM" expected: "${line}"`);
});

Deno.test("TC-3 (regression): tz argument is honored (UTC vs ET differ)", () => {
  const et = formatEventDateLine({
    masterDateUtc: "2026-06-17T23:15:00Z",
    masterEndAtUtc: null,
    timezone: "America/New_York",
  });
  const utc = formatEventDateLine({
    masterDateUtc: "2026-06-17T23:15:00Z",
    masterEndAtUtc: null,
    timezone: "UTC",
  });
  // ET = 7:15 PM, UTC = 11:15 PM — proves timeZone is still applied.
  assert(et.includes("7:15 PM"), `ET: "${et}"`);
  assert(utc.includes("11:15 PM"), `UTC: "${utc}"`);
  assertEquals(et === utc, false);
});
