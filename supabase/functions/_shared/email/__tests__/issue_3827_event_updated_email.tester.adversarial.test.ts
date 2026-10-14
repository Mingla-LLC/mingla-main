// Issue #3827 — tester adversarial proof for the live-edit buyer email.
//
// A different angle from the implementor's suite: it renders the REAL module
// with input a hostile host, a broken row or a strange timezone could produce,
// and reads every byte that would leave Mingla (subject, HTML, plain text,
// Reply-To). It also attacks the pure worker helpers the delivery path relies
// on (missing-function detection, the fan-out call, groups of five).
// Nothing is sent; no network is used.
//
//   TH-*  a hostile reason, brand or event name is inert in HTML and text and
//         never reaches the subject or a header
//   TR-*  Reply-To falls back to support for anything that is not one plain
//         well-formed address
//   TZ-*  times are printed in the listing's zone with the zone named
//         (Lagos, New York in and out of daylight saving, Kiritimati)
//   TP-*  a row that carries values it must not print (a withheld address, an
//         experience stop, an online link) never prints them, even when the
//         database row is wrong
//   TW-*  the worker helpers: a missing fan-out function is "nothing to do",
//         every other failure is reported without throwing; groups of five
//
// fails-on-revert (each verified by editing the module locally, then restored):
//   - escapeHtml dropped on the reason             -> TH-01 reds
//   - BIDI_CHARS no longer removed                 -> TH-03 reds
//   - `withheld` ignored for the address block     -> TP-01 reds
//   - isMissingFunctionError accepts any 42xxx code -> TW-01 reds
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
  eventUpdatedSubject,
  eventUpdateReplyTo,
  LINK_REMOVED,
  renderEventUpdatedEmail,
  sanitiseEditReason,
} = await import("../eventUpdatedEmail.ts");
const {
  fanOutEventEditNotices,
  inGroupsOf,
  isMissingFunctionError,
  buildEventUpdateDispatch,
} = await import("../../../rsvp-notify/eventUpdate.ts");

type Input = Parameters<typeof renderEventUpdatedEmail>[0];

const ch = (...codes: number[]): string => String.fromCodePoint(...codes);
const EVENT_URL = "https://host.usemingla.com/e/casa-lenta/sunset-sessions";

function input(overrides: Partial<Input> = {}): Input {
  return {
    kind: "event",
    eventName: "Sunset Sessions",
    brandName: "Casa Lenta Retreats",
    recipientName: "Ada",
    timezone: "Africa/Lagos",
    changes: [{ field: "venue", old: "Waterside Event Centre", new: "The Deck at Landmark" }],
    reason: "The original venue has a power fault on the night",
    eventUrl: EVENT_URL,
    venueName: "The Deck at Landmark",
    supportEmail: "support@usemingla.com",
    ...overrides,
  };
}

/** Every outbound string of one render, for "never anywhere" checks. */
function everything(rendered: ReturnType<typeof renderEventUpdatedEmail>): string {
  return [rendered.subject, rendered.preheader, rendered.html, rendered.text].join("\n");
}

/** The href values and tag names in the HTML. */
const hrefs = (html: string): string[] =>
  [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
const tags = (html: string): Set<string> =>
  new Set([...html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)/g)].map((match) => match[1].toLowerCase()));

const SHELL_TAGS = (() => {
  const plain = renderEventUpdatedEmail(input({ reason: "A plain reason with nothing odd in it" }));
  return { tags: tags(plain.html), hrefs: hrefs(plain.html), html: plain.html, text: plain.text };
})();
const occurrences = (haystack: string, pattern: RegExp): number =>
  (haystack.match(new RegExp(pattern.source, "gi")) ?? []).length;

const HOSTILE_REASONS: Array<[string, string]> = [
  ["script tag", `<script>alert(document.cookie)</script> moved`],
  ["img onerror", `<img src=x onerror="alert(1)"> moved`],
  ["closing the quote", `"></p></td></tr></table><a href="https://evil.example/pay">Pay</a>`],
  ["javascript url", "Click javascript:alert(1) to confirm"],
  ["mixed-case javascript", "Click JaVaScRiPt:alert(1) now"],
  ["data url", "See data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg== now"],
  ["vbscript url", "Run vbscript:msgbox(1) please"],
  ["already escaped entities", "Moved &lt;b&gt;tonight&lt;/b&gt; &amp; &#60;script&#62;"],
  ["zero-width inside a link", `Pay at ev${ch(0x200b)}il.com/pay${ch(0x2060)} today`],
  ["zero-width inside a scheme", `Go to http${ch(0x200d)}s://evil.example now`],
  ["plus-addressed email", "Write to ada+refunds@evil.example for money"],
  ["mailto", "mailto:refunds@evil.example for money"],
  ["www link", "Details at www.evil.example/pay today"],
];

