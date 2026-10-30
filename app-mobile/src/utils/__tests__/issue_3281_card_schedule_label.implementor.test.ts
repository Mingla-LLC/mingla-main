/**
 * issue #3281 PR7 — card schedule label prefers server scheduleLine.
 * Deno-runnable (pure Intl helpers). [TEST-MOD-APPROVED #3281]
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatCardScheduleLabel } from "../eventDateDisplay.ts";

Deno.test("formatCardScheduleLabel prefixes NEXT: when scheduleLine present", () => {
  assertEquals(
    formatCardScheduleLabel({
      scheduleLine: "Sat 25 Oct · +2 more",
      masterDateUtc: "2020-01-01T00:00:00Z",
      timezone: "UTC",
    }),
    "NEXT: Sat 25 Oct · +2 more",
  );
});

Deno.test("formatCardScheduleLabel falls back to nextStartAtUtc chip", () => {
  const label = formatCardScheduleLabel({
    scheduleLine: null,
    nextStartAtUtc: "2099-06-15T18:00:00Z",
    masterDateUtc: "2020-01-01T00:00:00Z",
    timezone: "UTC",
  });
  assert(!label.startsWith("NEXT:"));
  assert(/Jun|15/.test(label));
});

Deno.test("formatCardScheduleLabel blank scheduleLine does not print NEXT:", () => {
  const label = formatCardScheduleLabel({
    scheduleLine: "   ",
    masterDateUtc: "2099-06-15T18:00:00Z",
    timezone: "UTC",
  });
  assertEquals(label.startsWith("NEXT:"), false);
});
