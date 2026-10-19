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

Deno.test("#3281 R1 FAIL-ON-REVERT: Host picker open-daily confirm includes startAt", async () => {
  const src = await read(
    "../../../mingla-business/src/components/experience/ExperienceReservePicker.tsx",
  );
  assertStringIncludes(src, "startAt?: string");
  assertStringIncludes(src, "experienceBookedStartIso");
  assertStringIncludes(src, "startAt: bookedIso");
});

Deno.test("#3281 R1 FAIL-ON-REVERT: Explorer picker open-daily confirm includes startAt", async () => {
  const src = await read(
    "../../../app-mobile/src/components/expandedCard/ExperienceReservePicker.tsx",
  );
  assertStringIncludes(src, "startAt?: string");
  assertStringIncludes(src, "experienceBookedStartIso");
});
