// Issue #3827 — tester RETEST 4 for the live-edit buyer email: the round-4
// link filter (c6cabd6ee). Through the REAL module (`eventUpdatedEmail.ts`),
// from angles the implementor's R4-L1..L3 do not take: shortener and chat
// links written the way people type them, a capitalised host with a port or a
// query, hosts glued to punctuation, the leader dots mixed with zero-width
// characters, all inside one reason that also carries prose which must
// survive, and the rendered email read byte by byte. Nothing is sent; no
// network is used.
//
//   K4-01  shortener and chat links in any capitalisation, with a path, a
//          port or a query, are removed.
//   K4-02  a host straight after "-", "@", "(" or a quote is removed; prose
//          beside it ("Café.Bar", "Mr.Smith", "Room 4.Bring", "St.Mary's",
//          "Venue:Lantern Room") survives in the same reason.
//   K4-03  the one-dot leader and the small full stop, alone or next to a
//          zero-width character, read as dots.
//   K4-04  the rendered HTML, text and subject carry none of them and no
//          link the email did not put there itself.
//
// fails-on-revert: with eventUpdatedEmail.ts at 743e56e00 (before
// c6cabd6ee) K4-01 ("Bit.Ly/abc" survives), K4-02 ("-evil.com" survives),
// K4-03 (U+2024 is not a dot) and K4-04 all fail.
//
// Residuals ruled on in the retest-4 report and deliberately NOT pinned:
// lower-case "evil.bar/x" (".bar" left out so "Café.Bar" is prose), a
// Cyrillic letter inside the top-level domain ("evil.сom"), full-width
// letters ("ｅｖｉｌ.ｃｏｍ"), and capitalised prose that ends in a real
// top-level domain ("Jazz.Club", "The.Party") now being removed.
//
// Run: deno test --allow-env --allow-read --no-check <this file>

Deno.env.set("DENO_TESTING", "1");

const email = await import("../eventUpdatedEmail.ts");

const sanitise = email.sanitiseEditReason as (raw: unknown) => string | null;
const REMOVED = email.LINK_REMOVED as string;
const ch = (code: number): string => String.fromCharCode(code);

const fail = (message: string): never => {
  throw new Error(message);
};
const has = (text: string | null, needle: string, why: string): void => {
  if (text === null || !text.includes(needle)) {
    fail(`${why}: expected ${JSON.stringify(needle)} in ${JSON.stringify(text)}`);
  }
};
const lacks = (text: string | null, pattern: RegExp, why: string): void => {
  if (text !== null && pattern.test(text)) {
    fail(`${why}: ${pattern} matched in ${JSON.stringify(text)}`);
  }
};

const LINKS = [
  "Bit.Ly/3xYz",
  "BIT.LY/3xYz",
  "Wa.Me/15550003827",
  "T.Me/lanternroom",
  "Linktr.Ee/lantern",
  "Tinyurl.Com/abc",
  "Evil.Com:8080/pay",
  "Evil.Io?ref=email",
  "Pay.Lantern.Events/now",
];

Deno.test("K4-01 shortener and chat links in any capitalisation, with a path, port or query, are removed", () => {
  for (const link of LINKS) {
    const out = sanitise(`Tickets moved, message us at ${link} for the new door`);
    has(out, REMOVED, `${link} is removed`);
    lacks(out, /Ly\/|Me\/|Ee\/|Com|Io\?|Events\//, `nothing of ${link} is left`);
    has(out, "for the new door", `the prose after ${link} stays`);
  }
});

Deno.test("K4-02 a host glued to punctuation goes; prose beside it in the same reason stays", () => {
  const out = sanitise(
    "Venue:Lantern Room, Café.Bar side door. Mr.Smith in Room 4.Bring ID to St.Mary's " +
      "-evil.com @evil.com (evil.com) \"evil.com\" 'Evil.Com'",
  );
  for (const prose of ["Venue:Lantern Room", "Café.Bar", "Mr.Smith", "Room 4.Bring", "St.Mary's"]) {
    has(out, prose, `${prose} is prose`);
  }
  lacks(out, /evil/i, "every glued host is removed");
});

Deno.test("K4-03 the one-dot leader and small full stop read as dots, with or without zero-width characters", () => {
  const spoofs = [
    `evil${ch(0x2024)}com`,
    `evil${ch(0xfe52)}com`,
    `evil${ch(0x200b)}${ch(0x2024)}com`,
    `evil${ch(0xfe52)}${ch(0x2060)}com/x`,
    `Bit${ch(0x2024)}Ly/abc`,
  ];
  for (const spoof of spoofs) {
    const out = sanitise(`Details at ${spoof} tonight`);
    has(out, REMOVED, `${JSON.stringify(spoof)} is removed`);
    lacks(out, /evil|Bit|Ly\//, `nothing of ${JSON.stringify(spoof)} is left`);
  }
});

Deno.test("K4-04 the rendered email carries none of them and no link it did not put there", () => {
  const render = email.renderEventUpdatedEmail as (input: Record<string, unknown>) => {
    subject: string;
    html: string;
    text: string;
  };
  const eventUrl = "https://usemingla.com/e/casa-lenta/sunset-sessions";
  const rendered = render({
    kind: "event",
    eventName: "Sunset Sessions",
    brandName: "Casa Lenta",
    recipientName: "Ada",
    reason: `Café.Bar is closed. Message Wa.Me/15550003827 or see Bit${ch(0x2024)}Ly/abc and -evil.com`,
    changes: [{ field: "venue", old: "Waterside", new: "The Deck" }],
    timezone: "Africa/Lagos",
    eventUrl,
  });
  for (const part of [rendered.html, rendered.text, rendered.subject]) {
    lacks(part, /evil|Wa\.Me|Bit.Ly/i, "no smuggled host reaches the email");
  }
  has(rendered.text, "Café.Bar is closed.", "the prose reaches the plain text");
  // Every href in the HTML is one the email itself owns.
  const hrefs = Array.from(rendered.html.matchAll(/href="([^"]*)"/g), (m) => m[1]);
  for (const href of hrefs) {
    if (!/^(https:\/\/usemingla\.com|mailto:|https:\/\/[a-z0-9.-]*mingla)/i.test(href.replace(/&amp;/g, "&"))) {
      fail(`unexpected link in the email: ${href}`);
    }
  }
});
