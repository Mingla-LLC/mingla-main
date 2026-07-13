// ORCH-1365 INC-1 [ambiguous country / US-state collision] — TESTER adversarial
// suite. Attacks the ZERO-RESULT FALLBACK's FAILURE MODES on angles the
// implementor's T-14..T-17 do NOT cover:
//
//   T-14 proves the fallback RECOVERS (biased empty → fallback NON-empty).
//   T-15/T-16 prove NO fallback when the biased call is NON-empty.
//   T-17 proves a BIASED (first-call) 5xx is surfaced, not masked.
//
// NONE of them exercise: (1) an empty result when NO country was stripped — the
// `country &&` half of the guard; (2) BOTH biased and fallback empty (the
// fallback's own empty branch); (3) the FALLBACK call itself erroring (the
// `"errorResponse" in fb` TRUE branch of §12.4). This file attacks exactly those.
//
// Run: deno test --allow-env --allow-read --no-check \
//   supabase/functions/mapbox-geocode/__tests__/orch1365-inc1-fallback-failuremodes.adversarial.test.ts
//
// FAILS-ON-REVERT (tester-verified by true line edit of index.ts, hashes in the
// QA report Step 5):
//   - ADV-INC1-1: change the guard `if (country && first.suggestions.length===0)`
//     → `if (first.suggestions.length===0)` (drop the `country` conjunct) → a
//     no-strip EMPTY query retries pointlessly with the SAME query → 2 calls →
//     the `calls.length===1` assertion → RED. (Different revert than T-15, which
//     drops the length guard.)
//   - ADV-INC1-2 / ADV-INC1-3: remove the whole §12.3 fallback branch → the biased
//     empty result is returned directly with ONE call → the `calls.length===2`
//     assertions → RED (proves the fallback FIRES even when it recovers nothing /
//     when the retry itself errors).
//
// Append-only, NEW file. No existing test modified (no [TEST-MOD-APPROVED] token).
// Registered in the orch-1365 Deno CI job.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

// handler reads MAPBOX_ACCESS_TOKEN at request time — set a deterministic token.
Deno.env.set("MAPBOX_ACCESS_TOKEN", "sk-test-inc1-adversarial-token");

import { handler } from "../index.ts";

const SESSION = "sess-inc1-adv-uuid";

interface StubResponse {
  status?: number;
  body: unknown;
}

/** fetch double that records every upstream URL; restores real fetch after. */
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

// ── ADV-INC1-1 — the `country &&` conjunct: a NO-STRIP empty result must NOT retry ─
// A two-word query whose trailing token is NOT a country ("zephyr zzland") is not
// stripped → parseTrailingCountry returns country=undefined. Even when Mapbox
// returns ZERO results, the fallback MUST NOT fire — retrying the identical query
// (no country was dropped) would be a pointless extra Mapbox call (latency + a
// step toward a loop). The load-bearing invariant: fallback fires IFF a country
// was applied. T-16 only covers a NON-empty no-strip query, so this angle is new.
Deno.test("ADV-INC1-1: no-country-strip EMPTY result → NO retry (exactly ONE call; `country &&` guard load-bearing)", async () => {
  await withStubbedFetch(
    (url) => {
      // The (unbiased) call carries no country param and returns empty.
      assert(!url.includes("&country="), "no-strip query must carry no country bias");
      return { body: { suggestions: [] } };
    },
    async (calls) => {
      const { status, json } = await callSuggestPlaces("zephyr zzland", SESSION);
      assertEquals(status, 200, "graceful 200 on empty");
      assertEquals(json.suggestions, [], "empty result passed through");
      // No country was stripped → the fallback branch is skipped entirely.
      // Fails-on-revert: drop the `country` conjunct → this empty query retries
      // the SAME text → 2 calls → RED.
      assertEquals(calls.length, 1, "no-strip empty → exactly one upstream call, no pointless retry");
    },
  );
});

// ── ADV-INC1-2 — BOTH biased AND fallback empty → graceful terminal 200 empty ────
// "atlanta georgia" strips to country=ge → biased EMPTY → fallback fires with the
// full query → the fallback ALSO returns empty. The handler must return a terminal
// { suggestions: [] } at HTTP 200 (the same "no results" state as an empty biased
// call today) — no throw, no 5xx. T-14 only covers the fallback RECOVERING; this
// exercises the fallback's own empty branch (`fb.suggestions === []`) and proves
// the retry fires exactly once.
Deno.test("ADV-INC1-2: biased empty + fallback empty → graceful 200 {suggestions:[]} via exactly TWO calls (no throw)", async () => {
  await withStubbedFetch(
    () => ({ body: { suggestions: [] } }), // every call empty
    async (calls) => {
      const { status, json } = await callSuggestPlaces("atlanta georgia", SESSION);
      assertEquals(status, 200, "both-empty is a graceful 200, not a 5xx/throw");
      assertEquals(json.suggestions, [], "terminal empty list");
      assertEquals(json.error, undefined, "no error surfaced when both calls are legitimately empty");
      // Fails-on-revert: remove the fallback branch → biased empty returned with
      // ONE call → this assertion → RED (proves the fallback fired).
      assertEquals(calls.length, 2, "biased empty → fallback fires exactly once → two calls");
    },
  );
});

// ── ADV-INC1-3 — the FALLBACK call itself errors (5xx) → swallowed to 200 empty ──
// §12.4: "Fallback also errors ... return { suggestions: [] } (HTTP 200) ... Do
// NOT surface a fresh 5xx from the retry." biased (country=ge) → EMPTY (200);
// fallback (no country) → 502. The handler must return 200 with an empty list —
// NOT propagate the 502. T-17 only covers the BIASED (first-call) error; the
// fallback-error branch (`"errorResponse" in fb` TRUE) is otherwise untested.
Deno.test("ADV-INC1-3: biased empty + FALLBACK 502 → 200 {suggestions:[]}, fresh 5xx NOT surfaced (§12.4)", async () => {
  await withStubbedFetch(
    (url) => {
      if (url.includes("&country=ge")) return { body: { suggestions: [] } }; // biased empty
      return { status: 502, body: { message: "bad gateway on retry" } }; // fallback errors
    },
    async (calls) => {
      const { status, json } = await callSuggestPlaces("atlanta georgia", SESSION);
      // The fresh 5xx from the RETRY must be swallowed to a terminal empty 200.
      assertEquals(status, 200, "fallback 5xx must NOT propagate — terminal 200 empty");
      assertEquals(json.suggestions, [], "fallback error → empty list, not a leaked payload");
      assertEquals(json.error, undefined, "no mapbox_502 surfaced from the retry branch");
      // Fails-on-revert: remove the fallback branch → biased empty returned with
      // ONE call → this assertion → RED.
      assertEquals(calls.length, 2, "biased empty → fallback attempted exactly once → two calls");
    },
  );
});
