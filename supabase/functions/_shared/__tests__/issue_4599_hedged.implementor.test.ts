// MINGLA-INVARIANT: I-ARI-HEDGED-VALUES-NEVER-PROPOSED | issue #4599 | A value the host marks as maybe, probably, proposed, pending, TBC, not sure, or might is excluded from proposal args and Ari asks for confirmation instead.

import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  ARI_INTENT_READ_SCHEMA,
  parseAriIntentRead,
  routeAriTurn,
} from "../ariIntentRead.ts";
import { preserveStatedSlots } from "../ariTruthGuards.ts";

const toolNames = new Set(["create_discount"]);
const base = {
  intent: "tool",
  target: "create_discount",
  confidence: 0.95,
  stated_values: { code: "MAYBE15", percent_off: 15 },
};

Deno.test("#4599 intent read accepts hedged_keys and invalid/missing values fail soft to []", () => {
  const props = ARI_INTENT_READ_SCHEMA.properties as Record<string, unknown>;
  assertEquals((props.hedged_keys as { type: string }).type, "ARRAY");
  const parsed = parseAriIntentRead(
    { ...base, hedged_keys: ["code", "percent_off"] },
    { openFlow: null, toolNames },
  );
  assertEquals(parsed?.hedged_keys, ["code", "percent_off"]);
  const invalid = parseAriIntentRead(
    { ...base, hedged_keys: ["secret"] },
    { openFlow: null, toolNames },
  );
  assertEquals(invalid?.hedged_keys, []);
  const result = {
    source: "model" as const,
    read: invalid!,
    elapsedMs: 1,
    modelCalls: 1 as const,
  };
  const route = routeAriTurn({
    result,
    hints: {
      offering: null,
      contact_import: false,
      website_setup: false,
      website_lane: false,
      readiness: null,
      request: null,
      event_planner: false,
      flow_text: null,
      card_choice: null,
      question: false,
    },
    openFlow: null,
    engineOn: true,
    message: "probably 15%",
    safetyReply: false,
  });
  assertEquals(route.hedgedKeys, []);
});

Deno.test("#4599 a hedged value already in proposed args becomes a confirmation question", async () => {
  const check = await preserveStatedSlots({
    toolName: "create_discount",
    toolArgs: { code: "MAYBE15", value_bps: 1500 },
    parameters: {
      type: "object",
      properties: { code: { type: "string" }, value_bps: { type: "integer" } },
    },
    ownerMessages: ["Maybe use MAYBE15 for probably 15% off"],
    userClient: {} as SupabaseClient,
    modelStated: { code: "MAYBE15", percent_off: 15 },
    modelHedgedKeys: ["code", "percent_off"],
  });
  assertEquals(check.kind, "ask");
  if (check.kind === "ask") {
    assertEquals(check.missing.sort(), ["code", "value_bps"]);
    assertMatch(check.text, /confirm the value you marked as uncertain/);
  }
});
