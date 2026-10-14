// Issue #3827 — tester RETEST 3 for the live-edit buyer email: the round-3
// link filter (59d9d496e, finding D4). Through the REAL module
// (`eventUpdatedEmail.ts`), from angles the implementor's H-07 and H-08 do
// not take: prose and a link in the SAME reason, every case spelling of a
// real top-level domain, and dot spoofs a host can type (full-width,
// ideographic and halfwidth-ideographic stops, a trailing dot, a zero-width
// space or joiner beside the dot, `//` with no scheme, punycode on either
// side), with an emoji family in the same reason that must survive whole.
// Nothing is sent; no network is used.
//
//   L3-01  prose with no space after a colon or full stop survives next to a
//          link that is removed, in one reason.
//   L3-02  a real top-level domain in lower, upper or mixed lower/upper case
//          is removed; a capitalised word after a dot stays.
//   L3-03  dot spoofs are removed; a zero-width joiner inside an emoji family
//          is kept, so the family still reads as one character.
//   L3-04  the rendered email (HTML, text and subject) carries none of the
//          spoofed hosts and still carries the prose.
//
// fails-on-revert: with eventUpdatedEmail.ts at 528396ba1 (before 59d9d496e)
// L3-01 ("Venue:Lantern Room" is cut), L3-02 ("Mr.Smith" is cut), L3-03
// (full-width and ideographic stops pass, the emoji family loses its joiners)
// and L3-04 all fail.
//
// Known gaps, reported on the issue and deliberately NOT pinned here (a
// pinned gap would have to be edited when it is fixed): a capitalised
// top-level domain followed by a path ("Bit.Ly/abc", "Evil.Com/pay",
// "evil.Com:8080/x"), a host after a hyphen or an at sign ("-evil.com",
// "@evil.com"), three-label hosts ending in a capitalised label
// ("ftp.evil.Com"), and the one-dot leader and small full stop (U+2024,
// U+FE52).
//
// Run: deno test --allow-env --allow-read --no-check <this file>

Deno.env.set("DENO_TESTING", "1");

const email = await import("../eventUpdatedEmail.ts");

const sanitise = email.sanitiseEditReason as (raw: unknown) => string | null;
const REMOVED = email.LINK_REMOVED as string;
const ch = (code: number): string => String.fromCharCode(code);
const FAMILY = `\u{1F468}${ch(0x200d)}\u{1F469}${ch(0x200d)}\u{1F467}`;

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

Deno.test("L3-01 prose with no space after a colon or full stop survives beside a removed link", () => {
  const out = sanitise(
    "Venue:Lantern Room. Re:Venue the side door is open, Time:7pm, see evil.com/pay for the map",
  );
  has(out, "Venue:Lantern Room", "a label and colon is prose");
  has(out, "Re:Venue", "Re: with no space is prose");
  has(out, "Time:7pm", "Time: with no space is prose");
  has(out, REMOVED, "the link in the same reason is removed");
  lacks(out, /evil|\/pay/i, "nothing of the link is left");
});

Deno.test("L3-02 a real top-level domain in any all-lower or all-upper spelling goes; a capitalised word stays", () => {
  const out = sanitise(
    "Mr.Smith moved us. Booking at EVIL.COM or evil.COM or Evil.co.UK, not at Café.Bar or Lagos.See",
  );
  has(out, "Mr.Smith", "a name after a full stop is prose");
  has(out, "Café.Bar", "a capitalised word after a full stop is prose");
  has(out, "Lagos.See", "a capitalised word after a full stop is prose");
  lacks(out, /EVIL\.COM|evil\.COM|Evil\.co\.UK/, "a real domain in a case that ends all-lower or all-upper is removed");
});

Deno.test("L3-03 dot spoofs are removed; an emoji family keeps its joiners", () => {
  const spoofs = [
    `evil${ch(0x3002)}com`, // ideographic full stop
    `evil${ch(0xff0e)}com`, // full-width full stop
    `evil${ch(0xff61)}com`, // halfwidth ideographic full stop
    "evil.com.", // trailing dot
    `evil.${ch(0x200b)}com`, // zero-width space after the dot
    `evil${ch(0x200d)}.com`, // zero-width joiner before the dot
    "//evil.com/x", // no scheme
    "xn--80ak6aa92e.com", // punycode label
    "evil.xn--p1ai", // punycode top-level domain
    "HTTPS://EVIL.EXAMPLE", // scheme in capitals
  ];
  for (const spoof of spoofs) {
    const out = sanitise(`We moved ${FAMILY} details at ${spoof} tonight`);
    has(out, REMOVED, `spoof ${JSON.stringify(spoof)} is removed`);
    lacks(out, /evil|80ak6aa92e|p1ai/i, `nothing of ${JSON.stringify(spoof)} is left`);
    has(out, FAMILY, `the emoji family next to ${JSON.stringify(spoof)} keeps its joiners`);
  }
});

Deno.test("L3-04 the rendered email carries none of the spoofed hosts and keeps the prose", () => {
  const render = email.renderEventUpdatedEmail as (input: Record<string, unknown>) => {
    subject: string;
    html: string;
    text: string;
  };
  const reason = `Venue:Lantern Room. Mr.Smith says book at evil${ch(0x3002)}com or EVIL.COM ${FAMILY}`;
  const rendered = render({
    kind: "event",
    eventName: "Sunset Sessions",
    brandName: "Casa Lenta",
    recipientName: "Ada",
    reason,
    changes: [{ field: "venue", old: "Waterside", new: "The Deck" }],
    timezone: "Africa/Lagos",
    eventUrl: "https://usemingla.com/e/casa-lenta/sunset-sessions",

  });
  for (const part of [rendered.html, rendered.text, rendered.subject]) {
    lacks(part, /evil/i, "no spoofed host reaches the email");
  }
  has(rendered.text, "Venue:Lantern Room", "the prose reaches the plain text");
  has(rendered.text, "Mr.Smith", "the name reaches the plain text");
});
