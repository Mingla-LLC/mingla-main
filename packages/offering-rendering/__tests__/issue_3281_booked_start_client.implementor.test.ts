/**
 * issue #3281 Round 1 PR 1b — client helpers + picker contract pins.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  experienceBookedStartIso,
  experienceMinuteOffsetFromOpen,
  experienceTimeChoices,
} from "../experienceTimeZone.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

Deno.test("#3281 R1: experienceBookedStartIso matches the open-hours grid", () => {
  const start = "2026-06-15T09:00:00.000Z";
  const end = "2026-06-15T17:00:00.000Z";
  const tz = "Africa/Lagos";
  const noon = 12 * 60;
  const offset = experienceMinuteOffsetFromOpen(start, end, tz, noon, 30);
  assertEquals(offset, 2 * 60);
  const iso = experienceBookedStartIso(start, end, tz, noon, 30);
  assert(iso !== null);
  assertEquals(iso, new Date(Date.parse(start) + 2 * 60 * 60_000).toISOString());
});

Deno.test("#3281 R1: spring-forward gap is not offered and does not convert", () => {
  // America/New_York 2027-03-14: 02:00 local does not exist (springs to 03:00).
  // 00:00 EST = 05:00Z; 04:00 EDT = 08:00Z.
  const winStart = "2027-03-14T05:00:00.000Z";
  const winEnd = "2027-03-14T08:00:00.000Z";
  const tz = "America/New_York";
  const twoAm = 2 * 60;
  assertEquals(
    experienceBookedStartIso(winStart, winEnd, tz, twoAm, 30),
    null,
  );
  const choices = experienceTimeChoices(
    winStart,
    winEnd,
    tz,
    30,
    Date.parse(winStart),
  );
  assertEquals(choices.includes(twoAm), false);
});

Deno.test("#3281 R1 FAIL-ON-REVERT: Explorer calendar applies booked_start_at", async () => {
  const src = await read("../../../app-mobile/src/services/calendarService.ts");
  assertStringIncludes(src, "booked_start_at");
  assertStringIncludes(src, "masterDateUtc: order.booked_start_at");
});

Deno.test("#3281 R1: past wall-clock slots are filtered from choices", () => {
  const start = "2026-11-20T09:00:00.000Z";
  const end = "2026-11-20T17:00:00.000Z";
  const tz = "Africa/Lagos";
  const noon = 12 * 60;
  const noonIso = experienceBookedStartIso(start, end, tz, noon, 60);
  assert(noonIso !== null);
  const afterNoon = Date.parse(noonIso!) + 1;
  const choices = experienceTimeChoices(start, end, tz, 60, afterNoon);
  assertEquals(choices.includes(noon), false);
  assert(choices.every((m) => {
    const iso = experienceBookedStartIso(start, end, tz, m, 60);
    return iso !== null && Date.parse(iso) >= afterNoon;
  }));
});

Deno.test("#3281 R1 FAIL-ON-REVERT: Host picker open-daily confirm includes startAt", async () => {
  const src = await read(
    "../../../mingla-business/src/components/experience/ExperienceReservePicker.tsx",
  );
  assertStringIncludes(src, "startAt?: string");
  assertStringIncludes(src, "experienceBookedStartIso");
  assertStringIncludes(src, "startAt: bookedIso");
  assertStringIncludes(src, "if (bookedIso === null) return;");
});

Deno.test("#3281 R1 FAIL-ON-REVERT: Explorer picker open-daily confirm includes startAt", async () => {
  const src = await read(
    "../../../app-mobile/src/components/expandedCard/ExperienceReservePicker.tsx",
  );
  assertStringIncludes(src, "startAt?: string");
  assertStringIncludes(src, "experienceBookedStartIso");
  assertStringIncludes(src, "startAt: bookedIso");
  assertStringIncludes(src, "if (bookedIso === null) return;");
});
