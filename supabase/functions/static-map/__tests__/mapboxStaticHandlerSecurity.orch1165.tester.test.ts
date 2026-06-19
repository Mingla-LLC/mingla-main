// ORCH-1165 [Mapbox static map server-proxy] — TESTER adversarial security test.
//
// DIFFERENT ANGLE from the implementor's happy-path test
// (mapboxStatic.orch1165.test.ts), which exercises the PURE helpers
// `validateStaticParams` + `buildMapboxStaticFetchUrl` only. This test drives the
// FULL exported `handler(req)` request path with a STUBBED upstream `fetch`, and
// attacks the SECURITY/stack-hiding invariants the happy-path test never touches:
//
//   1. TOKEN NEVER ECHOED — on EVERY response path (200 success, 400 invalid
//      input, 405 wrong method, 502 upstream exception, upstream non-200), the
//      response body AND headers contain neither the MAPBOX_ACCESS_TOKEN value nor
//      the literal substrings "access_token" / "pk." / "sk.". The proxy must never
//      reflect its server secret to an anonymous caller.
//
//   2. SSRF HOST-PINNING — no matter what the client sends, the ONLY host the
//      handler ever fetches is `api.mapbox.com`, and the outbound URL always
//      carries the server token + logo=false&attribution=false. Injection attempts
//      in `style` (`../`, encoded traversal, absolute URL) are rejected at the 400
//      gate so they never reach `fetch` at all — proving no attacker-controlled
//      host / open-image-fetcher (the proxy can only ever pull a Mapbox tile).
//
//   3. RULE-9 HIDE — when upstream Mapbox returns a non-200 (e.g. 401/422), the
//      handler returns a non-200 (so the client <Image onError> HIDES the map,
//      never a fabricated tile) AND does not leak the upstream body or the token.
//
// FAILS-ON-REVERT (verified by true line-deletion at commit bed4bf1ec):
//   - delete the `if (!ALLOWED_STYLES.has(rawStyle))` style-allowlist guard in
//     validateStaticParams → the SSRF style-injection assertions (a 200 with an
//     attacker style reaching `fetch`) FAIL.
//   - replace the upstream-error branch with a passthrough of the Mapbox body/
//     status → the rule-9 / no-leak assertions FAIL.
//
// Run: deno test --allow-env \
//   supabase/functions/static-map/__tests__/mapboxStaticHandlerSecurity.orch1165.tester.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { handler } from "../index.ts";

// A recognizable fake secret so we can grep every response for its presence.
const FAKE_TOKEN = "pk.eyJTESTER_SECRET_TOKEN_DO_NOT_LEAK_1234567890";
Deno.env.set("MAPBOX_ACCESS_TOKEN", FAKE_TOKEN);

const FN = "https://proj.supabase.co/functions/v1/static-map";

// 1x1 transparent PNG bytes — the "tile" our fetch stub returns on success.
const ONE_PX_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

interface FetchCapture {
  urls: string[];
}

/**
 * Install a fetch stub that records every outbound URL and returns a canned
 * response. Restores the real fetch via the returned disposer. This lets us
 * assert WHAT the handler tried to fetch (SSRF host-pinning) without network.
 */
function stubFetch(
  respond: (url: string) => Response,
): { capture: FetchCapture; restore: () => void } {
  const capture: FetchCapture = { urls: [] };
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    capture.urls.push(url);
    return Promise.resolve(respond(url));
  }) as typeof fetch;
  return { capture, restore: () => (globalThis.fetch = real) };
}

/** Assert a Response leaks NOTHING about the server secret (body + headers). */
async function assertNoSecretLeak(res: Response): Promise<void> {
  const body = await res.clone().text();
  const headerDump = JSON.stringify([...res.headers.entries()]);
  for (const haystack of [body, headerDump]) {
    const lower = haystack.toLowerCase();
    assert(
      !haystack.includes(FAKE_TOKEN),
      `response leaked the literal token: ${haystack.slice(0, 200)}`,
    );
    assert(
      !lower.includes("access_token"),
      `response leaked "access_token": ${haystack.slice(0, 200)}`,
    );
    assert(
      !lower.includes("pk."),
      `response leaked a "pk." token marker: ${haystack.slice(0, 200)}`,
    );
    assert(
      !lower.includes("sk."),
      `response leaked an "sk." token marker: ${haystack.slice(0, 200)}`,
    );
  }
}

