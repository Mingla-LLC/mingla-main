// ORCH-0989 [Unified cover picker sheet] — TESTER adversarial regression.
//
// Attacks the NEW Pexels CURATED edge fn on error paths / boundaries /
// invariants that the implementor's happy-path jest test
// (coverProviderBrowseService.test.ts) never exercises:
//
//   A1. auth gate          — missing Bearer => 401 auth_required (SC-16 / T-10)
//   A2. method boundary    — non-POST => 405 method_not_allowed
//   A3. NO-ORIENTATION inv  — the upstream /v1/curated URL MUST NOT carry
//                            `orientation` (the entire reason this fn exists,
//                            vs the search fn which hard-codes landscape) and
//                            MUST NOT carry `query`. This is the LOCKED §6.2
//                            invariant + SC-3 + gate orch-0989 A4.
//   A4. clamp boundary     — perPage:999 / page:-5 => clamped to 20 / 1
//                            (search-fn clamp parity; out-of-range attack)
//   A5. key non-exposure   — not-configured 500 MUST NOT leak the key value
//                            (SC-9 / COMMS-0003 secret handling)
//   A6. empty-body browse  — no JSON body => defaults to page 1, no 400 crash
//                            (gallery-first browse with no query)
//
// Different layer (Deno edge, not jest service mock) AND different angle
// (error/boundary/invariant, not success normalization) than the implementor.
//
// Harness mirrors event-cover-pexels-search/index.test.ts.

import {
  handleEventCoverPexelsCurated,
  normalizeCuratedRequest,
} from "./index.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const originalFetch = globalThis.fetch;

