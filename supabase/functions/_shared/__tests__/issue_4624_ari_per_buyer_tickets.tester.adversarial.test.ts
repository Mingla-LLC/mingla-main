// MINGLA-INVARIANT: I-4624-29 | issue #4624 | A ticket count the host gives per person, per buyer, per customer, per guest, a head or each is never set as a total ticket limit or Total uses: Ari asks how many times each buyer may use the code, whatever limit the model proposed.
//
// #4624 tester retest (P1-1): phrasings the implementor's suite does not use.
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_4624_ari_per_buyer_tickets.tester.adversarial.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkStatedSlots, extractStatedSlots } from "../ariTruthGuards.ts";
import { AGENT_TOOLS } from "../agentTools.ts";

const NOW = new Date("2026-11-27T10:00:00Z");
const tool = AGENT_TOOLS.find((item) => item.name === "create_discount");
if (!tool) throw new Error("create_discount is a tool");
const KEYS = new Set(
  Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties),
);

// No digit in the code name, so no number in the words comes from the code.
const PER_BUYER_TICKET_PHRASES: Array<[string, number]> = [
  ["Make GUESTS 100% off, 2 tickets each", 2],
  ["Make GUESTS 100% off, up to 3 free tickets per buyer", 3],
  ["Make GUESTS 100% off, limit of 4 tickets per customer", 4],
  ["Make GUESTS 100% off, 2 free tickets a head", 2],
  ["Make GUESTS 100% off, no more than five tickets per guest", 5],
  ["Make GUESTS 100% off, 4 tickets per person max", 4],
  ["Make GUESTS 100% off, 20 free tickets, max 2 tickets per person", 2],
];

function proposal(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    brand_id: "22222222-2222-4222-8222-222222222222",
    kind: "code",
    code: "GUESTS",
    value_type: "percent",
    value_bps: 10000,
    ...extra,
  };
}

Deno.test("#4624 tester: tickets per person is a per-buyer question, never a total", () => {
  for (const [words, count] of PER_BUYER_TICKET_PHRASES) {
    const stated = extractStatedSlots([words], NOW);
    assertEquals(stated.per_buyer_tickets, count, words);
    assertEquals(stated.max_total_uses, undefined, words);
    if (!words.includes("20 free tickets")) {
      assertEquals(stated.ends_after_count, undefined, words);
    }
    for (
      const extra of [
        { max_total_uses: count },
        { ends_after_count: count },
        { max_uses_per_buyer: count },
        {},
      ]
    ) {
      const result = checkStatedSlots({
        toolName: "create_discount",
        toolArgs: proposal(extra),
        schemaKeys: KEYS,
        stated,
        timezone: "Africa/Lagos",
      });
      assertEquals(result.kind, "ask", `${words} ${JSON.stringify(extra)}`);
      if (result.kind === "ask") {
        assertEquals(result.missing, ["per_buyer_unit"], words);
      }
    }
  }
});

Deno.test("#4624 tester: free tickets for a number of people is a ticket limit", () => {
  for (
    const [words, count] of [
      ["Make GUESTS 100% off, 10 tickets free", 10],
      ["Make GUESTS 100% off, let the first 10 people in free", 10],
    ] as Array<[string, number]>
  ) {
    const stated = extractStatedSlots([words], NOW);
    assertEquals(stated.ends_after_count, count, words);
    assertEquals(stated.max_total_uses, undefined, words);
    const moved = checkStatedSlots({
      toolName: "create_discount",
      toolArgs: proposal({ max_total_uses: count }),
      schemaKeys: KEYS,
      stated,
      timezone: "Africa/Lagos",
    });
    assertEquals(moved.kind, "ok", words);
    if (moved.kind === "ok") {
      assertEquals(moved.args.ends_after_count, count, words);
      assertEquals("max_total_uses" in moved.args, false, words);
    }
  }
});