Deno.test("ADVERSARIAL: 200 success never echoes the token in body or headers", async () => {
  const { capture, restore } = stubFetch(
    () => new Response(ONE_PX_PNG, { status: 200, headers: { "Content-Type": "image/png" } }),
  );
  try {
    const res = await handler(new Request(`${FN}?lat=38.9&lng=-77.03`));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "image/png");
    await assertNoSecretLeak(res);

    // SSRF host-pinning: exactly one upstream fetch, to api.mapbox.com, carrying
    // the SERVER token + logo/attribution suppression.
    assertEquals(capture.urls.length, 1);
    assertStringIncludes(capture.urls[0], "https://api.mapbox.com/");
    assertStringIncludes(capture.urls[0], "logo=false");
    assertStringIncludes(capture.urls[0], "attribution=false");
    assertStringIncludes(capture.urls[0], "access_token=");
  } finally {
    restore();
  }
});

Deno.test("ADVERSARIAL: 400 invalid-input never reaches fetch and never leaks the token", async () => {
  const { capture, restore } = stubFetch(() => new Response(ONE_PX_PNG));
  try {
    const cases = [
      `${FN}?lat=91&lng=2`, // lat out of range
      `${FN}?lat=1&lng=2&zoom=23`, // zoom out of range
      `${FN}?lat=1&lng=2&accent=zzzzzz`, // bad accent
      `${FN}?lng=2`, // missing lat
    ];
    for (const u of cases) {
      const res = await handler(new Request(u));
      assertEquals(res.status, 400, `expected 400 for ${u}`);
      await assertNoSecretLeak(res);
    }
    // CRITICAL: no invalid request ever triggered an upstream fetch (no open-proxy
    // / no SSRF surface from rejected input).
    assertEquals(capture.urls.length, 0, "rejected input must never hit fetch");
  } finally {
    restore();
  }
});

Deno.test("ADVERSARIAL SSRF: style/coord injection cannot redirect the upstream host", async () => {
  const { capture, restore } = stubFetch(
    () => new Response(ONE_PX_PNG, { status: 200, headers: { "Content-Type": "image/png" } }),
  );
  try {
    // Injection-laden styles must be REJECTED (400) at the allowlist gate — they
    // must NOT compose a fetch URL at all (so no `../`, no foreign host, no SSRF).
    const evilStyles = [
      "../../../etc/passwd",
      "..%2F..%2Fevil",
      "streets-v12/../satellite",
      "https://evil.example.com/x",
      "dark-v11/static/pin", // path smuggling
    ];
    for (const s of evilStyles) {
      const res = await handler(
        new Request(`${FN}?lat=1&lng=2&style=${encodeURIComponent(s)}`),
      );
      assertEquals(res.status, 400, `evil style must 400: ${s}`);
      await assertNoSecretLeak(res);
    }
    assertEquals(capture.urls.length, 0, "evil styles must never reach fetch");

    // And every ACCEPTED request, regardless of extreme-but-valid coords, only
    // ever targets api.mapbox.com (host is hard-coded, never client-derived).
    await handler(new Request(`${FN}?lat=-90&lng=180&style=satellite-v9`));
    await handler(new Request(`${FN}?lat=89.999999&lng=-179.999999`));
    for (const u of capture.urls) {
      assert(
        u.startsWith("https://api.mapbox.com/"),
        `every upstream fetch must be pinned to api.mapbox.com, got: ${u}`,
      );
    }
  } finally {
    restore();
  }
});

Deno.test("ADVERSARIAL rule-9: upstream non-200 → non-200 hide, no body/token leak", async () => {
  // Simulate Mapbox rejecting the token (401) and a bad-request (422). The proxy
  // must surface a non-200 (so the client <Image onError> HIDES the map) and must
  // NOT pass through the Mapbox response body or leak the token.
  for (const upstreamStatus of [401, 422, 500]) {
    const { restore } = stubFetch(
      () =>
        new Response(
          JSON.stringify({ message: `mapbox secret ${FAKE_TOKEN} rejected` }),
          { status: upstreamStatus },
        ),
    );
    try {
      const res = await handler(new Request(`${FN}?lat=38.9&lng=-77.03`));
      assert(res.status !== 200, `upstream ${upstreamStatus} must NOT yield 200`);
      await assertNoSecretLeak(res);
    } finally {
      restore();
    }
  }
});

Deno.test("ADVERSARIAL: upstream fetch exception → 502, no leak (fail-closed)", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error(`boom ${FAKE_TOKEN}`))) as typeof fetch;
  try {
    const res = await handler(new Request(`${FN}?lat=38.9&lng=-77.03`));
    assertEquals(res.status, 502);
    await assertNoSecretLeak(res);
  } finally {
    globalThis.fetch = real;
  }
});

Deno.test("ADVERSARIAL: non-GET method → 405, no fetch, no leak", async () => {
  const { capture, restore } = stubFetch(() => new Response(ONE_PX_PNG));
  try {
    const res = await handler(
      new Request(`${FN}?lat=1&lng=2`, { method: "POST" }),
    );
    assertEquals(res.status, 405);
    await assertNoSecretLeak(res);
    assertEquals(capture.urls.length, 0);
  } finally {
    restore();
  }
});
