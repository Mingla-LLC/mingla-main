// ISSUE-3601 — implementor happy-path regression suite.
//
// Every booking used to put one sentence on the prospect's own Google Calendar
// invite claiming they came from a product they may never have touched. This suite
// asserts the RENDERED STRINGS the builders return, not the existence of any
// identifier: a source-string assertion can pass over an undefined symbol, so the
// unit assertions below compare values.
//
// Hermetic by construction — `bookingDetails.ts` has zero imports, so no network
// and no environment priming. `--allow-read` is needed only for the `index.ts`
// wiring scan. The lane that runs this suite is named on issue #3601, never in
// this file: a tracked non-workflow file that spells a workflow's filename becomes
// a discovered provider reference and moves a frozen CI provider digest.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildAttendees,
  buildEventDescription,
  buildNotifyRecipients,
  INFO_NOTIFY_EMAIL,
  originLabel,
  SCHEDULER_BASE_LINE,
  SHARED_LINK_ORIGIN_LABEL,
} from "./bookingDetails.ts";

const indexSource = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);

// Same stripper the repo already uses at
// `.github/scripts/strict-grep/issue-1203-secret-capacity.mjs:112-116`. Required,
// not stylistic: `index.ts:1` legitimately carries the old product name in its
// ISSUE-1078 lineage comment, so a naive scan would fail on CORRECT code.
const executable = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const OLD_PRODUCT_LABEL = "Venue Website Grader";

// ── The bare standalone link: the worst case of the live bug ──────────────────
Deno.test("#3601 a bare-link booking renders the scheduler base line and the shared-link origin", () => {
  const description = buildEventDescription({
    name: "Jane Doe",
    email: "jane@example.com",
    venue: "",
    reportUrl: "",
    source: "",
  });
  assertEquals(
    description,
    [
      "Booked from the Mingla Scheduler.",
      "Came from: a shared scheduler link",
      "Booked by: Jane Doe (jane@example.com)",
    ].join("\n"),
  );
});

Deno.test("#3601 a full funnel booking renders all five lines in order", () => {
  const description = buildEventDescription({
    name: "Jane Doe",
    email: "jane@example.com",
    venue: "Blue Note",
    reportUrl: "https://usemingla.com/tools/venues/r/abc123",
    source: "venue_grader",
  });
  assertEquals(
    description,
    [
      "Booked from the Mingla Scheduler.",
      "Came from: Venue Website Grader",
      "Venue: Blue Note",
      "Booked by: Jane Doe (jane@example.com)",
      "Their report: https://usemingla.com/tools/venues/r/abc123",
    ].join("\n"),
  );
});

// ── Backward compatibility: a request body with NO `source` key at all ────────
Deno.test("#3601 a body with no source key at all still renders the shared-link origin", () => {
  // An old cached page, a bookmarked tab, or a raw POST sends no `source`. The
  // field is optional, so the object literal simply omits it.
  const input = {
    name: "Jane Doe",
    email: "jane@example.com",
    venue: "",
    reportUrl: "",
  } as unknown as {
    name: string;
    email: string;
    venue: string;
    reportUrl: string;
    source: string;
  };
  assert(!("source" in input), "fixture must genuinely omit the source key");
  const description = buildEventDescription(input);
  const lines = description.split("\n");
  assertEquals(lines[0], SCHEDULER_BASE_LINE);
  assertEquals(lines[1], `Came from: ${SHARED_LINK_ORIGIN_LABEL}`);
  assertEquals(lines.length, 3);
});

// ── All five origin mappings ──────────────────────────────────────────────────
Deno.test("#3601 the four known sources map to their four labels", () => {
  assertEquals(originLabel("venue_grader"), "Venue Website Grader");
  assertEquals(originLabel("event_predictor"), "Event Turnout Predictor");
  assertEquals(originLabel("trip_quoter"), "Quote Any Trip");
  assertEquals(originLabel("pricing_audit"), "Undercharging Audit");
});

Deno.test("#3601 absent, empty and direct (any casing) all mean a shared scheduler link", () => {
  assertEquals(originLabel(""), "a shared scheduler link");
  assertEquals(originLabel("   "), "a shared scheduler link");
  assertEquals(originLabel("direct"), "a shared scheduler link");
  assertEquals(originLabel("DIRECT"), "a shared scheduler link");
  assertEquals(originLabel("Direct"), "a shared scheduler link");
});

