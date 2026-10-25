import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatDateRange,
  formatMessageTime,
  plainSpaces,
  zonePlaceLabel,
} from "../messageTime.ts";

const NOW = new Date("2026-10-24T12:00:00.000Z");

Deno.test("#4063 formats listing-local date, time and place deterministically", () => {
  assertEquals(
    formatMessageTime("2026-10-24T23:30:00.000Z", "America/New_York", NOW),
    {
      date: "Sat 24 Oct",
      time: "7:30 PM",
      zoneLabel: "New York time",
      dayWord: "tonight",
      tzKnown: true,
    },
  );
  assertEquals(
    formatMessageTime("2026-10-25T01:30:00.000Z", "Africa/Lagos", NOW),
    {
      date: "Sun 25 Oct",
      time: "2:30 AM",
      zoneLabel: "Lagos time",
      dayWord: "tomorrow",
      tzKnown: true,
    },
  );
});

Deno.test("#4063 renders both sides of the London daylight-saving switch", () => {
  assertEquals(
    formatMessageTime("2026-10-25T00:30:00.000Z", "Europe/London", NOW)?.time,
    "1:30 AM",
  );
  assertEquals(
    formatMessageTime("2026-10-25T01:30:00.000Z", "Europe/London", NOW)?.time,
    "1:30 AM",
  );
});

Deno.test("#4063 preserves ambiguous New York local clock time", () => {
  assertEquals(
    formatMessageTime("2026-11-01T05:30:00.000Z", "America/New_York", NOW)
      ?.time,
    "1:30 AM",
  );
  assertEquals(
    formatMessageTime("2026-11-01T06:30:00.000Z", "America/New_York", NOW)
      ?.time,
    "1:30 AM",
  );
});

Deno.test("#4063 falls back to UTC without claiming timezone knowledge", () => {
  assertEquals(formatMessageTime("2026-10-24T23:30:00.000Z", null, NOW), {
    date: "Sat 24 Oct",
    time: "11:30 PM",
    zoneLabel: "UTC",
    dayWord: "tonight",
    tzKnown: false,
  });
  assertEquals(
    formatMessageTime("2026-10-24T23:30:00.000Z", "Not/AZone", NOW)?.tzKnown,
    false,
  );
  assertEquals(zonePlaceLabel("Etc/GMT"), "UTC");
  assertEquals(
    zonePlaceLabel("America/Argentina/Buenos_Aires"),
    "Buenos Aires time",
  );
});

Deno.test("#4063 rejects invalid instants and normalizes ICU spaces", () => {
  assertEquals(formatMessageTime("garbage", "UTC", NOW), null);
  assertEquals(
    plainSpaces("7:30\u202fPM\u00a0UTC\u2009time"),
    "7:30 PM UTC time",
  );
});

Deno.test("#4063 chooses today, tonight and tomorrow at local boundaries", () => {
  const localNow = new Date("2026-10-24T12:00:00.000Z");
  assertEquals(
    formatMessageTime("2026-10-24T16:59:00.000Z", "UTC", localNow)?.dayWord,
    "today",
  );
  assertEquals(
    formatMessageTime("2026-10-24T17:00:00.000Z", "UTC", localNow)?.dayWord,
    "tonight",
  );
  assertEquals(
    formatMessageTime("2026-10-24T23:59:00.000Z", "UTC", localNow)?.dayWord,
    "tonight",
  );
  assertEquals(
    formatMessageTime("2026-10-25T00:00:00.000Z", "UTC", localNow)?.dayWord,
    "tomorrow",
  );
});

Deno.test("#4063 includes years only outside the reference local year", () => {
  assertEquals(
    formatMessageTime("2026-12-31T18:00:00.000Z", "UTC", NOW)?.date,
    "Thu 31 Dec",
  );
  assertEquals(
    formatMessageTime("2027-01-01T18:00:00.000Z", "UTC", NOW)?.date,
    "Fri 1 Jan 2027",
  );
  assertEquals(
    formatDateRange(
      "2026-12-11T18:00:00.000Z",
      "2026-12-13T18:00:00.000Z",
      "UTC",
      NOW,
    ),
    "Fri 11 Dec – Sun 13 Dec",
  );
});
