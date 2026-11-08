// ORCH-1165 [static map server-proxy] — client builder regression test
// (implementor-owned happy-path; Deno-runnable — staticMapProxyUrl.ts is pure,
// no expo-constants in its chain). Provider behind the proxy: Google (#4334).
//
// Proves the CLIENT builder emits a key-less, provider-neutral PROXY URL:
//  - the URL points at `<functionsBaseUrl>/static-map`, never a provider host
//    (maps.googleapis.com) and never carries a key;
//  - coords are forwarded; the accent is normalized; rule-9 null fail-safe holds
//    (missing coords OR missing base → null → caller hides the map).
//
// FAILS-ON-REVERT:
//  - delete the `?${query}` composition / repoint at a provider host → the
//    provider-neutral path assertions FAIL;
//  - delete the coord/base null guards → the rule-9 failsafe assertions FAIL.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildProxyStaticMapUrl } from "../staticMapProxyUrl.ts";

const BASE = "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1";

Deno.test("ORCH-1165: client builder emits a token-less, vendor-neutral proxy URL", () => {
  const url = buildProxyStaticMapUrl(
    { lat: 35.79, lng: -78.74, accentHex: "#eb7825", height: 180 },
    BASE,
  );
  assert(url !== null);
  const u = url as string;

  // Points at the provider-neutral proxy edge fn, never a provider host.
  assertStringIncludes(u, `${BASE}/static-map?`);
  assert(!u.includes("googleapis.com"), "must NOT contain the Google host");
  // No key of any kind in the client URL.
  assert(!u.includes("key="), "must NOT contain a key");
  assert(!u.includes("AIza"), "must NOT contain a Google key");

  // Coords forwarded; accent normalized ('#' stripped, lowercased).
  assertStringIncludes(u, "lat=35.79");
  assertStringIncludes(u, "lng=-78.74");
  assertStringIncludes(u, "accent=eb7825");
  assertStringIncludes(u, "h=180");
});

Deno.test("ORCH-1165: invalid accent falls back to default pin (never breaks URL)", () => {
  const u = buildProxyStaticMapUrl(
    { lat: 1, lng: 2, accentHex: "not-a-hex" },
    BASE,
  ) as string;
  assertStringIncludes(u, "accent=eb7825");
});

Deno.test("ORCH-1165 rule-9: null when coords missing/non-finite OR base absent", () => {
  // missing / non-finite coords → null (caller hides map)
  assertEquals(buildProxyStaticMapUrl({ lat: null, lng: 2 }, BASE), null);
  assertEquals(buildProxyStaticMapUrl({ lat: 1, lng: undefined }, BASE), null);
  assertEquals(buildProxyStaticMapUrl({ lat: Number.NaN, lng: 2 }, BASE), null);
  // missing functions base URL → null (e.g. SUPABASE_URL unset)
  assertEquals(buildProxyStaticMapUrl({ lat: 1, lng: 2 }, null), null);
  assertEquals(buildProxyStaticMapUrl({ lat: 1, lng: 2 }, ""), null);
});

Deno.test("ORCH-1165: trailing slash on base never double-slashes the path", () => {
  const u = buildProxyStaticMapUrl({ lat: 1, lng: 2 }, `${BASE}/`) as string;
  assertStringIncludes(u, `${BASE}/static-map?`);
  assert(!u.includes("//static-map"), "no double slash before the fn path");
});
