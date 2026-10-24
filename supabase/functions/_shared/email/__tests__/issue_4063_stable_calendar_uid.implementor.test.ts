import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCalendarLinks,
  buildMultiDateCalendarLinks,
} from "../calendar.ts";

function uidLines(ics: string): string[] {
  return ics.split("\r\n").filter((line) => line.startsWith("UID:"));
}

function unfold(ics: string): string {
  return ics.replaceAll("\r\n ", "");
}

Deno.test("#4063 repeated order calendar renders keep an identical explicit UID", () => {
  const input = {
    title: "Bachata Takeover",
    startAtIso: "2026-10-25T18:30:00.000Z",
    endAtIso: "2026-10-25T22:00:00.000Z",
    locationText: "The Waterside",
    isOnline: false,
    description:
      "Bachata Takeover, hosted by Bachata Lagos. Order A1B2C3D4. Your ticket is in the Mingla app.",
    uid: "mingla-order-a1b2c3d4-1111-2222-3333-444444444444-main@usemingla.com",
  };
  const first = buildCalendarLinks(input);
  const retry = buildCalendarLinks(input);
  if (!first || !retry) throw new Error("calendar_not_rendered");
  assertEquals(uidLines(first.icsContent), uidLines(retry.icsContent));
  assertEquals(uidLines(first.icsContent), [`UID:${input.uid}`]);
  assertStringIncludes(first.icsContent, "SEQUENCE:0");
  assertStringIncludes(
    unfold(first.icsContent),
    "Your ticket is in the Mingla app.",
  );
  assertEquals(first.icsContent.includes("Tickets attached"), false);
});

Deno.test("#4063 multi-date order calendars keep one stable UID per occurrence", () => {
  const first = buildMultiDateCalendarLinks(
    [
      {
        title: "Friday",
        startAtIso: "2026-10-25T18:30:00.000Z",
        locationText: "The Waterside",
        uid: "mingla-order-order-1-date-1@usemingla.com",
      },
      {
        title: "Saturday",
        startAtIso: "2026-10-26T18:30:00.000Z",
        locationText: "The Waterside",
        uid: "mingla-order-order-1-date-2@usemingla.com",
      },
    ],
    {
      title: "Weekend",
      startAtIso: "2026-10-25T18:30:00.000Z",
      locationText: "The Waterside",
      isOnline: false,
      description: "Your ticket is in the Mingla app.",
      uid: "mingla-order-order-1-main@usemingla.com",
    },
  );
  const retry = buildMultiDateCalendarLinks(
    [
      {
        title: "Friday",
        startAtIso: "2026-10-25T18:30:00.000Z",
        locationText: "The Waterside",
        uid: "mingla-order-order-1-date-1@usemingla.com",
      },
      {
        title: "Saturday",
        startAtIso: "2026-10-26T18:30:00.000Z",
        locationText: "The Waterside",
        uid: "mingla-order-order-1-date-2@usemingla.com",
      },
    ],
    {
      title: "Weekend",
      startAtIso: "2026-10-25T18:30:00.000Z",
      locationText: "The Waterside",
      isOnline: false,
      description: "Your ticket is in the Mingla app.",
      uid: "mingla-order-order-1-main@usemingla.com",
    },
  );
  if (!first || !retry) throw new Error("calendar_not_rendered");
  assertEquals(uidLines(first.icsContent), [
    "UID:mingla-order-order-1-date-1@usemingla.com",
    "UID:mingla-order-order-1-date-2@usemingla.com",
  ]);
  assertEquals(uidLines(first.icsContent), uidLines(retry.icsContent));
  assertEquals(
    first.icsContent.split("\r\n").filter((line) => line === "SEQUENCE:0")
      .length,
    2,
  );
});

Deno.test("#4063 legacy calendar calls without an explicit UID are deterministic", () => {
  const input = {
    title: "Legacy event",
    startAtIso: "2026-10-25T18:30:00.000Z",
    locationText: "The Waterside",
    isOnline: false,
    description: "Legacy event",
  };
  const first = buildCalendarLinks(input);
  const retry = buildCalendarLinks(input);
  if (!first || !retry) throw new Error("calendar_not_rendered");
  assertEquals(uidLines(first.icsContent), uidLines(retry.icsContent));
});
