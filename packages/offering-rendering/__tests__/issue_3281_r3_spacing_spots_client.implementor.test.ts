/**
 * issue #3281 Round 3 — client helper pins (3b remaining chip / seats label,
 * 3c stop offset copy, notice-aware time grid).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  experienceRemainingChipText,
  experienceSeatsLabel,
  experienceStopOffsetLabel,
  parseExperienceCapacityScope,
} from "../experienceR3.ts";
import { experienceTimeChoices } from "../experienceTimeZone.ts";

Deno.test("#3281 R3: remaining chip is N left / Full, null stays null", () => {
  assertEquals(experienceRemainingChipText(4), "4 left");
  assertEquals(experienceRemainingChipText(0), "Full");
  assertEquals(experienceRemainingChipText(-2), "Full");
  assertEquals(experienceRemainingChipText(null), null);
  assertEquals(experienceRemainingChipText(undefined), null);
});

Deno.test("#3281 R3: stop offset copy", () => {
  assertEquals(experienceStopOffsetLabel(null), null);
  assertEquals(experienceStopOffsetLabel(-5), null);
  assertEquals(experienceStopOffsetLabel(0), "at the start");
  assertEquals(experienceStopOffsetLabel(45), "about 45 min in");
  assertEquals(experienceStopOffsetLabel(60), "about 1 hr in");
  assertEquals(experienceStopOffsetLabel(90), "about 1 hr 30 min in");
});

Deno.test("#3281 R3: capacity scope parser defaults to total", () => {
  assertEquals(parseExperienceCapacityScope("per_day"), "per_day");
  assertEquals(parseExperienceCapacityScope("per_start"), "per_start");
  assertEquals(parseExperienceCapacityScope("nope"), "total");
  assertEquals(parseExperienceCapacityScope(undefined), "total");
});

Deno.test("#3281 R3: seats label prefers next open day for per_day / per_start", () => {
  const now = Date.parse("2027-01-01T00:00:00.000Z");
  const occurrences = [
    { startAt: "2027-01-02T10:00:00.000Z", remaining: 0 },
    { startAt: "2027-01-03T10:00:00.000Z", remaining: 5 },
  ];
  const base = {
    occurrences,
    ticketRemaining: 9,
    quantityTotal: 10,
    isUnlimited: false,
    nowMs: now,
  };
  assertEquals(
    experienceSeatsLabel({ ...base, capacityScope: "total" }),
    "9 spots left · 10 max",
  );
  assertEquals(
    experienceSeatsLabel({ ...base, capacityScope: "per_day" }),
    "5 spots left · 10 max",
  );
  assertEquals(
    experienceSeatsLabel({
      ...base,
      capacityScope: "per_start",
      occurrences: [{ startAt: "2027-01-02T10:00:00.000Z", remaining: 0 }],
    }),
    "Full · 10 max",
  );
  assertEquals(
    experienceSeatsLabel({ ...base, capacityScope: "per_day", isUnlimited: true }),
    null,
  );
});

Deno.test("#3281 R3: spacing grid + notice floor", () => {
  const start = "2027-06-15T09:00:00.000Z";
  const end = "2027-06-15T12:00:00.000Z";
  const tz = "UTC";
  const now = Date.parse("2027-06-15T08:00:00.000Z");
  assertEquals(
    experienceTimeChoices(start, end, tz, 60, now),
    [9 * 60, 10 * 60, 11 * 60],
  );
  // 2h notice from 08:00 → earliest 10:00.
  assertEquals(
    experienceTimeChoices(start, end, tz, 60, now + 120 * 60_000),
    [10 * 60, 11 * 60],
  );
  assertEquals(experienceTimeChoices(start, end, tz, 120, now).length, 2);
});
