// Issue #4238 tester native leg (adversarial, different angle from rework 4's
// implementor test): the sold-out quiet rule must key on REAL stock only, and
// latestStopReason must not let a bad timestamp or a non-string reason win.
//
// FAILS-ON-REVERT: replace `stockLeft !== null && stockLeft <= 0` with
// `stockLeft === 0` -> "oversold" fails; make soldOut also true for
// unlimited stock -> "unlimited" fails; in latestStopReason, give an
// unparseable created_at a real time (e.g. Date.now()) -> "bad timestamp" fails.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hostAdSuggestion,
  type HostAdSuggestionInput,
  latestStopReason,
} from "../adSuggestion.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-16T12:00:00Z");

function input(
  over: Partial<HostAdSuggestionInput> = {},
): HostAdSuggestionInput {
  return {
    planId: "22222222-2222-4222-8222-222222222222",
    planState: "live",
    nowMs: NOW,
    liveSinceMs: NOW - 9 * DAY,
    lastEditAt: null,
    goal: "sales",
    currency: "USD",
    currentTotalCents: 10_000,
    currentEndsAt: null,
    lastBookableAt: null,
    spendCents: 3000,
    results: 3, // 1000 per ticket, far above the high guide
    resultsLast3Days: 0,
    costPerResult: { midCents: 300, highCents: 375 },
    stock: { remaining: 40, total: 100, unlimited: false },
    walletCents: 10_000,
    lastTicketsOffered: false,
    stopReason: null,
    ...over,
  };
}

Deno.test("oversold (negative stock left) is sold out: Ari stays quiet", async () => {
  const s = await hostAdSuggestion(
    input({ stock: { remaining: -3, total: 100, unlimited: false } }),
  );
  assertEquals(s, null);
});

Deno.test("unlimited stock with remaining 0 is NOT sold out: Ari still advises", async () => {
  const s = await hostAdSuggestion(
    input({ stock: { remaining: 0, total: null, unlimited: true } }),
  );
  assertEquals(s?.kind, "lower_budget");
});

Deno.test("unknown stock (null) is not sold out: a stalled ad still gets new_video", async () => {
  const s = await hostAdSuggestion(
    input({ stock: null, costPerResult: null }),
  );
  assertEquals(s?.kind, "new_video");
});

Deno.test("bad timestamp never beats a real newer event; non-string reason is no reason", () => {
  assertEquals(
    latestStopReason([
      { created_at: "not-a-date", provider_response: { reason: "sold_out" } },
      {
        created_at: "2026-11-14T10:00:00Z",
        provider_response: { reason: "manual" },
      },
    ]),
    "manual",
  );
  assertEquals(
    latestStopReason([
      {
        created_at: "2026-11-14T10:00:00Z",
        provider_response: { reason: "manual" },
      },
      { created_at: undefined, provider_response: { reason: "sold_out" } },
    ]),
    "manual",
  );
  assertEquals(
    latestStopReason([
      { created_at: "2026-11-15T10:00:00Z", provider_response: { reason: 42 } },
      {
        created_at: "2026-11-10T10:00:00Z",
        provider_response: { reason: "sold_out" },
      },
    ]),
    null,
  );
});
