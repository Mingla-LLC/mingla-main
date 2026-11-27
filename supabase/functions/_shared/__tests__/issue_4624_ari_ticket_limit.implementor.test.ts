// MINGLA-INVARIANT: I-4624-25 | issue #4624 | Ari reads "N free tickets", "only/first/up to N tickets" and "N tickets max" as a ticket limit (ends_after_count), keeps "N uses", "N times" and "N people can use it" as Total uses (max_total_uses), and asks whether a bare "limit it to N" counts tickets or checkouts.
//
// #4624 follow-up 1: ticket-capped codes shipped in #4632, but Ari's stated-
// slot guard read "only / first / up to N tickets" as Total uses
// (max_total_uses) and its intent read had no field for a ticket count, so a
// proposal with the right ticket limit was bounced with "a limit of 5 uses".
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_4624_ari_ticket_limit.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  checkStatedSlots,
  extractStatedSlots,
  mergeModelStatedSlots,
  preserveStatedSlots,
  statedSlotsAskedBefore,
} from "../ariTruthGuards.ts";
import {
  ARI_INTENT_READ_SCHEMA,
  ARI_INTENT_READ_SYSTEM_PROMPT,
  parseAriIntentRead,
} from "../ariIntentRead.ts";
import { AGENT_TOOLS } from "../agentTools.ts";

const NOW = new Date("2026-11-27T10:00:00Z");
const BRAND = "22222222-2222-4222-8222-222222222222";
const createDiscount = AGENT_TOOLS.find((tool) =>
  tool.name === "create_discount"
);
assert(createDiscount, "create_discount is a tool");
const PARAMETERS = createDiscount.parameters as Record<string, unknown>;
const KEYS = new Set(
  Object.keys((PARAMETERS as { properties: Record<string, unknown> }).properties),
);
// No brand read is needed when no date or amount is stated.
const NO_CLIENT = {} as SupabaseClient;

function args(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    brand_id: BRAND,
    kind: "code",
    code: "FREE5",
    value_type: "percent",
    value_bps: 10000,
    ...extra,
  };
}

const TICKET_PHRASES: Array<[string, number]> = [
  ["Create a code FREE5 for 100% off, 5 free tickets", 5],
  ["Make FREE5 100% off, only 5 tickets", 5],
  ["FREE5 100% off for the first 5 tickets", 5],
  ["FREE5, 100% off, up to 5 tickets", 5],
  ["FREE5 100% off, 5 tickets max", 5],
  ["FREE5 100% off, five free tickets", 5],
  ["FREE5 100% off and limit it to 5 tickets", 5],
  ["FREE5 100% off, no more than 5 tickets in total", 5],
  ["Make FREE5 100% off, just 20 tickets", 20],
];

const USE_PHRASES: Array<[string, number]> = [
  ["FREE5 100% off, 5 uses", 5],
  ["FREE5 100% off, it can be used 5 times", 5],
  ["FREE5 100% off and 5 people can use it", 5],
  ["FREE5 100% off for the first 5 people", 5],
];

Deno.test("#4624 Ari: ticket phrasings are a ticket limit, never Total uses", () => {
  for (const [words, count] of TICKET_PHRASES) {
    const stated = extractStatedSlots([words], NOW);
    assertEquals(stated.ends_after_count, count, words);
    assertEquals(stated.max_total_uses, undefined, words);
    assertEquals(stated.unclear_limit, undefined, words);
  }
});

Deno.test("#4624 Ari: uses, times and people stay Total uses", () => {
  for (const [words, count] of USE_PHRASES) {
    const stated = extractStatedSlots([words], NOW);
    assertEquals(stated.max_total_uses, count, words);
    assertEquals(stated.ends_after_count, undefined, words);
  }
});

Deno.test("#4624 Ari: ticket counts that are not limits are not read as one", () => {
  for (
    const words of [
      "10% off for orders over 10 tickets",
      "20% off orders of at least 3 tickets",
      "FAVY10 10% off until 19 December",
      "FAVY10 10% off up to 19 December",
    ]
  ) {
    const stated = extractStatedSlots([words], NOW);
    assertEquals(stated.ends_after_count, undefined, words);
    assertEquals(stated.max_total_uses, undefined, words);
    assertEquals(stated.unclear_limit, undefined, words);
  }
});