// ─── TH-01: hostile reasons are inert in HTML and text ──────────────────────
Deno.test("TH-01 a hostile reason never adds a tag, a link or a live scheme to the HTML or the text", () => {
  for (const [label, reason] of HOSTILE_REASONS) {
    const rendered = renderEventUpdatedEmail(input({ reason }));
    for (const tag of tags(rendered.html)) {
      assert(SHELL_TAGS.tags.has(tag), `${label}: the reason added a <${tag}> element`);
    }
    assertEquals(hrefs(rendered.html), SHELL_TAGS.hrefs, `${label}: the reason added or changed a link`);
    assertFalse(/on[a-z]+\s*=\s*"?alert/i.test(rendered.html), `${label}: an event handler survived`);
    for (const live of [/javascript:/i, /vbscript:/i, /data:text/i, /mailto:/i, /evil\.example/i, /evil\.com/i, /@evil/i]) {
      // The shell itself carries a mailto: support link; nothing may be added.
      assertEquals(occurrences(rendered.html, live), occurrences(SHELL_TAGS.html, live),
        `${label}: ${live} survived in the HTML`);
      assertEquals(occurrences(rendered.text, live), occurrences(SHELL_TAGS.text, live),
        `${label}: ${live} survived in the plain text`);
    }
    assertFalse(rendered.subject.includes(reason.slice(0, 12)), `${label}: the reason reached the subject`);
  }
});

// ─── TH-02: entities already escaped are shown, not decoded ──────────────────
Deno.test("TH-02 entities a host typed are shown as typed: escaped once more, never decoded into markup", () => {
  const rendered = renderEventUpdatedEmail(input({ reason: "Moved &lt;b&gt;tonight&lt;/b&gt; &#60;i&#62;" }));
  assertStringIncludes(rendered.html, "&amp;lt;b&amp;gt;tonight&amp;lt;/b&amp;gt;");
  assertStringIncludes(rendered.html, "&amp;#60;i&amp;#62;");
  assertFalse(rendered.html.includes("<b>tonight"), "an escaped entity was decoded into a tag");
  assertStringIncludes(rendered.text, "&lt;b&gt;tonight");
});

// ─── TH-03: bidi, zero-width and control characters ──────────────────────────
Deno.test("TH-03 bidi overrides, isolates, zero-width and control characters are removed everywhere", () => {
  const nasty = [0x202e, 0x202d, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c, 0x200b, 0x200c,
    0x200d, 0x2060, 0xfeff, 0x00ad, 0x0000, 0x0007, 0x001b, 0x0085, 0x2028, 0x2029, 0xe0041];
  const reason = `Moved ${nasty.map((code) => ch(code) + "x").join("")} to the hall`;
  const name = `Sunset${ch(0x202e)}snoisseS${ch(0x202c)} Night${ch(0x200b)}`;
  const rendered = renderEventUpdatedEmail(input({ reason, eventName: name, brandName: `Casa${ch(0x2066)} Lenta` }));
  for (const code of nasty) {
    const c = ch(code);
    assertFalse(everything(rendered).includes(c), `U+${code.toString(16).toUpperCase()} survived`);
  }
  assertFalse(rendered.subject.includes(ch(0x202c)), "a pop-directional mark survived in the subject");
});

// ─── TH-04: header injection ─────────────────────────────────────────────────
Deno.test("TH-04 CR, LF and Unicode line breaks never reach the subject, and the reason never does", () => {
  for (const breaker of ["\r\n", "\n", "\r", ch(0x2028), ch(0x0085), "\u000b", "\u000c"]) {
    const subject = eventUpdatedSubject(
      "event",
      `Sunset${breaker}Bcc: everyone@evil.example${breaker}${breaker}<b>body</b>`,
      [{ field: "venue" }],
    );
    assertFalse(/[\r\n\u0085\u2028\u2029\u000b\u000c]/.test(subject), `a line break survived in ${JSON.stringify(subject)}`);
    const rendered = renderEventUpdatedEmail(input({
      eventName: `Sunset${breaker}Bcc: everyone@evil.example`,
      reason: `Moved${breaker}Bcc: everyone@evil.example${breaker}Subject: refund`,
    }));
    assertFalse(/[\r\n]/.test(rendered.subject), "a line break reached the rendered subject");
    assertFalse(rendered.subject.includes("refund"), "the reason reached the subject");
    assertFalse(rendered.text.includes("Subject: refund\n"), "a reason line break reached the plain text");
  }
});

// ─── TH-05: long and many-codepoint reasons ──────────────────────────────────
Deno.test("TH-05 a 200-character reason of combining marks or emoji stays bounded and out of the subject", () => {
  for (const reason of ["e" + "\u0301".repeat(199), "😀".repeat(200), "👩🏽‍💻".repeat(40), "ﷺ".repeat(200)]) {
    const cleaned = sanitiseEditReason(reason);
    assert(cleaned === null || cleaned.length <= 200, "the quoted reason is longer than 200 code units");
    const rendered = renderEventUpdatedEmail(input({ reason }));
    assertEquals(rendered.subject, "Venue changed: Sunset Sessions");
    assert(rendered.html.length < 40_000, "a long reason blew up the document");
  }
});

// ─── TH-06: brand and event names that carry markup ──────────────────────────
Deno.test("TH-06 brand and event names carrying markup are escaped in the HTML and stay text in the subject", () => {
  const rendered = renderEventUpdatedEmail(input({
    eventName: `<img src=x onerror=alert(1)>Night`,
    brandName: `"><script>alert(1)</script>Casa`,
    recipientName: `<a href="https://evil.example">Ada</a>`,
  }));
  for (const tag of tags(rendered.html)) {
    assert(SHELL_TAGS.tags.has(tag), `a name added a <${tag}> element`);
  }
  assertEquals(hrefs(rendered.html), SHELL_TAGS.hrefs, "a name added or changed a link");
  assertStringIncludes(rendered.html, "&lt;img src=x onerror=alert(1)&gt;Night");
  assertStringIncludes(rendered.html, "&quot;&gt;&lt;script&gt;");
  assertEquals(rendered.subject, "Venue changed: <img src=x onerror=alert(1)>Night");
});

// ─── TR-01: Reply-To falls back to support ───────────────────────────────────
Deno.test("TR-01 Reply-To is the brand's address only when it is one plain well-formed address", () => {
  const support = "support@usemingla.com";
  for (const bad of [
    null, undefined, "", "   ", "not-an-email", "a@b", "@example.com", "hello@", 42, {}, ["a@b.co"],
    "hello@casa.example\r\nBcc: all@evil.example", "hello@casa.example\nBcc: x@y.co",
    "hello@casa.example, other@evil.example", "hello@casa.example; other@evil.example",
    "Casa <hello@casa.example>", "\"evil\"@casa.example", "hello@casa.example>",
  ]) {
    assertEquals(eventUpdateReplyTo(bad), support, `${JSON.stringify(bad)} must fall back to support`);
  }
  assertEquals(eventUpdateReplyTo("hello@casalenta.example"), "hello@casalenta.example");
  assertEquals(eventUpdateReplyTo("  hello@casalenta.example  "), "hello@casalenta.example");
});

// ─── TZ-01: times in the listing's zone, with the zone named ─────────────────
Deno.test("TZ-01 Lagos, New York in and out of daylight saving, and Kiritimati print local times and name the zone", () => {
  const cases: Array<[string, string, string, string[]]> = [
    ["Africa/Lagos", "2027-01-15T19:00:00Z", "2027-01-15T22:00:00Z", ["8:00 PM", "Lagos time (GMT+1)"]],
    ["America/New_York", "2027-07-15T23:00:00Z", "2027-07-16T02:00:00Z", ["Thu, 15 Jul 2027", "7:00 PM", "New York time (GMT-4)"]],
    ["America/New_York", "2027-01-15T23:00:00Z", "2027-01-16T02:00:00Z", ["Fri, 15 Jan 2027", "6:00 PM", "New York time (GMT-5)"]],
    ["Pacific/Kiritimati", "2027-01-15T10:00:00Z", "2027-01-15T12:00:00Z", ["Sat, 16 Jan 2027", "12:00 AM", "Kiritimati time (GMT+14)"]],
  ];
  for (const [timezone, s, e, expected] of cases) {
    const rendered = renderEventUpdatedEmail(input({
      timezone,
      changes: [{ field: "dates", old: [{ s: "2027-01-01T19:00:00Z", e: "2027-01-01T22:00:00Z" }], new: [{ s, e }] }],
    }));
    for (const fragment of expected) {
      assertStringIncludes(rendered.text, fragment, `${timezone}: missing "${fragment}" in the text`);
      assertStringIncludes(rendered.html, fragment, `${timezone}: missing "${fragment}" in the HTML`);
    }
    assertEquals(rendered.subject, "Date changed: Sunset Sessions");
  }
});

Deno.test("TZ-02 an unknown or hostile timezone never throws and never prints the raw value as markup", () => {
  for (const timezone of ["Not/AZone", "", null, "<b>UTC</b>", "America/New_York\r\nBcc: x@y.co"]) {
    const rendered = renderEventUpdatedEmail(input({
      timezone,
      changes: [
        { field: "dates", old: [{ s: "2027-01-01T19:00:00Z", e: "2027-01-01T22:00:00Z" }], new: [{ s: "2027-01-02T19:00:00Z", e: "2027-01-02T22:00:00Z" }] },
        { field: "timezone", old: "<b>UTC</b>", new: timezone },
      ],
    }));
    assertFalse(rendered.html.includes("<b>UTC"), "a timezone value became markup");
    assertFalse(/Bcc:/.test(rendered.subject), "a timezone value reached the subject");
  }
});

// ─── TP-01: what a row must never print, even when the row is wrong ──────────
Deno.test("TP-01 a withheld address or venue prints no street even if the row wrongly carries one", () => {
  const rendered = renderEventUpdatedEmail(input({
    changes: [
      { field: "venue", withheld: true, old: "9 Lorimer Street", new: "14 Havemeyer Street" },
      { field: "address", withheld: true, old: "61 Wythe Avenue, Brooklyn", new: "250 Bedford Avenue, Brooklyn" },
    ],
    venueName: "The Bedford Hall",
  }));
  for (const street of ["Lorimer", "Havemeyer", "Wythe", "Bedford Avenue"]) {
    assertFalse(everything(rendered).includes(street), `${street} was printed for a withheld location`);
  }
  assertStringIncludes(rendered.text, "The location has changed. You will find it on the event page.");
});

Deno.test("TP-02 an experience prints no stop name, address or coordinate, whatever the row holds", () => {
  const rendered = renderEventUpdatedEmail(input({
    kind: "experience",
    eventName: "Brooklyn Walk",
    changes: [
      { field: "route", old: "11 Secret Lane, Velvet Cellar", new: "99 Veiled Yard, 40.71001,-73.95001" },
      { field: "stop_times", old: "18:00", new: "20:00" },
      { field: "venue", withheld: true, old: "Velvet Cellar", new: "Moonlit Annex" },
    ],
    venueName: null,
  }));
  for (const secret of ["Secret Lane", "Velvet Cellar", "Veiled Yard", "40.71001", "Moonlit Annex"]) {
    assertFalse(everything(rendered).includes(secret), `${secret} was printed for an experience`);
  }
  assertStringIncludes(rendered.text, "The location or route has changed.");
  assertStringIncludes(rendered.text, "Your booking is still valid.");
  assertEquals(rendered.subject, "Details changed: Brooklyn Walk");
});

Deno.test("TP-03 the online link itself is never printed, even if the row carries it", () => {
  const rendered = renderEventUpdatedEmail(input({
    changes: [{
      field: "online_link",
      old: "https://zoom.example/j/111?pwd=secret",
      new: "https://meet.example/abc-defg-hij",
      old_present: true,
      new_present: true,
    }],
  }));
  assertFalse(/zoom\.example|meet\.example|pwd=secret/.test(everything(rendered)), "an online link was printed");
  assertStringIncludes(rendered.text, "The online link has changed. You will find the new one on the event page.");
});

Deno.test("TP-04 entries this version does not know are never printed; a row of only those is nothing to send", () => {
  const rendered = renderEventUpdatedEmail(input({
    changes: [
      { field: "price", old: "₦5,000", new: "₦50,000" },
      { field: "venue", old: "Old Hall", new: "New Hall" },
    ],
  }));
  assertFalse(everything(rendered).includes("50,000"), "an unknown entry was printed");
  assertThrows(
    () => renderEventUpdatedEmail(input({ changes: [{ field: "price", old: 1, new: 2 }] })),
    Error,
    "event_update_email_nothing_to_say",
  );
  assertThrows(
    () => renderEventUpdatedEmail(input({ changes: [] })),
    Error,
    "event_update_email_nothing_to_say",
  );
});

// ─── TW-01: the worker helpers ───────────────────────────────────────────────
Deno.test("TW-01 only a missing function is 'nothing to do'; a denied or broken call is a failure", async () => {
  for (const missing of [
    { code: "PGRST202", message: "Could not find the function public.event_edit_notice_fanout(p_limit) in the schema cache" },
    { code: "42883", message: "function public.event_edit_notice_fanout(integer) does not exist" },
    { code: null, message: "Could not find the function public.event_edit_notice_fanout" },
  ]) {
    assert(isMissingFunctionError(missing), `${JSON.stringify(missing)} must read as missing`);
  }
  for (const real of [
    null,
    undefined,
    { code: "42501", message: "permission denied for function event_edit_notice_fanout" },
    { code: "57014", message: "canceling statement due to statement timeout" },
    { code: "PGRST301", message: "JWT expired" },
    { code: "P0001", message: "issue_3827: something" },
    { code: "40P01", message: "deadlock detected" },
  ]) {
    assertFalse(isMissingFunctionError(real), `${JSON.stringify(real)} must not read as missing`);
  }

  const answers: Array<[unknown, "ran" | "missing" | "failed"]> = [
    [{ data: { notices: 0, rows: 0 }, error: null }, "ran"],
    [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }, "missing"],
    [{ data: null, error: { code: "42501", message: "permission denied" } }, "failed"],
    [new Error("network down"), "failed"],
  ];
  const quiet = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  try {
    for (const [answer, expected] of answers) {
      const calls: Array<[string, unknown]> = [];
      const admin = {
        rpc(name: string, args?: Record<string, unknown>) {
          calls.push([name, args]);
          return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as never);
        },
        from() {
          throw new Error("the fan-out must not read a table");
        },
      };
      assertEquals(await fanOutEventEditNotices(admin as never), expected);
      assertEquals(calls, [["event_edit_notice_fanout", { p_limit: 20 }]]);
    }
  } finally {
    console.error = quiet;
  }
  for (const line of logged) {
    assertFalse(line.includes("@"), `a fan-out log line carries an address: ${line}`);
  }
});

