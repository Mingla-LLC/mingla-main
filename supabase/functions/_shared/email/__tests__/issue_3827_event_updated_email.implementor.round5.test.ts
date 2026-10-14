// Issue #3827 — implementor ROUND 5 for the reason link filter, from the
// tester's retest-4 note on ".bar".
//
//   R5-L1 a ".bar" host is removed when it is written all lower case or all
//         upper case, has more than two labels, or is followed by a path,
//         port or query ("evil.bar", "evil.bar/x", "Evil.Bar/x",
//         "Evil.Bar:8080", "ftp.Evil.Bar", "EVIL.BAR").
//   R5-L2 a capitalised venue name with nothing after it stays ("Café.Bar",
//         "Jazz.Bar tonight"), and the round-4 prose cases are unchanged.
//
// FAILS-ON-REVERT: with eventUpdatedEmail.ts at 549aa5787 (".bar" not a
// known ending), R5-L1 fails.
//
// Run: deno test --allow-env --allow-net --allow-read --no-check <this file>

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.env.set("DENO_TESTING", "1");

const { LINK_REMOVED, sanitiseEditReason } = await import("../eventUpdatedEmail.ts");

Deno.test("R5-L1: a .bar host is removed unless it reads as a capitalised venue name", () => {
  for (const host of ["evil.bar", "evil.bar/x", "Evil.Bar/x", "Evil.Bar:8080", "ftp.Evil.Bar", "EVIL.BAR", "evil.bar?x=1"]) {
    const out = sanitiseEditReason(`Doors moved, see ${host} for more`) ?? "";
    assertStringIncludes(out, LINK_REMOVED, host);
    assertEquals(out.toLowerCase().includes(".bar"), false, host);
  }
});

Deno.test("R5-L2: a capitalised venue name with nothing after it stays", () => {
  for (const prose of ["Upstairs at Café.Bar tonight", "Moved to Jazz.Bar tonight", "Ask Mr.Smith at the door"]) {
    assertEquals(sanitiseEditReason(prose), prose);
  }
});