Deno.test("#4624 Ari: a proposal with the right ticket limit is not bounced as uses", () => {
  const stated = extractStatedSlots(["Make FREE5 100% off, only 5 tickets"], NOW);
  const ok = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: args({ ends_after_count: 5 }),
    schemaKeys: KEYS,
    stated,
    timezone: "Africa/Lagos",
  });
  assertEquals(ok.kind, "ok");
  if (ok.kind !== "ok") return;
  assertEquals(ok.args.ends_after_count, 5);
  assertEquals(ok.args.max_total_uses, undefined);
  assertEquals(ok.bound, []);
});

Deno.test("#4624 Ari: the ticket number put into Total uses moves to the ticket limit", () => {
  for (const [words, count] of TICKET_PHRASES) {
    const stated = extractStatedSlots([words], NOW);
    const moved = checkStatedSlots({
      toolName: "create_discount",
      toolArgs: args({ max_total_uses: count }),
      schemaKeys: KEYS,
      stated,
      timezone: "Africa/Lagos",
    });
    assertEquals(moved.kind, "ok", words);
    if (moved.kind !== "ok") continue;
    assertEquals(moved.args.ends_after_count, count, words);
    assertEquals("max_total_uses" in moved.args, false, words);
    assertEquals(moved.bound.sort(), ["ends_after_count", "max_total_uses"]);
  }
});

Deno.test("#4624 Ari: the uses number put into the ticket limit moves to Total uses", () => {
  for (const [words, count] of USE_PHRASES) {
    const stated = extractStatedSlots([words], NOW);
    const moved = checkStatedSlots({
      toolName: "create_discount",
      toolArgs: args({ ends_after_count: count }),
      schemaKeys: KEYS,
      stated,
      timezone: "Africa/Lagos",
    });
    assertEquals(moved.kind, "ok", words);
    if (moved.kind !== "ok") continue;
    assertEquals(moved.args.max_total_uses, count, words);
    assertEquals("ends_after_count" in moved.args, false, words);
  }
});

Deno.test("#4624 Ari: a ticket limit the proposal dropped is asked about in tickets, then bound", () => {
  const stated = extractStatedSlots(["FREE5 100% off, 5 free tickets"], NOW);
  const asked = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: args(),
    schemaKeys: KEYS,
    stated,
    timezone: "Africa/Lagos",
  });
  assertEquals(asked.kind, "ask");
  if (asked.kind !== "ask") return;
  assertEquals(asked.missing, ["ends_after_count"]);
  assertMatch(asked.text, /you asked for a limit of 5 tickets/);
  assertNotMatch(asked.text, /uses/);
  // The host says yes; the next card carries the ticket limit.
  const history = [{ role: "assistant", content: { text: asked.text } }];
  const before = statedSlotsAskedBefore({ history, toolName: "create_discount" });
  assert(before.has("ends_after_count"));
  const bound = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: args(),
    schemaKeys: KEYS,
    stated,
    timezone: "Africa/Lagos",
    askedBefore: before,
  });
  assertEquals(bound.kind, "ok");
  if (bound.kind === "ok") assertEquals(bound.args.ends_after_count, 5);
  // Singular.
  const one = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: args(),
    schemaKeys: KEYS,
    stated: extractStatedSlots(["FREE5 100% off, only 1 ticket"], NOW),
    timezone: "Africa/Lagos",
  });
  assertEquals(one.kind, "ask");
  if (one.kind === "ask") assertMatch(one.text, /a limit of 1 ticket\b/);
});

