// Issue #3827 — implementor ROUND 4 for the reason link filter, from the
// tester's retest-3 probe (~/.mingla-private/3827/retest3/probe.ts).
//
//   R4-L1 (finding 1) a host ending in a real top-level domain is removed
//         however it is capitalised, with or without a path, port or query
//         ("Bit.Ly/abc", "Wa.Me/123", "Evil.Com/pay", "evil.Com:8080/x",
//         "Evil.Io?x=1", "ftp.evil.Com", "Evil.co.Uk", "Evil.Com" alone);
//         a word after a missing space that is not a top-level domain stays
//         ("Mr.Smith", "Café.Bar", "Lagos.See", "Room 4.Bring").
//   R4-L2 (finding 2) a host right after "-" or "@" is removed.
//   R4-L3 (also asked) U+2024 ONE DOT LEADER and U+FE52 SMALL FULL STOP read as
//         dots; a decomposed accent does not split a host.
//
// FAILS-ON-REVERT: with eventUpdatedEmail.ts at 59d9d496e, R4-L1 (the
// capitalised hosts survive), R4-L2 (look-behind) and R4-L3 (two dot
// look-alikes) fail.
//
// Run: deno test --allow-env --allow-net --allow-read --no-check <this file>

import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.env.set("DENO_TESTING", "1");

const { LINK_REMOVED, sanitiseEditReason } = await import("../eventUpdatedEmail.ts");

const ch = (...codes: number[]): string => String.fromCharCode(...codes);

const removed = (reason: string, leak: string): void => {
  const cleaned = sanitiseEditReason(reason) ?? "";
  assertFalse(cleaned.toLowerCase().includes(leak.toLowerCase()), `"${leak}" survived in: ${cleaned}`);
  assertStringIncludes(cleaned, LINK_REMOVED, `nothing was removed from: ${reason}`);
};

Deno.test("R4-L1 a real top-level domain is a host in any case; a word after a dot is prose", () => {
  for (const [reason, leak] of [
    ["Visit Evil.Com/pay now", "Evil.Com"],
    ["Visit Evil.Com now", "Evil.Com"],
    ["go Bit.Ly/abc", "Bit.Ly"],
    ["go Wa.Me/123", "Wa.Me"],
    ["go T.Co/abc", "T.Co"],
    ["go Linktr.Ee/scam", "Linktr.Ee"],
    ["go evil.Com:8080/x", "evil.Com"],
    ["go Evil.Io?x=1", "Evil.Io"],
    ["go ftp.evil.Com", "evil.Com"],
    ["go Evil.co.Uk", "Evil.co"],
    ["go EVIL.COM", "EVIL"],
  ] as const) {
    removed(reason, leak);
  }
  for (const prose of [
    "Ask for Mr.Smith at the door",
    "Upstairs at Café.Bar tonight",
    "We moved from Lagos.See you there",
    "Meet in Room 4.Bring your ticket",
    "Venue:Lantern Room is the new place",
  ]) {
    assertEquals(sanitiseEditReason(prose), prose);
  }
});

Deno.test("R4-L2 a host straight after a hyphen or an at sign is removed", () => {
  removed("go -evil.com now", "evil.com");
  removed("go @evil.com now", "evil.com");
  removed("pay to--evil.com/pay", "evil.com");
});

Deno.test("R4-L3 every dot look-alike reads as a dot, and an accent does not split a host", () => {
  for (const dot of [0x2024, 0xfe52, 0x3002, 0xff0e, 0xff61]) {
    removed(`go evil${ch(dot)}com now`, "evil");
  }
  const decomposed = `go e${ch(0x0301)}vil.com now`;
  const cleaned = sanitiseEditReason(decomposed) ?? "";
  assertFalse(cleaned.includes("vil"), `part of the host survived: ${cleaned}`);
  assert(cleaned.startsWith("go "), "the sentence around it stays");
});
