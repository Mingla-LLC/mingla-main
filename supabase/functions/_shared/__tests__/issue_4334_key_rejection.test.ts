// #4334 F-6 — one meaning for "Google rejected our key", everywhere: the
// server geocode, the static map and the health probes (the proxy and the
// refresh job are proven in their own suites, C-13 and T-8b).
//
// Fails on revert: drop the 400 branch of classifyPlacesFailure /
// googleProbeErrorCode, or the text check in isApiKeyRejectionText.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("GOOGLE_MAPS_API_KEY", "test-google-key-not-real");
Deno.env.delete("SUPABASE_URL");
Deno.env.delete("SENTRY_DSN");

import { isApiKeyRejection, isApiKeyRejectionText } from "../googleKeyRejection.ts";
import { __clearForwardGeocodeCacheForTests, classifyPlacesFailure, forwardGeocodeLookup } from "../placesGeocode.ts";
import { googleProbeErrorCode } from "../../api-health-probe/logic.ts";

const KEY_INVALID = JSON.parse(JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" }] } }));

Deno.test("K-1 the ErrorInfo reason and the message both mark a rejected key; a plain 400 does not", () => {
  assertEquals(isApiKeyRejection(KEY_INVALID), true);
  assertEquals(isApiKeyRejection({ error: { message: "API key expired. Please renew the API key.", status: "INVALID_ARGUMENT" } }), true);
  assertEquals(isApiKeyRejection({ error: { message: "Invalid value at 'input'", status: "INVALID_ARGUMENT" } }), false);
  assertEquals(isApiKeyRejection(null), false);
  assertEquals(classifyPlacesFailure(400, KEY_INVALID), { code: "provider_denied", httpStatus: 502 });
  assertEquals(classifyPlacesFailure(400, {}), { code: "provider_invalid_request", httpStatus: 400 });
});

Deno.test("K-2 Static Maps' plain-text key rejection is recognised", () => {
  assertEquals(isApiKeyRejectionText("The Google Maps Platform server rejected your request. The provided API key is invalid."), true);
  assertEquals(isApiKeyRejectionText("Bad size parameter"), false);
});

Deno.test("K-3 probes report provider_denied for every key-rejection shape", () => {
  assertEquals(googleProbeErrorCode(400, KEY_INVALID), "provider_denied");
  assertEquals(googleProbeErrorCode(403, null), "provider_denied");
  assertEquals(googleProbeErrorCode(200, { status: "REQUEST_DENIED" }), "provider_denied");
  assertEquals(googleProbeErrorCode(429, null), "provider_quota");
  assertEquals(googleProbeErrorCode(400, {}), "provider_invalid_request");
  assertEquals(googleProbeErrorCode(200, { status: "OK" }), null);
});

Deno.test("K-4 server geocode: a 400 key rejection is a failure, never 'not found'", async () => {
  __clearForwardGeocodeCacheForTests();
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" }] } }), { status: 400 }))) as typeof fetch;
  try {
    assertEquals(await forwardGeocodeLookup("Lekki, Lagos"), { status: "failed" });
  } finally {
    globalThis.fetch = original;
  }
});