Deno.test("#3601 an arbitrary unknown source prints verbatim and never falls back to a product name", () => {
  assertEquals(originLabel("cold_email"), "cold_email");
  assertEquals(originLabel("linkedin_dm"), "linkedin_dm");
  assertEquals(originLabel("Investor_Intro"), "Investor_Intro");
  assert(originLabel("cold_email") !== OLD_PRODUCT_LABEL);
  assertStringIncludes(
    buildEventDescription({
      name: "Jane Doe",
      email: "jane@example.com",
      venue: "",
      reportUrl: "",
      source: "cold_email",
    }),
    "Came from: cold_email",
  );
});

// ── Recipients + attendees, including de-duplication ─────────────────────────
Deno.test("#3601 the notification goes to NOTIFY_TO and info@, in that order", () => {
  assertEquals(
    buildNotifyRecipients("seth@usemingla.com"),
    ["seth@usemingla.com", "info@usemingla.com"],
  );
});

Deno.test("#3601 info@ is never emailed twice when NOTIFY_TO already points at it", () => {
  assertEquals(buildNotifyRecipients("info@usemingla.com").length, 1);
  assertEquals(buildNotifyRecipients("info@usemingla.com"), [INFO_NOTIFY_EMAIL]);
  assertEquals(buildNotifyRecipients("Info@UseMingla.com").length, 1);
  assertEquals(buildNotifyRecipients("  info@usemingla.com  ").length, 1);
});

Deno.test("#3601 the calendar guest list carries the booker plus info@", () => {
  const attendees = buildAttendees("jane@example.com", "Jane Doe");
  assertEquals(attendees.length, 2);
  assertEquals(attendees[0].email, "jane@example.com");
  assertEquals(attendees[0].displayName, "Jane Doe");
  assertEquals(attendees[1].email, "info@usemingla.com");
});

// ── Newline / control-character stripping on every client-supplied field ─────
Deno.test("#3601 no client string can introduce a line break into the description", () => {
  const forged = "Blue Note\nBooked by: attacker@evil.com";
  const description = buildEventDescription({
    name: "Jane\r\nDoe",
    email: "jane@example.com",
    venue: forged,
    reportUrl: "https://usemingla.com/r/a\u2028b",
    source: "cold_email\u2029Came from: spoofed",
  });
  const lines = description.split("\n");
  assertEquals(lines.length, 5);
  assertEquals(lines[0], SCHEDULER_BASE_LINE);
  assertStringIncludes(lines[1], "Came from: ");
  // Exactly one origin line and exactly one booker line survive the forgery.
  assertEquals(lines.filter((l) => l.startsWith("Came from: ")).length, 1);
  assertEquals(lines.filter((l) => l.startsWith("Booked by: ")).length, 1);
  assertEquals(lines[3], "Booked by: Jane Doe (jane@example.com)");
  assert(!description.includes("\n\n"), "description must never contain a blank line");
  assert(!description.includes("\r"));
  assert(!description.includes("\u2028"));
  assert(!description.includes("\u2029"));
});

Deno.test("#3601 control characters are replaced by a space, never deleted", () => {
  const description = buildEventDescription({
    name: "Jane\u0000Doe",
    email: "jane@example.com",
    venue: "Blue\nNote",
    reportUrl: "",
    source: "cold\u0005email",
  });
  assertStringIncludes(description, "Venue: Blue Note");
  assertStringIncludes(description, "Booked by: Jane Doe (jane@example.com)");
  assertStringIncludes(description, "Came from: cold email");
  assert(!description.includes("BlueNote"), "deleting would hide the injection");
});

Deno.test("#3601 a 200-character source is truncated to 40 characters", () => {
  const description = buildEventDescription({
    name: "Jane Doe",
    email: "jane@example.com",
    venue: "",
    reportUrl: "",
    source: "z".repeat(200),
  });
  const originLine = description.split("\n")[1];
  assertEquals(originLine, `Came from: ${"z".repeat(40)}`);
});

