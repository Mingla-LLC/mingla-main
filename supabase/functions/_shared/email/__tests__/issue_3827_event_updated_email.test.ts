// Issue #3827 — the email a buyer gets when a host materially changes a live
// listing. Renders the REAL module and reads the result; nothing is sent.
//
// What it proves:
//   - the subject comes from a fixed vocabulary plus the listing name, and a
//     host's reason can never reach it;
//   - times are printed in the listing's own timezone, with the zone named;
//   - a hide-address event prints the venue names and "The address has
//     changed", never a street; an experience prints no stop detail at all;
//   - a hostile reason (markup, script and data links, bidi overrides,
//     zero-width characters, header-injection newlines, bare domains, email
//     addresses) arrives as inert quoted text;
//   - a plain-text alternative carries the same facts;
//   - replies go to the brand's contact address when it is well formed, and
//     to support otherwise.
//
// fails-on-revert:
//   - drop the reason sanitiser            -> H-* red (links and bidi survive)
//   - drop escapeHtml on the reason        -> H-01 reds (raw <script> in HTML)
//   - put the reason in the subject        -> S-02 reds
//   - print `old`/`new` of a withheld row  -> P-01 reds
//
// Run: deno test --allow-env --allow-net --allow-read --no-check <this file>

import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.env.set("DENO_TESTING", "1");

const {
  cleanLine,
  eventUpdatedSubject,
  eventUpdateReplyTo,
  LINK_REMOVED,
  renderEventUpdatedEmail,
  sanitiseEditReason,
  zoneLine,
} = await import("../eventUpdatedEmail.ts");
type Input = Parameters<typeof renderEventUpdatedEmail>[0];

const ch = (...codes: number[]): string => String.fromCharCode(...codes);
const RLO = ch(0x202e);
const PDF = ch(0x202c);
const ZWSP = ch(0x200b);
const ZWJ = ch(0x200d);
const LRI = ch(0x2066);
const BOM = ch(0xfeff);
const LINE_SEPARATOR = ch(0x2028);

const EVENT_URL = "https://host.usemingla.com/e/casa-lenta/sunset-sessions";

function eventInput(overrides: Partial<Input> = {}): Input {
  return {
    kind: "event",
    eventName: "Sunset Sessions: Lagos Rooftop Supper",
    brandName: "Casa Lenta Retreats",
    recipientName: "Adaeze",
    timezone: "Africa/Lagos",
    reason:
      "The original venue has a power fault, so we have moved to a space nearby and shifted by one day.",
    eventUrl: EVENT_URL,
    changes: [
      {
        field: "dates",
        old: [{ s: "2026-11-06T17:00:00Z", e: "2026-11-06T21:00:00Z" }],
        new: [{ s: "2026-11-07T18:00:00Z", e: "2026-11-07T22:00:00Z" }],
      },
      { field: "venue", old: "Waterside Event Centre", new: "The Deck at Landmark" },
      {
        field: "address",
        old: "5 Admiralty Road, Lekki Phase 1, Lagos",
        new: "Water Corporation Drive, Victoria Island, Lagos",
      },
    ],
    ...overrides,
  };
}

Deno.test("R-01 an event change renders through the shell with old and new values", () => {
  const out = renderEventUpdatedEmail(eventInput());
  assert(out.html.startsWith("<!doctype html>"), "the document comes from renderShell");
  assertEquals(out.html.match(/<!doctype html>/g)?.length, 1);
  assertStringIncludes(out.html, "Update from Casa Lenta Retreats");
  assertStringIncludes(out.html, "The venue and time have changed");
  assertStringIncludes(out.html, "Hi Adaeze,");
  assertStringIncludes(out.html, "Your ticket is still valid.");
  assertStringIncludes(out.html, "Waterside Event Centre");
  assertStringIncludes(out.html, "The Deck at Landmark");
  assertStringIncludes(out.html, "5 Admiralty Road, Lekki Phase 1, Lagos");
  assertStringIncludes(out.html, "Water Corporation Drive, Victoria Island, Lagos");
  assertStringIncludes(out.html, "Reason given by Casa Lenta Retreats");
  assertStringIncludes(out.html, "View the event page");
  assertStringIncludes(out.html, `href="${EVENT_URL}"`);
  assertStringIncludes(
    out.html,
    "Sent by Mingla on behalf of Casa Lenta Retreats, because you have a ticket for this event.",
  );
  assertEquals(out.from.address, "tickets@usemingla.com");
  assertEquals(
    out.preheader,
    "Casa Lenta Retreats changed the venue and time for Sunset Sessions: Lagos Rooftop Supper. Here is what is different.",
  );
});

