/**
 * issue #3281 Round 1 PR 1a — implementor happy + fail-on-revert.
 *
 * Pins: zone-correct open-hours helpers (no Date#getHours), one-stop copy,
 * "per person" price label wiring, and the hidden-address StopSpine line.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  experienceTimeChoices,
  experienceWindowMinutes,
  experienceZoneCityLabel,
  experienceZoneDiffersFromViewer,
  formatExperienceMinute,
} from "../experienceTimeZone.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

Deno.test("#3281 R1: Lagos 10:00–18:00 window is zone-correct (not viewer local)", () => {
  // 2026-06-15 09:00 UTC = 10:00 Africa/Lagos (UTC+1, no DST).
  // 2026-06-15 17:00 UTC = 18:00 Africa/Lagos.
  const start = "2026-06-15T09:00:00.000Z";
  const end = "2026-06-15T17:00:00.000Z";
  const w = experienceWindowMinutes(start, end, "Africa/Lagos");
  assert(w !== null);
  assertEquals(w!.open, 10 * 60);
  assertEquals(w!.close, 18 * 60);
  // End-exclusive: 10:00–18:00 with 60m steps offers through 17:00, matching
  // SQL `booked_start_at < end_at` (issue #3281).
  const choices = experienceTimeChoices(start, end, "Africa/Lagos", 60);
  assertEquals(choices[0], 10 * 60);
  assertEquals(choices[choices.length - 1], 17 * 60);
  assertEquals(formatExperienceMinute(10 * 60), "10:00 AM");
});

Deno.test("#3281 R1: Asia/Kolkata half-hour offset window", () => {
  // 2026-01-10 04:30 UTC = 10:00 Asia/Kolkata (UTC+5:30).
  // 2026-01-10 12:30 UTC = 18:00 Asia/Kolkata.
  const w = experienceWindowMinutes(
    "2026-01-10T04:30:00.000Z",
    "2026-01-10T12:30:00.000Z",
    "Asia/Kolkata",
  );
  assert(w !== null);
  assertEquals(w!.open, 10 * 60);
  assertEquals(w!.close, 18 * 60);
});

Deno.test("#3281 R1: zone city label + viewer-diff helper", () => {
  assertEquals(experienceZoneCityLabel("Africa/Lagos"), "Lagos");
  assertEquals(experienceZoneCityLabel("America/New_York"), "New York");
  assert(
    experienceZoneDiffersFromViewer("Africa/Lagos", "America/New_York") === true,
  );
  assert(
    experienceZoneDiffersFromViewer("Africa/Lagos", "Africa/Lagos") === false,
  );
});

Deno.test("#3281 R1: StopSpine shows shared-after-book copy when address null", async () => {
  const spine = await read("../StopSpine.tsx");
  assertStringIncludes(spine, "EXPERIENCE_ADDRESS_SHARED_AFTER_BOOK");
  assertStringIncludes(spine, "Address shared after you book");
  assertStringIncludes(spine, "EXPERIENCE_ADDRESS_SHARED_AFTER_BOOK");
});

Deno.test("#3281 R1: ExperienceOfferingBody one-stop copy + per person + gate anchor", async () => {
  const body = await read("../ExperienceOfferingBody.tsx");
  assertStringIncludes(body, "(8) The itinerary");
  assertStringIncludes(body, "What you'll do");
  assertStringIncludes(body, '"EXPERIENCE"');
  assertStringIncludes(body, "per person");
  assertStringIncludes(body, "priceDecimals");
});

Deno.test("#3281 R1 FAIL-ON-REVERT: experienceTimeZone must not call getHours", async () => {
  const tz = await read("../experienceTimeZone.ts");
  assert(
    !/\.getHours\s*\(/.test(tz),
    "experienceTimeZone must never use Date#getHours (viewer-local bug)",
  );
});
