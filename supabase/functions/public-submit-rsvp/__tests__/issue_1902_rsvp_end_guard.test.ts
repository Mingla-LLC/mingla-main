import { assert } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("shipped handler switches on error.code before legacy message parsing", () => {
  const switchAt = source.indexOf("switch (error.code)");
  const legacyAt = source.indexOf('const code = error.message ?? ""');
  assert(switchAt !== -1, "handler must switch on error.code");
  assert(legacyAt > switchAt, "SQLSTATE mapping must precede legacy parsing");
  for (
    const token of [
      'case "P1901":',
      'return json(410, { error: "rsvp_event_ended" })',
      'case "P1902":',
      'return json(409, { error: "rsvp_date_unavailable" })',
    ]
  ) {
    assert(source.includes(token), `missing exact handler contract: ${token}`);
  }
});

Deno.test("structured rejection logging is PII-minimal", () => {
  const start = source.indexOf("switch (error.code)");
  const end = source.indexOf('const code = error.message ?? ""', start);
  const mapping = source.slice(start, end);
  for (
    const token of [
      "event_id: eventId",
      'reason: "rsvp_event_ended"',
      'reason: "rsvp_date_unavailable"',
      "authenticated: userId !== null",
      "server_timestamp: new Date().toISOString()",
    ]
  ) {
    assert(mapping.includes(token), `missing structured field: ${token}`);
  }
  for (
    const forbidden of [
      "guestName",
      "guestEmail",
      "guestPhone",
      "normalizedGuests",
      "error.message",
      "error.details",
      "error.hint",
    ]
  ) {
    assert(!mapping.includes(forbidden), `rejection log leaks ${forbidden}`);
  }
});