Deno.test("R-02 times are in the event's timezone and the zone is named", () => {
  const out = renderEventUpdatedEmail(eventInput());
  // 17:00Z on 6 Nov is 6:00 PM in Lagos (GMT+1); 18:00Z on 7 Nov is 7:00 PM.
  assertStringIncludes(out.html, "Fri, 6 Nov 2026 · 6:00 PM – 10:00 PM");
  assertStringIncludes(out.html, "Sat, 7 Nov 2026 · 7:00 PM – 11:00 PM");
  assertStringIncludes(out.html, "Lagos time (GMT+1)");
  assertEquals(zoneLine("America/New_York", "2026-11-07T18:00:00Z"), "New York time (GMT-5)");
  assertEquals(zoneLine("America/New_York", "2026-07-07T18:00:00Z"), "New York time (GMT-4)");

  // The same instants for a New York listing print New York wall-clock time.
  const ny = renderEventUpdatedEmail(eventInput({ timezone: "America/New_York" }));
  assertStringIncludes(ny.html, "Sat, 7 Nov 2026 · 1:00 PM – 5:00 PM");
  assertStringIncludes(ny.html, "New York time (GMT-5)");
  assertFalse(ny.html.includes("7:00 PM – 11:00 PM"));
});

Deno.test("S-01 the subject is fixed vocabulary plus the event name", () => {
  const name = "Sunset Sessions";
  assertEquals(
    eventUpdatedSubject("event", name, [{ field: "dates" }, { field: "venue" }]),
    "Venue and time changed: Sunset Sessions",
  );
  assertEquals(
    eventUpdatedSubject("event", name, [{ field: "dates" }, { field: "timezone" }]),
    "Date changed: Sunset Sessions",
  );
  assertEquals(
    eventUpdatedSubject("event", name, [{ field: "address" }]),
    "Venue changed: Sunset Sessions",
  );
  assertEquals(
    eventUpdatedSubject("event", name, [{ field: "format" }, { field: "dates" }]),
    "Event details changed: Sunset Sessions",
  );
  assertEquals(
    eventUpdatedSubject("experience", name, [{ field: "route" }]),
    "Details changed: Sunset Sessions",
  );
  assertEquals(
    eventUpdatedSubject("experience", name, [{ field: "dates" }]),
    "Dates changed: Sunset Sessions",
  );
});

Deno.test("S-02 the reason never reaches the subject, and a name cannot inject a header", () => {
  const out = renderEventUpdatedEmail(eventInput({ reason: "UNIQUE-REASON-TOKEN changed our plans" }));
  assertFalse(out.subject.includes("UNIQUE-REASON-TOKEN"));
  assertStringIncludes(out.html, "UNIQUE-REASON-TOKEN");

  const injected = renderEventUpdatedEmail(eventInput({
    eventName: `Supper\r\nBcc: victim@example.test${LINE_SEPARATOR}X-Injected: 1`,
  }));
  assertFalse(/[\r\n]/.test(injected.subject), "no line break in the subject");
  assertFalse(injected.subject.includes(LINE_SEPARATOR));
  assertEquals(
    injected.subject,
    "Venue and time changed: Supper Bcc: victim@example.test X-Injected: 1",
  );
});