const setEnv = (values: Record<string, string | null>): void => {
  for (const [key, value] of Object.entries(values)) {
    if (value === null) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
};

const restoreTestState = (): void => {
  globalThis.fetch = originalFetch;
  setEnv({
    PEXELS_API_KEY: null,
    SUPABASE_SERVICE_ROLE_KEY: null,
    SUPABASE_URL: null,
  });
};

// Auth-passing fetch that also captures the upstream Pexels curated request.
const authAndCuratedFetch = (
  curatedResponse: Response,
  onCuratedRequest?: (input: RequestInfo | URL, init?: RequestInit) => void,
): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(
        JSON.stringify({
          user: {
            id: "00000000-0000-4000-8000-000000000001",
            aud: "authenticated",
            role: "authenticated",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.startsWith("https://api.pexels.com/v1/curated")) {
      onCuratedRequest?.(input, init);
      return curatedResponse;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

// A4 — clamp boundary on the exported normalizer (out-of-range attack).
Deno.test("A4: curated normalizer clamps out-of-range page/perPage", () => {
  const high = normalizeCuratedRequest({ page: 999, perPage: 999 });
  assert(high.page === 50, `expected page clamped to 50, got ${high.page}`);
  assert(high.perPage === 20, `expected perPage clamped to 20, got ${high.perPage}`);

  const low = normalizeCuratedRequest({ page: -5, perPage: 0 });
  assert(low.page === 1, `expected page clamped to 1, got ${low.page}`);
  assert(low.perPage === 6, `expected perPage clamped to 6, got ${low.perPage}`);

  const empty = normalizeCuratedRequest({});
  assert(empty.page === 1, "expected default page 1");
  assert(empty.perPage === 15, "expected default perPage 15");
});

// A1 — auth gate: missing Bearer must be rejected before any provider work.
Deno.test("A1: curated rejects missing auth with 401 auth_required", async () => {
  restoreTestState();
  const response = await handleEventCoverPexelsCurated(
    new Request("https://edge.test", {
      method: "POST",
      body: JSON.stringify({ page: 1 }),
    }),
  );
  const body = await response.json();
  assert(response.status === 401, `expected 401, got ${response.status}`);
  assert(body.error === "auth_required", `expected auth_required, got ${body.error}`);
});

// A2 — method boundary: GET must be 405 (and must not reach the provider).
Deno.test("A2: curated rejects non-POST with 405 method_not_allowed", async () => {
  restoreTestState();
  const response = await handleEventCoverPexelsCurated(
    new Request("https://edge.test", { method: "GET" }),
  );
  const body = await response.json();
  assert(response.status === 405, `expected 405, got ${response.status}`);
  assert(
    body.error === "method_not_allowed",
    `expected method_not_allowed, got ${body.error}`,
  );
});

// A3 + A6 — NO-ORIENTATION / NO-QUERY invariant + empty-body browse default.
Deno.test(
  "A3+A6: curated upstream URL omits orientation+query; empty body defaults page 1",
  async () => {
    restoreTestState();
    setEnv({
      PEXELS_API_KEY: "server-side-pexels-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-for-auth-check",
      SUPABASE_URL: "https://supabase.test",
    });
    const captured: { url?: URL; authorization?: string | null } = {};
    globalThis.fetch = authAndCuratedFetch(
      new Response(
        JSON.stringify({
          photos: [
            {
              id: 7,
              width: 1600,
              height: 900,
              url: "https://www.pexels.com/photo/7/",
              photographer: "Curated Shooter",
              photographer_url: "https://www.pexels.com/@curated",
              avg_color: "#0a0a0a",
              alt: "a curated cover",
              src: { landscape: "https://images.pexels.com/photos/7/landscape.jpeg" },
            },
          ],
          next_page: "https://api.pexels.com/v1/curated?page=2",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-ratelimit-limit": "200",
            "x-ratelimit-remaining": "150",
            "x-ratelimit-reset": "999",
          },
        },
      ),
      (input, init) => {
        captured.url = new URL(String(input));
        captured.authorization = new Headers(init?.headers).get("Authorization");
      },
    );

    try {
      // No JSON body at all (browse / gallery-first, no query).
      const response = await handleEventCoverPexelsCurated(
        new Request("https://edge.test", {
          method: "POST",
          headers: { Authorization: "Bearer user-access-token" },
        }),
      );
      const body = await response.json();

      assert(response.status === 200, `expected 200, got ${response.status}`);
      if (!(captured.url instanceof URL)) {
        throw new Error("expected a curated provider request");
      }
      const url = captured.url;
      // The LOCKED invariant — curated MUST NOT carry orientation or query.
      assert(
        url.searchParams.get("orientation") === null,
        "INVARIANT VIOLATION: curated upstream URL carries orientation",
      );
      assert(
        url.searchParams.get("query") === null,
        "INVARIANT VIOLATION: curated upstream URL carries query",
      );
      // Empty body => default page 1.
      assert(url.searchParams.get("page") === "1", "expected default page=1");
      assert(url.searchParams.get("per_page") === "15", "expected default per_page=15");
      // Key passed server-side via Authorization header (never client-exposed).
      assert(
        captured.authorization === "server-side-pexels-key",
        "expected server-side Pexels key on Authorization header",
      );
      // Response mapped to the shared shape; non-landscape would be dropped.
      assert(body.photos.length === 1, "expected one curated photo");
      assert(body.photos[0].provider === "pexels", "expected pexels provider");
      assert(body.nextPage === 2, "expected nextPage derived from next_page");
    } finally {
      restoreTestState();
    }
  },
);

// A5 — not-configured 500 must NOT leak the key value in the response body.
Deno.test("A5: curated not-configured 500 never leaks the key value", async () => {
  restoreTestState();
  setEnv({
    PEXELS_API_KEY: null,
    SUPABASE_SERVICE_ROLE_KEY: "service-role-for-auth-check",
    SUPABASE_URL: "https://supabase.test",
  });
  // Auth must pass so we reach the key check; provider must never be hit.
  globalThis.fetch = authAndCuratedFetch(
    new Response("unreachable", { status: 500 }),
  );
  try {
    const response = await handleEventCoverPexelsCurated(
      new Request("https://edge.test", {
        method: "POST",
        headers: { Authorization: "Bearer user-access-token" },
        body: JSON.stringify({ page: 1 }),
      }),
    );
    const body = await response.json();
    assert(response.status === 500, `expected 500, got ${response.status}`);
    assert(
      body.error === "pexels_not_configured",
      `expected pexels_not_configured, got ${body.error}`,
    );
    assert(
      JSON.stringify(body).includes("service-role-for-auth-check") === false,
      "must not leak any secret value in the response body",
    );
  } finally {
    restoreTestState();
  }
});
