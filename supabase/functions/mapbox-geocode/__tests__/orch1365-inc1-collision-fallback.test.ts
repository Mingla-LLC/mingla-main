// ORCH-1365-INC-1 [ambiguous country / US-state collision] — implementor-owned
// regression suite (SPEC §12.6, T-14..T-17). Drives the EXPORTED `handler` with a
// stubbed `globalThis.fetch` + `Deno.env` so the tests exercise the actual
// zero-result fallback wiring inside `handleSuggestPlaces` (not just the pure URL
// builder). Run: deno test --allow-env --allow-read --no-check \
//   supabase/functions/mapbox-geocode/__tests__/orch1365-inc1-collision-fallback.test.ts
//
// WHAT INC-1 FIXES — `parseTrailingCountry` is a blunt English country-name map,
// so "atlanta georgia" over-strips to country=ge (Georgia the COUNTRY) and the
// biased Mapbox call returns EMPTY (Atlanta is not in Georgia the country —
// evidence R1-a). The strip is UNCHANGED (the tester's ADV-A1 rows stay green);
// it is RECOVERED at the handler layer: iff a `country` was applied AND the biased
// call is HTTP-ok with zero mapped suggestions, retry ONCE with the FULL original
// query (no strip, no country), reusing the session_token (Mapbox bills one
// session → no new billing surface). Non-empty biased calls (lekki nigeria,
// single tokens, non-stripped queries, the genuine tbilisi-Georgia country
// intent) never fall back → EXACTLY one upstream call.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - T-14: remove the §12.3 fallback branch → "atlanta georgia" returns the
//     empty biased result → suggestions[0] is undefined → RED (encodes SC-11).
//   - T-15: drop the `first.suggestions.length === 0` guard (retry
//     unconditionally) → "lekki nigeria" makes 2 upstream calls → the
//     exactly-one-call assertion → RED (encodes SC-12; guards latency + billing).
//
// Append-only, NEW file. Registered in the orch-1365 Deno CI job. No existing
// test modified (no [TEST-MOD-APPROVED] token needed).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

// The handler reads MAPBOX_ACCESS_TOKEN from the environment; set a deterministic
// test token before importing the module under test.
Deno.env.set("MAPBOX_ACCESS_TOKEN", "sk-test-inc1-token");

import { handler } from "../index.ts";

const SESSION = "sess-inc1-uuid";

interface StubResponse {
  status?: number;
  body: unknown;
}

/**
 * Install a `globalThis.fetch` double that records every upstream URL and returns
 * a JSON Response chosen by `match(url)`. Restores the real fetch in `finally`.
 * Returns the ordered list of captured URLs to `run`.
 */
async function withStubbedFetch(
  match: (url: string) => StubResponse,
  run: (calls: string[]) => Promise<void>,
): Promise<void> {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    calls.push(url);
    const { status = 200, body } = match(url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** Drive the exported handler for a consumer `suggest_places` request. */
async function callSuggestPlaces(
  query: string,
  sessionToken: string,
): Promise<{
  status: number;
  json: { suggestions?: Array<{ displayName: string }>; error?: string };
}> {
  const res = await handler(
    new Request("https://edge.local/functions/v1/mapbox-geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "suggest_places",
        query,
        session_token: sessionToken,
      }),
    }),
  );
  const json = await res.json() as {
    suggestions?: Array<{ displayName: string }>;
    error?: string;
  };
  return { status: res.status, json };
}

// ── T-14 — "atlanta georgia" → biased empty → FULL-query fallback (SC-11) ──────
Deno.test("T-14: 'atlanta georgia' falls back to the full query → Atlanta #1 (2 calls, same session_token)", async () => {
  await withStubbedFetch(
    (url) => {
      // Biased first call — strip → q=atlanta & country=ge → EMPTY (evidence R1-a).
      if (url.includes("&country=ge")) return { body: { suggestions: [] } };
      // Fallback — FULL query "atlanta georgia", NO country (evidence R1-b).
      return {
        body: {
          suggestions: [
            {
              mapbox_id: "dXJuOm1ieHBsYzphdGxhbnRh",
              name: "Atlanta",
              place_formatted: "Georgia, United States",
            },
          ],
        },
      };
    },
    async (calls) => {
      const { status, json } = await callSuggestPlaces("atlanta georgia", SESSION);
      assertEquals(status, 200);
      assert(json.suggestions, "suggestions present");
      // The fallback recovered the real place (fails-on-revert: remove the
      // fallback → biased empty returned → suggestions[0] undefined → RED).
      assertEquals(json.suggestions[0]?.displayName, "Atlanta");

      // EXACTLY two upstream calls: biased (empty) then the full-query fallback.
      assertEquals(calls.length, 2, "biased call + one fallback call");
      // call[0] is the biased strip call (country=ge).
      assert(calls[0].includes("&country=ge"), "call[0] carries the country bias");
      // call[1] is the fallback: FULL query, NO country.
      assert(
        !calls[1].includes("&country="),
        "call[1] (fallback) drops the country bias",
      );
      assert(
        calls[1].includes("q=atlanta%20georgia"),
        "call[1] retries the FULL original query, not the stripped one",
      );
      // SESSION-BILLING: both /suggest calls reuse the SAME session_token → Mapbox
      // bills ONE session (SPEC §12.8; no new billing surface).
      assert(
        calls[0].includes(`session_token=${SESSION}`),
        "call[0] uses the request session_token",
      );
      assert(
        calls[1].includes(`session_token=${SESSION}`),
        "call[1] REUSES the same session_token (one billable session)",
      );
    },
  );
});