Deno.test("#4624 Ari: a limit with no unit makes Ari ask tickets or checkouts, once", () => {
  for (
    const words of [
      "FREE5 100% off and limit it to 50",
      "FREE5 100% off, cap it at 50.",
      "FREE5 100% off, max 50 please",
    ]
  ) {
    const stated = extractStatedSlots([words], NOW);
    assertEquals(stated.unclear_limit, 50, words);
    for (
      const proposal of [
        args({ max_total_uses: 50 }),
        args({ ends_after_count: 50 }),
        args(),
      ]
    ) {
      const asked = checkStatedSlots({
        toolName: "create_discount",
        toolArgs: proposal,
        schemaKeys: KEYS,
        stated,
        timezone: "Africa/Lagos",
      });
      assertEquals(asked.kind, "ask", words);
      if (asked.kind !== "ask") continue;
      assertEquals(asked.missing, ["limit_unit"]);
      assertEquals(
        asked.text,
        "Before I set this up: should the limit of 50 count tickets or checkouts? A ticket limit ends the code after 50 tickets; a checkout limit ends it after 50 checkouts, however many tickets each one has. Tell me which and I'll prepare it for you to approve. Nothing has been saved yet.",
      );
      const before = statedSlotsAskedBefore({
        history: [{ role: "assistant", content: { text: asked.text } }],
        toolName: "create_discount",
      });
      assert(before.has("limit_unit"));
      const answered = checkStatedSlots({
        toolName: "create_discount",
        toolArgs: args({ ends_after_count: 50 }),
        schemaKeys: KEYS,
        stated,
        timezone: "Africa/Lagos",
        askedBefore: before,
      });
      assertEquals(answered.kind, "ok", words);
    }
  }
  // The host's answer with the unit settles it without the asked-before mark.
  const settled = extractStatedSlots([
    "FREE5 100% off and limit it to 50",
    "50 tickets max",
  ], NOW);
  const ok = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: args({ ends_after_count: 50 }),
    schemaKeys: KEYS,
    stated: settled,
    timezone: "Africa/Lagos",
  });
  assertEquals(ok.kind, "ok");
});

Deno.test("#4624 Ari: the intent read's ticket count is kept, its misread uses are dropped", () => {
  const ticketWords = ["Make FREE5 100% off, only 5 tickets"];
  const misread = mergeModelStatedSlots(
    extractStatedSlots(ticketWords, NOW),
    { code: "FREE5", percent_off: 100, max_total_uses: 5 },
    ticketWords,
  );
  assertEquals(misread.max_total_uses, undefined);
  assertEquals(misread.ends_after_count, 5);
  assertEquals(misread.conflicts, undefined);

  // Words the deterministic read does not cover: the model's ticket field.
  const loose = ["FREE5 100% off, 5 tickets for my VIPs"];
  const read = mergeModelStatedSlots(
    extractStatedSlots(loose, NOW),
    { code: "FREE5", percent_off: 100, ends_after_count: 5 },
    loose,
  );
  assertEquals(read.ends_after_count, 5);
  assertEquals(read.max_total_uses, undefined);

  // A ticket count the host never gave in tickets is dropped.
  const useWords = ["FREE5 100% off, 5 uses"];
  const wrong = mergeModelStatedSlots(
    extractStatedSlots(useWords, NOW),
    { code: "FREE5", percent_off: 100, ends_after_count: 5 },
    useWords,
  );
  assertEquals(wrong.ends_after_count, undefined);
  assertEquals(wrong.max_total_uses, 5);

  // A bare limit stays unclear, whatever the model guessed.
  const bare = ["FREE5 100% off and limit it to 50"];
  const guessed = mergeModelStatedSlots(
    extractStatedSlots(bare, NOW),
    { code: "FREE5", percent_off: 100, max_total_uses: 50 },
    bare,
  );
  assertEquals(guessed.max_total_uses, undefined);
  assertEquals(guessed.unclear_limit, 50);
});

Deno.test("#4624 Ari: two codes keep their own limits", () => {
  const words = [
    "Create FREE5 for 100% off with 5 free tickets, and VIP10 for 10% off with 20 uses",
  ];
  const stated = extractStatedSlots(words, NOW);
  assertEquals(stated.per_code?.FREE5?.ends_after_count, 5);
  assertEquals(stated.per_code?.FREE5?.max_total_uses, undefined);
  assertEquals(stated.per_code?.VIP10?.max_total_uses, 20);
  assertEquals(stated.per_code?.VIP10?.ends_after_count, undefined);
});

