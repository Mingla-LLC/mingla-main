// Issue #3827 — tester RETEST 5 for the live-edit buyer email: ".bar" back in
// the top-level domain list with a venue-name exception (02922e693). Through
// the REAL module (`eventUpdatedEmail.ts`), attacking the exception from the
// sides it must not open: a path, port, query or fragment after it, a third
// label before or after it, a scheme or "www.", a spoofed dot, and every
// non-capitalised spelling. Nothing is sent; no network is used.
//
//   B5-01  a ".bar" host with anything after it, or more than two labels, or
//          written lower or upper case, is removed.
//   B5-02  a ".bar" host reached through a spoofed dot (ideographic, leader,
//          zero-width) is judged like the plain one: removed when it has a
//          path.
//   B5-03  a capitalised two-label venue name ("Café.Bar", "The Blue.Bar")
//          survives in the same reason as removed ".bar" hosts.
//
// fails-on-revert: with eventUpdatedEmail.ts at 0c6fdea64 (".bar" out of the
// list) B5-01 and B5-02 fail ("evil.bar/x" survives) and B5-03 fails (the
// lower-case host beside the venue name survives).
//
// Residuals ruled on in the retest-5 report and deliberately NOT pinned: any
// capitalised two-label ".Bar" name with nothing after it survives, including
// "Bar.Bar", "-Evil.Bar", "@Evil.Bar", "EvIl.BaR" and "xn--caf-dma.Bar".
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

const HOSTS = [
  "evil.bar",
  "EVIL.BAR",
  "evil.bar/x",
  "Evil.Bar/x",
  "Evil.Bar/",
  "Evil.Bar:8080",
  "Evil.Bar?ref=1",
  "Evil.Bar#door",
  "Café.Bar.evil.com",
  "Pay.Evil.Bar",
  "www.Evil.Bar",
  "https://Evil.Bar",
  "Evil.BAR",
];

Deno.test("B5-01 a .bar host with a tail, a third label, a scheme or a non-capitalised spelling is removed", () => {
  for (const host of HOSTS) {
    const out = sanitise(`Pay at ${host} tonight`);
    if (out === null || !out.includes(REMOVED) || /evil/i.test(out)) {
      fail(`${JSON.stringify(host)} must be removed, got ${JSON.stringify(out)}`);
    }
  }
});

Deno.test("B5-02 a spoofed dot before .bar is judged like a plain one", () => {
  for (
    const host of [
      `Evil${ch(0x3002)}Bar/x`,
      `Evil${ch(0x2024)}Bar/x`,
      `evil${ch(0xfe52)}bar`,
      `Evil.${ch(0x200b)}Bar/x`,
      `Evil.Bar${ch(0x200b)}/x`,
    ]
  ) {
    const out = sanitise(`Pay at ${host} tonight`);
    if (out === null || !out.includes(REMOVED) || /evil/i.test(out)) {
      fail(`${JSON.stringify(host)} must be removed, got ${JSON.stringify(out)}`);
    }
  }
});

Deno.test("B5-03 a venue name survives beside removed .bar hosts", () => {
  const out = sanitise("Café.Bar and The Blue.Bar are closed, pay at evil.bar/x or Evil.Bar:8080 instead");
  if (out === null) fail("the reason vanished");
  for (const keep of ["Café.Bar", "The Blue.Bar", "are closed"]) {
    if (!out!.includes(keep)) fail(`${keep} must survive, got ${JSON.stringify(out)}`);
  }
  if (/evil/i.test(out!)) fail(`every .bar host must go, got ${JSON.stringify(out)}`);
});