// ── T-15 — "lekki nigeria" → biased NON-empty → NO fallback, exactly 1 call ────
Deno.test("T-15: 'lekki nigeria' does NOT fall back → Lekki Phase 2 #1 via exactly ONE call (SC-12)", async () => {
  await withStubbedFetch(
    (url) => {
      // Biased call — q=lekki & country=ng → non-empty (evidence R2-a).
      assert(url.includes("&country=ng"), "the only call must be the country-biased one");
      return {
        body: {
          suggestions: [
            {
              mapbox_id: "dXJuOm1ieHBsYzpsZWtraTI",
              name: "Lekki Phase 2",
              place_formatted: "Lagos, Lagos, Nigeria",
            },
            {
              mapbox_id: "dXJuOm1ieHBsYzpsZWtraTE",
              name: "Lekki Phase 1",
              place_formatted: "Lagos, Lagos, Nigeria",
            },
          ],
        },
      };
    },
    async (calls) => {
      const { status, json } = await callSuggestPlaces("lekki nigeria", SESSION);
      assertEquals(status, 200);
      assertEquals(json.suggestions?.[0]?.displayName, "Lekki Phase 2");
      // The load-bearing guard: a non-empty biased call NEVER triggers the retry.
      // Fails-on-revert: drop the `first.suggestions.length === 0` guard (retry
      // unconditionally) → 2 calls → this assertion RED (guards latency+billing).
      assertEquals(calls.length, 1, "non-empty biased call → NO fallback (one call)");
    },
  );
});

// ── T-16 — non-stripped single-call + genuine-country (tbilisi georgia) no FB ──
Deno.test("T-16: 'lekki' (no strip) and 'tbilisi georgia' (genuine country) each make EXACTLY one call (SC-13)", async () => {
  // 'lekki' — single token, no country parsed → one call, no fallback path.
  await withStubbedFetch(
    (url) => {
      assert(
        !url.includes("&country="),
        "single-token 'lekki' has no country bias",
      );
      return {
        body: {
          suggestions: [
            { mapbox_id: "id-lekki", name: "Lekki Phase 2", place_formatted: "Lagos, Nigeria" },
          ],
        },
      };
    },
    async (calls) => {
      const { status, json } = await callSuggestPlaces("lekki", SESSION);
      assertEquals(status, 200);
      assertEquals(json.suggestions?.[0]?.displayName, "Lekki Phase 2");
      assertEquals(calls.length, 1, "'lekki' makes exactly one upstream call");
    },
  );

  // 'tbilisi georgia' — strips to country=ge, but the biased call is NON-empty
  // (the user genuinely means Georgia the COUNTRY, evidence R5-tbilisi) → the
  // fallback must NOT fire, so the country intent is preserved with one call.
  await withStubbedFetch(
    (url) => {
      assert(url.includes("&country=ge"), "the only call must be the country-biased one");
      return {
        body: {
          suggestions: [
            { mapbox_id: "id-tbilisi", name: "Tbilisi", place_formatted: "Georgia" },
          ],
        },
      };
    },
    async (calls) => {
      const { status, json } = await callSuggestPlaces("tbilisi georgia", SESSION);
      assertEquals(status, 200);
      assertEquals(json.suggestions?.[0]?.displayName, "Tbilisi");
      assertEquals(
        calls.length,
        1,
        "non-empty biased call for the genuine-country query → one call, no fallback",
      );
    },
  );
});

// ── T-17 — biased NON-OK (5xx) is returned as an error, NOT masked by a fallback ─
Deno.test("T-17: a biased non-OK (502) is surfaced as an error — no fallback, no silent empty (SPEC §12.4)", async () => {
  await withStubbedFetch(
    (url) => {
      // Biased strip call fails upstream with 502.
      if (url.includes("&country=ge")) {
        return { status: 502, body: { message: "bad gateway" } };
      }
      // If a fallback ever fired (it must NOT), it would look like a success —
      // this branch exists only to make an erroneous fallback observable.
      return {
        body: {
          suggestions: [
            { mapbox_id: "should-not-appear", name: "ShouldNotAppear", place_formatted: "x" },
          ],
        },
      };
    },
    async (calls) => {
      const { status, json } = await callSuggestPlaces("atlanta georgia", SESSION);
      // The transport error is preserved (mapbox_502), never masked as 200-empty.
      assertEquals(status, 502);
      assertEquals(json.error, "mapbox_502");
      assertEquals(calls.length, 1, "a non-OK biased call does NOT trigger a fallback");
      // The fallback fixture must never have leaked into the response.
      assert(
        !(json.suggestions ?? []).some((s) => s.displayName === "ShouldNotAppear"),
        "error branch must not fall back to a success payload",
      );
    },
  );
});
