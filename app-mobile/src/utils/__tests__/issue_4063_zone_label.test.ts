import assert from "node:assert/strict";
import test from "node:test";

import {
  formatStartsAtLabel,
  formatTicketTimeLine,
  zoneLabel,
} from "../zoneLabel.ts";

test("formats event-local date labels and friendly IANA zone names", () => {
  assert.equal(zoneLabel("Europe/London"), "London");
  assert.equal(zoneLabel("America/Argentina/Buenos_Aires"), "Buenos Aires");
  assert.match(
    formatStartsAtLabel("2026-10-25T19:30:00.000Z", "Europe/London") ?? "",
    /Sun 25 Oct.*19:30/,
  );
});

test("ticket time line names the event timezone and venue", () => {
  assert.match(
    formatTicketTimeLine(
      "2026-10-25T19:30:00.000Z",
      "Europe/London",
      "The Venue, London",
    ) ?? "",
    /London time\).*The Venue, London/,
  );
});

test("invalid timestamps fail closed", () => {
  assert.equal(formatStartsAtLabel("not-a-date", "Europe/London"), null);
});