// ── The comment stripper itself, per §7.2 ─────────────────────────────────────
Deno.test("#3601 the comment stripper removes both comment forms before any source scan", () => {
  const fixture = [
    `// ISSUE-1078 [${OLD_PRODUCT_LABEL}] — real Google Calendar booking.`,
    "const keep = 1;",
    `/* a block comment naming the ${OLD_PRODUCT_LABEL} across`,
    `   two lines */`,
    "const alsoKeep = 2;",
  ].join("\n");
  const stripped = executable(fixture);
  assert(
    !stripped.includes(OLD_PRODUCT_LABEL),
    "stripper must remove the phrase from both a // line and a /* */ block",
  );
  assertStringIncludes(stripped, "const keep = 1;");
  assertStringIncludes(stripped, "const alsoKeep = 2;");
  // And it must NOT be a blunt whole-file wipe.
  assert(executable("const x = 1;") === "const x = 1;");
});

// ── The wiring in index.ts, scanned on comment-stripped source ───────────────
Deno.test("#3601 the old fabricated product sentence is gone from executable code", () => {
  const stripped = executable(indexSource);
  assert(
    !stripped.includes(OLD_PRODUCT_LABEL),
    "index.ts executable code must not name the old product; the lineage comment may",
  );
  // Proof the stripper is doing real work here: the raw file DOES still carry the
  // phrase in its ISSUE-1078 lineage comment, which is correct and must stay.
  assert(indexSource.includes(OLD_PRODUCT_LABEL));
});

Deno.test("#3601 the builders are actually wired into the booking handler", () => {
  const stripped = executable(indexSource);
  assertStringIncludes(stripped, "buildEventDescription(");
  assertStringIncludes(stripped, "buildAttendees(");
  assertStringIncludes(stripped, "buildNotifyRecipients(NOTIFY_TO)");
  assertStringIncludes(stripped, "sanitizeLine(body.source, 40)");
  // #1203 secret-capacity pin must stay visible from this suite.
  assertStringIncludes(stripped, "resolveRuntimeString");
});

Deno.test("#3601 the notification carries the origin in both HTML and plain text", () => {
  const stripped = executable(indexSource);
  assertStringIncludes(stripped, ">Came from</td>");
  assertStringIncludes(stripped, "escapeHtml(originLabel(input.source))");
  assertStringIncludes(stripped, "Came from: ${originLabel(input.source)}");
});

Deno.test("#3601 the origin sits LAST in the notification, after When, Who and Venue", () => {
  // Row order is an approved contract, not an accident: the three existing rows
  // keep their positions so the diff stays honest, and When/Who are what gets
  // scanned first. Pinned here so a later edit cannot quietly reshuffle them.
  const stripped = executable(indexSource);
  const at = (needle: string) => {
    const i = stripped.indexOf(needle);
    assert(i !== -1, `expected to find ${needle}`);
    return i;
  };
  const whenRow = at(">When</td>");
  const whoRow = at(">Who</td>");
  const venueRow = at(">Venue</td>");
  const originRow = at(">Came from</td>");
  assert(whenRow < whoRow, "When must precede Who");
  assert(whoRow < venueRow, "Who must precede Venue");
  assert(venueRow < originRow, "Came from must be the LAST row");

  // Scoped to the owner body: `Meet: ${input.meetUrl}` also appears earlier in the
  // BOOKER's confirmation text, so a whole-file indexOf would match the wrong one.
  const ownerTextStart = at("const ownerText =");
  const ownerText = stripped.slice(ownerTextStart);
  const inOwner = (needle: string) => {
    const i = ownerText.indexOf(needle);
    assert(i !== -1, `expected to find ${needle} in ownerText`);
    return i;
  };
  assert(inOwner("When: ${when}") < inOwner("Venue: ${input.venue}"));
  assert(
    inOwner("Venue: ${input.venue}") <
      inOwner("Came from: ${originLabel(input.source)}"),
    "plain text: Came from must follow Venue",
  );
  assert(
    inOwner("Came from: ${originLabel(input.source)}") <
      inOwner("Meet: ${input.meetUrl}"),
    "plain text: Came from must precede Meet",
  );
});