Deno.test("#4624 Ari: the agent-chat stage moves a misread ticket limit before the card", async () => {
  const check = await preserveStatedSlots({
    toolName: "create_discount",
    toolArgs: args({ max_total_uses: 5 }),
    parameters: PARAMETERS,
    ownerMessages: ["Create a code FREE5 for 100% off, 5 free tickets"],
    userClient: NO_CLIENT,
    now: NOW,
    modelStated: { code: "FREE5", percent_off: 100, max_total_uses: 5 },
  });
  assertEquals(check.kind, "ok");
  if (check.kind !== "ok") return;
  assertEquals(check.args.ends_after_count, 5);
  assertEquals("max_total_uses" in check.args, false);
});

Deno.test("#4624 Ari: the intent read has a ticket-count field and says what it means", () => {
  const props = (ARI_INTENT_READ_SCHEMA.properties as Record<string, unknown>)
    .stated_values as { properties: Record<string, unknown> };
  assertEquals(props.properties.ends_after_count, { type: "INTEGER" });
  const perCode = props.properties.per_code as {
    items: { properties: Record<string, unknown> };
  };
  assertEquals(perCode.items.properties.ends_after_count, { type: "INTEGER" });
  assertMatch(
    ARI_INTENT_READ_SYSTEM_PROMPT,
    /"only 5 tickets"[^.]*is ends_after_count, never max_total_uses/,
  );
  const parsed = parseAriIntentRead({
    intent: "tool",
    target: "create_discount",
    confidence: 0.9,
    stated_values: {
      code: "FREE5",
      ends_after_count: 5,
      per_code: [{ code: "FREE5", ends_after_count: 5 }],
    },
  }, { openFlow: null, toolNames: new Set(["create_discount"]) });
  assertEquals(parsed?.stated_values.ends_after_count, 5);
  assertEquals(parsed?.stated_values.per_code?.[0].ends_after_count, 5);
  // Not a whole number: the read is invalid, the hints route instead.
  assertEquals(
    parseAriIntentRead({
      intent: "tool",
      target: "create_discount",
      confidence: 0.9,
      stated_values: { ends_after_count: 2.5 },
    }, { openFlow: null, toolNames: new Set(["create_discount"]) }),
    null,
  );
});

Deno.test("#4624 Ari: create_discount tells the model which phrasings are tickets and which are uses", () => {
  const description = String(createDiscount.description);
  assertMatch(description, /'only 5 tickets'/);
  assertMatch(description, /'5 people can use it' is max_total_uses 5/);
  assertMatch(description, /ask whether it counts tickets or checkouts/);
});

// ── Rework (tester verdict 7227456725) ──────────────────────────────────────