Deno.test("P-01 a hide-address event prints venue names and never a street", () => {
  const out = renderEventUpdatedEmail(eventInput({
    reason: null,
    changes: [
      { field: "venue", old: "Waterside Event Centre", new: "The Deck at Landmark" },
      // Even if a street somehow rode along, a withheld row prints no value.
      {
        field: "address",
        withheld: true,
        old: "5 Admiralty Road, Lekki Phase 1, Lagos",
        new: "Water Corporation Drive, Victoria Island, Lagos",
      },
    ],
  }));
  for (const body of [out.html, out.text]) {
    assertStringIncludes(body, "Waterside Event Centre");
    assertStringIncludes(body, "The Deck at Landmark");
    assertStringIncludes(body, "The address has changed. You will find it on the event page.");
    assertFalse(body.includes("Admiralty"), "old street printed");
    assertFalse(body.includes("Water Corporation"), "new street printed");
  }
  assertFalse(out.html.includes("Reason given by"), "no reason block without a reason");

  // Address only: the current venue name is shown beside the sentence.
  const addressOnly = renderEventUpdatedEmail(eventInput({
    changes: [{ field: "address", withheld: true }],
    venueName: "The Deck at Landmark",
  }));
  assertStringIncludes(addressOnly.html, "Venue: The Deck at Landmark");
  assertStringIncludes(addressOnly.html, "The address has changed. You will find it on the event page.");
});

Deno.test("P-02 an experience prints no stop detail, and its own wording", () => {
  const out = renderEventUpdatedEmail({
    kind: "experience",
    eventName: "Brooklyn Speakeasy Walk",
    brandName: "Casa Lenta Retreats",
    recipientName: null,
    timezone: "America/New_York",
    reason: "One of the rooms is closed that night.",
    eventUrl: "https://host.usemingla.com/exp/casa-lenta/brooklyn-speakeasy-walk",
    changes: [{ field: "route" }, { field: "stop_times" }],
  });
  assertEquals(out.subject, "Details changed: Brooklyn Speakeasy Walk");
  for (const body of [out.html, out.text]) {
    assertStringIncludes(body, "Your experience has changed");
    assertStringIncludes(body, "Your booking is still valid.");
    assertStringIncludes(body, "The location or route has changed.");
    assertStringIncludes(body, "Stop times have changed.");
    assertStringIncludes(body, "experience page");
    assertStringIncludes(body, "View the experience");
    assertStringIncludes(body, "Hi,");
  }
  assertFalse(out.html.includes("Was:"), "a route change shows no old value");

  const dates = renderEventUpdatedEmail({
    kind: "experience",
    eventName: "Brooklyn Speakeasy Walk",
    brandName: "Casa Lenta Retreats",
    recipientName: "Ben",
    timezone: "America/New_York",
    reason: null,
    eventUrl: "https://host.usemingla.com/exp/casa-lenta/brooklyn-speakeasy-walk",
    changes: [{ field: "dates", many: true }],
  });
  assertEquals(dates.subject, "Dates changed: Brooklyn Speakeasy Walk");
  assertStringIncludes(dates.html, "The dates have changed.");
});

Deno.test("P-03 the online link is never printed, and an RSVP gets RSVP wording", () => {
  const out = renderEventUpdatedEmail(eventInput({
    kind: "rsvp",
    changes: [
      { field: "format", old: "in_person", new: "hybrid" },
      { field: "online_link", old_present: false, new_present: true },
    ],
  }));
  assertStringIncludes(out.html, "In person and online");
  assertStringIncludes(out.html, "An online link has been added. You will find it on the event page.");
  assertStringIncludes(out.html, "Your RSVP still stands.");
  assertStringIncludes(out.html, "because you said you are going to this event");
  assertEquals(out.subject, "Event details changed: Sunset Sessions: Lagos Rooftop Supper");
  assertThrows(
    () => renderEventUpdatedEmail(eventInput({ changes: [{ field: "not_a_known_field" }] })),
    Error,
    "event_update_email_nothing_to_say",
  );
});

