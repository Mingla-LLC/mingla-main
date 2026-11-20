// #4490 Explorer W1 — tester adversarial: the loopback allowance can never be
// reached on a deployed (production) function, and the QR pepper rule holds
// for every caller shape, including a token read that also carries a JWT.
// FAILS-ON-REVERT: drop the isLocalSupabaseUrl gate in claim-link
// webOriginAllowed and A-1 fails; make passPepperFor return the pepper for a
// token read and A-4 fails.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { webOriginAllowed } from "../index.ts";
import { passPepperFor } from "../../_shared/venueAppHandoff.ts";

const PROD_URLS = [
  "https://gqnoajqerqhnvulmnyvv.supabase.co",
  "https://abc.supabase.co",
  "",
  "not a url",
  // look-alike hosts must not count as local
  "https://kong.evil.example",
  "https://localhost.evil.example",
  "https://127.0.0.1.nip.io",
];
const LOOPBACK_ORIGINS = [
  "http://127.0.0.1:8491",
  "http://localhost:8081",
  "http://localhost:19006",
];

Deno.test("A-1 no loopback origin passes on any non-local SUPABASE_URL", () => {
  for (const url of PROD_URLS) {
    for (const origin of LOOPBACK_ORIGINS) {
      assertEquals(webOriginAllowed(origin, url), false, `${origin} @ ${url}`);
    }
  }
});

Deno.test("A-2 malformed or look-alike origins never pass, even on a local stack", () => {
  const local = "http://kong:8000";
  for (
    const origin of [
      "http://127.0.0.1:8491.evil.example",
      "http://127.0.0.1",
      "https://127.0.0.1:8491",
      "http://127.0.0.1:8491/",
      "http://localhost:8491@evil.example",
      "http://evil.example",
      "null",
      "",
    ]
  ) {
    assertEquals(webOriginAllowed(origin, local), false, origin);
  }
});

Deno.test("A-3 production origins are unchanged everywhere", () => {
  for (const url of [...PROD_URLS, "http://kong:8000"]) {
    assertEquals(webOriginAllowed("https://usemingla.com", url), true);
    assertEquals(webOriginAllowed("https://host.usemingla.com", url), true);
    assertEquals(webOriginAllowed("https://www.usemingla.com", url), false);
  }
});

Deno.test("A-4 app-only: only a signed-in read WITHOUT a token gets the pepper", () => {
  const P = "pepper";
  // switch off: everyone gets it (today)
  assertEquals(passPepperFor(P, false, { userId: null }, "\\xab"), P);
  assertEquals(passPepperFor(P, false, { userId: "u" }, null), P);
  // switch on
  assertEquals(passPepperFor(P, true, { userId: null }, "\\xab"), null);
  assertEquals(passPepperFor(P, true, { userId: "u" }, "\\xab"), null);
  assertEquals(passPepperFor(P, true, { userId: "" }, null), null);
  assertEquals(passPepperFor(P, true, { userId: null }, null), null);
  assertEquals(passPepperFor(P, true, { userId: "u" }, null), P);
  // a missing pepper is never invented
  assertEquals(passPepperFor(null, true, { userId: "u" }, null), null);
});