Deno.test("#4624 rework P1-1: tickets per person are never a ticket limit or Total uses; Ari asks", () => {
  for (
    const words of [
      "FREE5 100% off, max 5 tickets per person",
      "FREE5 100% off, max of 5 tickets per buyer",
      "FREE5 100% off, up to 5 tickets each",
      "FREE5 100% off, 5 tickets per customer",
      "FREE5 100% off, 5 tickets max per person",
    ]
  ) {
    const stated = extractStatedSlots([words], NOW);
    assertEquals(stated.ends_after_count, undefined, words);
    assertEquals(stated.max_total_uses, undefined, words);
    assertEquals(stated.per_buyer_tickets, 5, words);
    for (
      const proposal of [
        args({ ends_after_count: 5 }),
        args({ max_total_uses: 5 }),
        args({ max_uses_per_buyer: 5 }),
        args(),
      ]
    ) {
      const asked = checkStatedSlots({
        toolName: "create_discount",
        toolArgs: proposal,
        schemaKeys: KEYS,
        stated,
        timezone: "Africa/Lagos",
      });
      assertEquals(asked.kind, "ask", words);
      if (asked.kind !== "ask") continue;
      assertEquals(asked.missing, ["per_buyer_unit"]);
      assertEquals(
        asked.text,
        "Before I set this up: a code can limit how many times each buyer uses it (one use is one checkout), not how many tickets each buyer gets. Should each buyer be able to use it 5 times? Tell me and I'll prepare it for you to approve. Nothing has been saved yet.",
      );
    }
    // Asked once: the host's answer goes on the card, nothing is moved.
    const before = statedSlotsAskedBefore({
      history: [{
        role: "assistant",
        content: {
          text:
            "Before I set this up: a code can limit how many times each buyer uses it (one use is one checkout), not how many tickets each buyer gets.",
        },
      }],
      toolName: "create_discount",
    });
    assert(before.has("per_buyer_unit"));
    const answered = checkStatedSlots({
      toolName: "create_discount",
      toolArgs: args({ max_uses_per_buyer: 5 }),
      schemaKeys: KEYS,
      stated,
      timezone: "Africa/Lagos",
      askedBefore: before,
    });
    assertEquals(answered.kind, "ok", words);
    if (answered.kind === "ok") {
      assertEquals(answered.args.max_uses_per_buyer, 5);
      assertEquals("ends_after_count" in answered.args, false);
    }
  }
  const one = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: args(),
    schemaKeys: KEYS,
    stated: extractStatedSlots(["FREE5 100% off, 1 ticket per person"], NOW),
    timezone: "Africa/Lagos",
  });
  assertEquals(one.kind, "ask");
  if (one.kind === "ask") assertMatch(one.text, /use it once\?/);
});

Deno.test("#4624 rework P2-1: 'max 5 per person' (no unit) is the per-buyer limit, never Total uses", () => {
  for (
    const words of [
      "FREE5 100% off, max 5 per person",
      "FREE5 100% off, up to 5 each",
      "FREE5 100% off, max 5 uses per person",
      "FREE5 100% off, limit it to 5 per buyer",
    ]
  ) {
    const base = extractStatedSlots([words], NOW);
    assertEquals(base.max_uses_per_buyer, 5, words);
    assertEquals(base.max_total_uses, undefined, words);
    assertEquals(base.ends_after_count, undefined, words);
    assertEquals(base.unclear_limit, undefined, words);
    // The model read it as Total uses or tickets: dropped, never grounded.
    const merged = mergeModelStatedSlots(
      base,
      { code: "FREE5", percent_off: 100, max_total_uses: 5, ends_after_count: 5 },
      [words],
    );
    assertEquals(merged.max_total_uses, undefined, words);
    assertEquals(merged.ends_after_count, undefined, words);
    assertEquals(merged.max_uses_per_buyer, 5, words);
    const checked = checkStatedSlots({
      toolName: "create_discount",
      toolArgs: args({ max_total_uses: 5 }),
      schemaKeys: KEYS,
      stated: merged,
      timezone: "Africa/Lagos",
    });
    assertEquals(checked.kind, "ask", words);
    if (checked.kind === "ask") assertEquals(checked.missing, ["max_uses_per_buyer"]);
  }
});

Deno.test("#4624 rework (tester P3): more ticket phrasings are a ticket limit", () => {
  for (
    const [words, count] of [
      ["FREE5 100% off, 5 tickets for free", 5],
      ["FREE5 100% off, let 5 people in free", 5],
      ["FREE5 100% off, let the first 5 people in for free", 5],
      ["FREE5 100% off for 5 tickets", 5],
      ["FREE5 100% off, good for 5 tickets", 5],
    ] as Array<[string, number]>
  ) {
    const stated = extractStatedSlots([words], NOW);
    assertEquals(stated.ends_after_count, count, words);
    assertEquals(stated.max_total_uses, undefined, words);
  }
  // A minimum, not a limit.
  for (
    const words of [
      "FREE5 10% off for 2 tickets or more",
      "FREE5 10% off for 3 tickets and up",
    ]
  ) {
    assertEquals(extractStatedSlots([words], NOW).ends_after_count, undefined, words);
  }
});