Deno.test("H-01 markup in a reason is quoted text, never HTML", () => {
  const out = renderEventUpdatedEmail(eventInput({
    reason: `<script>alert(1)</script><img src=x onerror=alert(2)> "quoted" & 'single'`,
  }));
  assertFalse(out.html.includes("<script>"), "raw script tag");
  assertFalse(out.html.includes("<img src=x"), "raw img tag");
  assertStringIncludes(out.html, "&lt;script&gt;alert(1)&lt;/script&gt;");
  assertStringIncludes(out.html, "&quot;quoted&quot; &amp; &#39;single&#39;");
  // The only anchors in the body are ours.
  const hrefs = [...out.html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
  assertEquals(hrefs.filter((href) => href !== EVENT_URL && !href.startsWith("mailto:support@")), []);
});

Deno.test("H-02 links, script and data URLs, bare domains and addresses are removed", () => {
  const cases: Array<[string, string[]]> = [
    ["Pay the difference at https://evil.example/pay?x=1 today", ["https://", "evil.example"]],
    ["Click javascript:alert(document.cookie) to confirm", ["javascript:", "alert("]],
    ["Open data:text/html;base64,PHNjcmlwdD4= now please", ["data:", "base64"]],
    ["Details on www.evil-site.io/login for everyone", ["www.", "evil-site"]],
    ["Go to evil-site.com/claim to keep your ticket", ["evil-site.com"]],
    ["Write to refunds@evil.example for your money back", ["refunds@", "evil.example"]],
    ["Text mailto:someone@example.test or tel:+15551234567", ["mailto:", "tel:", "+1555"]],
    [`Visit evil${ZWSP}-site.com and exa${ZWJ}mple.com${BOM} soon`, ["site.com", "mple.com"]],
  ];
  for (const [reason, forbidden] of cases) {
    const cleaned = sanitiseEditReason(reason);
    assert(cleaned, `nothing left of: ${reason}`);
    assertStringIncludes(cleaned, LINK_REMOVED);
    const out = renderEventUpdatedEmail(eventInput({ reason }));
    for (const fragment of forbidden) {
      assertFalse(cleaned.includes(fragment), `"${fragment}" survived in: ${cleaned}`);
      const quoted = out.html.slice(out.html.indexOf("Reason given by"));
      const block = quoted.slice(0, quoted.indexOf("</table>"));
      assertFalse(block.includes(fragment), `"${fragment}" reached the HTML reason block`);
      const textBlock = out.text.slice(out.text.indexOf("Reason given by"));
      assertFalse(
        textBlock.slice(0, textBlock.indexOf("View the event page")).includes(fragment),
        `"${fragment}" reached the plain-text reason`,
      );
    }
  }
  // Ordinary punctuation is not mistaken for a link.
  assertEquals(
    sanitiseEditReason("Doors at 7 p.m. now, not 6. See you there, e.g. by the bar."),
    "Doors at 7 p.m. now, not 6. See you there, e.g. by the bar.",
  );
});

Deno.test("H-03 bidi overrides, zero-width characters and line breaks are stripped", () => {
  const hostile =
    `Venue moved${RLO}gnp.exe${PDF} ${LRI}hidden${ZWSP}${ZWJ}${BOM}\r\nBcc: x@example.test\n\n\tSecond line${LINE_SEPARATOR}third`;
  const cleaned = sanitiseEditReason(hostile);
  assert(cleaned);
  for (const code of [0x202e, 0x202c, 0x2066, 0x200b, 0x200d, 0xfeff, 0x2028, 0x0a, 0x0d, 0x09]) {
    assertFalse(cleaned.includes(ch(code)), `U+${code.toString(16)} survived`);
  }
  assertEquals(cleaned, `Venue movedgnp.exe hidden Bcc: ${LINK_REMOVED} Second line third`);
  const out = renderEventUpdatedEmail(eventInput({ reason: hostile }));
  for (const code of [0x202e, 0x2066, 0x200b, 0x200d, 0xfeff, 0x2028]) {
    assertFalse(out.html.includes(ch(code)), `U+${code.toString(16)} reached the HTML`);
    assertFalse(out.text.includes(ch(code)), `U+${code.toString(16)} reached the text`);
    assertFalse(out.subject.includes(ch(code)), `U+${code.toString(16)} reached the subject`);
  }
  // A name is cleaned the same way wherever it is printed.
  const named = renderEventUpdatedEmail(eventInput({
    brandName: `Casa${RLO} Lenta`,
    recipientName: `Ada${ZWSP}eze\n`,
  }));
  assertStringIncludes(named.html, "Update from Casa Lenta");
  assertStringIncludes(named.html, "Hi Adaeze,");
});

Deno.test("H-04 the reason is capped, and an empty or placeholder reason is left out", () => {
  assertEquals(sanitiseEditReason("x".repeat(500))?.length, 200);
  assertEquals(sanitiseEditReason("   \n\t  "), null);
  assertEquals(sanitiseEditReason(null), null);
  assertEquals(sanitiseEditReason(42), null);
  assertEquals(sanitiseEditReason("No buyers at time of edit; no reason given"), null);
  assertEquals(cleanLine(`a${ch(0)}b${ch(0x7f)}c`), "a b c");
  const out = renderEventUpdatedEmail(eventInput({ reason: "   " }));
  assertFalse(out.html.includes("Reason given by"));
  assertFalse(out.text.includes("Reason given by"));
});

Deno.test("T-01 the plain-text alternative carries the same facts in the same order", () => {
  const out = renderEventUpdatedEmail(eventInput());
  assertFalse(/<[a-z]/i.test(out.text), "no markup in the text part");
  const order = [
    "Update from Casa Lenta Retreats",
    "The venue and time have changed",
    "Hi Adaeze,",
    "DATE AND TIME",
    "Was: Fri, 6 Nov 2026 · 6:00 PM – 10:00 PM",
    "Now: Sat, 7 Nov 2026 · 7:00 PM – 11:00 PM",
    "Lagos time (GMT+1)",
    "VENUE",
    "Was: Waterside Event Centre",
    "Now: The Deck at Landmark",
    "ADDRESS",
    "Reason given by Casa Lenta Retreats:",
    `View the event page: ${EVENT_URL}`,
    "Sent by Mingla on behalf of Casa Lenta Retreats",
  ];
  let cursor = -1;
  for (const fragment of order) {
    const at = out.text.indexOf(fragment, cursor + 1);
    assert(at > cursor, `"${fragment}" is missing or out of order in the text part`);
    cursor = at;
  }
});

Deno.test("Y-01 replies go to the brand when its address is well formed, else support", () => {
  assertEquals(eventUpdateReplyTo("hello@casalenta.example"), "hello@casalenta.example");
  assertEquals(eventUpdateReplyTo("  hello@casalenta.example  "), "hello@casalenta.example");
  for (const bad of [null, undefined, "", "not-an-address", "a@b", 42, "two words@x.example"]) {
    assertEquals(eventUpdateReplyTo(bad), "support@usemingla.com", `fallback for ${String(bad)}`);
  }
  // A second recipient or a display name cannot be smuggled into the header.
  assertEquals(eventUpdateReplyTo("a@x.example,b@y.example"), "support@usemingla.com");
  assertEquals(eventUpdateReplyTo("Evil<a@x.example>"), "support@usemingla.com");
  assertEquals(eventUpdateReplyTo("a@x.example", "help@usemingla.com"), "a@x.example");
  assertEquals(eventUpdateReplyTo(null, "help@usemingla.com"), "help@usemingla.com");
});
