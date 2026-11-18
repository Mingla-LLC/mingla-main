// MINGLA-INVARIANT: I-4238-ARI-SOLD-OUT-QUIET | issue #4238 | rework 4: Ari never suggests a budget change or a new video for an ad with no stock left (only accept_last_tickets), and the stop reason Ari reads is the NEWEST pause or end event's, never an older one.
// Issue #4238 rework 4 (retest 4 P3-2, P3-3, P3-4).
//
// FAILS-ON-REVERT: delete `!soldOut &&` from the lower branch -> "sold out" fails;
// make latestStopReason skip events without a reason -> "newest" fails;
// drop created_at from the seed's ledger inserts -> "seed ledger" fails.
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
    planId: "11111111-1111-4111-8111-111111111111",
    planState: "paused",
    nowMs: NOW,
    liveSinceMs: NOW - 8 * DAY,
    lastEditAt: null,
    goal: "sales",
    currency: "USD",
    currentTotalCents: 10_000,
    currentEndsAt: null,
    lastBookableAt: null,
    spendCents: 2000,
    results: 2, // 1000 per ticket: far above 1.5 x the high guide
    resultsLast3Days: 0,
    costPerResult: { midCents: 300, highCents: 375 },
    stock: { remaining: 0, total: 100, unlimited: false },
    walletCents: 10_000,
    lastTicketsOffered: false,
    stopReason: null,
    ...over,
  };
}

Deno.test("sold out with no stop reason recorded: no lower_budget, no new_video", async () => {
  for (const planState of ["paused", "live"]) {
    assertEquals(await hostAdSuggestion(input({ planState })), null);
  }
  // Control: with stock left the same ad is told to lower.
  const withStock = await hostAdSuggestion(
    input({ stock: { remaining: 60, total: 100, unlimited: false } }),
  );
  assertEquals(withStock?.kind, "lower_budget");
});

Deno.test("sold out still offers the last-tickets accept", async () => {
  const s = await hostAdSuggestion(input({ lastTicketsOffered: true }));
  assertEquals(s?.kind, "accept_last_tickets");
});

Deno.test("newest pause/end event decides the stop reason", () => {
  const events = [
    {
      created_at: "2026-11-10T10:00:00Z",
      provider_response: { reason: "sold_out" },
    },
    { created_at: "2026-11-14T10:00:00Z", provider_response: null },
  ];
  assertEquals(latestStopReason(events), null);
  assertEquals(latestStopReason([...events].reverse()), null);
  assertEquals(
    latestStopReason([
      {
        created_at: "2026-11-14T10:00:00Z",
        provider_response: { reason: "event_ended" },
      },
      events[0],
    ]),
    "event_ended",
  );
  assertEquals(latestStopReason([]), null);
});

Deno.test("seed ledger: every ledger insert carries its own created_at", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../../scripts/sites/local/fixtures/host-ads-states.sql",
      import.meta.url,
    ),
  );
  const inserts = sql.split(/INSERT INTO public\.ad_credit_ledger/).slice(1);
  assertEquals(inserts.length, 2);
  for (const part of inserts) {
    assertEquals(/created_at/.test(part.slice(0, part.indexOf(";"))), true);
  }
});
