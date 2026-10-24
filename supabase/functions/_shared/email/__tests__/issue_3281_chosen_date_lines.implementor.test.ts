// #3281 PR6 — multi-date confirmation lines + multi-VEVENT ICS.
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatChosenOccurrenceLines,
  formatChosenOccurrenceList,
} from "../dateLine.ts";
import { buildMultiDateCalendarLinks } from "../calendar.ts";

Deno.test("formatChosenOccurrenceLines adds override title and place", () => {
  const { primary, secondary } = formatChosenOccurrenceLines({
    start_at: "2026-10-25T16:00:00.000Z",
    end_at: "2026-10-25T19:00:00.000Z",
    timezone: "UTC",
    override_title: "Halloween edition",
    override_location: "Okun Ajah Beach",
  });
  assertStringIncludes(primary, "25");
  assertEquals(secondary, "Halloween edition · Okun Ajah Beach");
});

Deno.test("formatChosenOccurrenceList lists each day then its override line", () => {
  const lines = formatChosenOccurrenceList([
    {
      start_at: "2026-10-25T16:00:00.000Z",
      end_at: "2026-10-25T19:00:00.000Z",
      timezone: "UTC",
      override_title: "Fri night",
      override_location: null,
    },
    {
      start_at: "2026-10-26T16:00:00.000Z",
      end_at: "2026-10-26T19:00:00.000Z",
      timezone: "UTC",
      override_title: null,
      override_location: "Beach club",
    },
  ]);
  assertEquals(lines.length, 4);
  assertEquals(lines[1], "Fri night");
  assertEquals(lines[3], "Beach club");
});

Deno.test("buildMultiDateCalendarLinks emits one VEVENT per date", () => {
  const links = buildMultiDateCalendarLinks(
    [
      {
        title: "Fri night",
        startAtIso: "2026-10-25T16:00:00.000Z",
        endAtIso: "2026-10-25T19:00:00.000Z",
        locationText: "Okun Ajah Beach",
      },
      {
        title: "Sat night",
        startAtIso: "2026-10-26T16:00:00.000Z",
        endAtIso: "2026-10-26T19:00:00.000Z",
        locationText: "Beach club",
      },
    ],
    {
      title: "Rooftop Series",
      startAtIso: "2026-10-25T16:00:00.000Z",
      endAtIso: "2026-10-26T19:00:00.000Z",
      locationText: null,
      isOnline: false,
      description: "Order #abcd",
    },
  );
  if (links === null) throw new Error("expected calendar links");
  const vevents = links.icsContent.match(/BEGIN:VEVENT/g) ?? [];
  assertEquals(vevents.length, 2);
  assertStringIncludes(links.icsContent, "SUMMARY:Fri night");
  assertStringIncludes(links.icsContent, "SUMMARY:Sat night");
});