Deno.test("TW-02 groups of five: never more than five at once, every item processed once, in order of groups", async () => {
  for (const total of [0, 1, 4, 5, 6, 11, 23]) {
    let inFlight = 0;
    let maxInFlight = 0;
    const done: number[] = [];
    await inGroupsOf(Array.from({ length: total }, (_, i) => i), 5, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, item % 3));
      done.push(item);
      inFlight -= 1;
    });
    assert(maxInFlight <= 5, `${total} items: ${maxInFlight} were in flight at once`);
    assertEquals([...done].sort((a, b) => a - b), Array.from({ length: total }, (_, i) => i));
    for (let i = 0; i < done.length; i += 1) {
      assertEquals(Math.floor(done[i] / 5), Math.floor(i / 5), `${total} items: group order was not kept`);
    }
  }
  // A size that is not a positive whole number still makes progress.
  const seen: number[] = [];
  await inGroupsOf([1, 2, 3], 0, async (item) => {
    seen.push(item);
  });
  assertEquals(seen, [1, 2, 3]);
});

Deno.test("TW-03 the per-recipient dispatch: the email carries the notice; the other channels say only that plans changed", () => {
  const dispatch = buildEventUpdateDispatch({
    noticeId: "44444444-4444-4444-8444-444444444444",
    kind: "rsvp",
    eventName: "Sunset\r\nSessions",
    brandName: "Casa Lenta",
    brandContactEmail: "hello@casa.example\r\nBcc: x@evil.example",
    timezone: "Africa/Lagos",
    changes: [{ field: "address", withheld: true }],
    reason: "Moved, pay at https://evil.example/pay",
    venueName: "The Bedford Hall",
    eventUrl: EVENT_URL,
  }, { recipientName: "Ada", recipientEmail: "ada@example.test" });
  assertEquals(dispatch.emailOverride.replyTo, "support@usemingla.com");
  assertFalse(/[\r\n]/.test(dispatch.emailOverride.rendered.subject), "a line break reached the subject");
  for (const line of [dispatch.title, dispatch.body, dispatch.sms]) {
    assertFalse(line.includes("evil.example"), "the reason reached a text, push or in-app line");
    assertFalse(line.includes("ada@example.test"), "the recipient's address reached a text, push or in-app line");
  }
  assertStringIncludes(dispatch.emailOverride.rendered.text, "Your RSVP still stands.");
  assertFalse(dispatch.emailOverride.rendered.text.includes("evil.example"), "the reason's link reached the email");
});
