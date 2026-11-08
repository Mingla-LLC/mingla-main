// #4304 — Ari keeps the action it proposes after a lookup, and its pause /
// resume / end discount cards name the discount.
//
// Live 2026-11-08 on host.usemingla.com: "End the TEST10 code" ran
// list_discounts and ended as "Here's what I found." — the follow-up model
// call's end_discount was dropped, so the Host had to say "Yes, end it" again.
// MINGLA-INVARIANT: I-4304-ARI-FOLLOWUP-PROPOSAL | issue #4304 | A write tool call returned by the read follow-up becomes the turn's proposal through the same write-proposal path; a second read stays a text turn.
// deno-lint-ignore-file no-explicit-any
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { followupProposal } from "../agentFollowupProposal.ts";
import { findTool, isReadOnlyAgentToolCall } from "../agentTools.ts";
import { preflightDiscountProposal } from "../agentDomainTools.ts";
import { verifiedProposalArgs } from "../agentTicketPricing.ts";

const BRAND = "6f7d1c52-0d4e-4a43-9a0e-1f6b7f2a9b10";
const DISCOUNT = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const END_ARGS = { brand_id: BRAND, discount_id: DISCOUNT, version: 3 };

const chatSource = await Deno.readTextFile(
  new URL("../../agent-chat/index.ts", import.meta.url),
);

Deno.test("#4304 a follow-up end_discount after list_discounts becomes the proposal", () => {
  const promoted = followupProposal(
    {
      textResponse: "Here's TEST10.",
      toolCall: {
        name: "end_discount",
        args: END_ARGS,
        thoughtSignature: "sig",
      },
    },
    findTool,
    isReadOnlyAgentToolCall,
    false,
  );
  assert(promoted, "end_discount must be promoted, not dropped");
  assertEquals(promoted.tool.name, "end_discount");
  assertEquals(promoted.toolCall.args, END_ARGS);
  assertEquals(promoted.toolCall.thoughtSignature, "sig");
});

Deno.test("#4304 a follow-up create_discount after an events read becomes the proposal", () => {
  const promoted = followupProposal(
    { toolCall: { name: "create_discount", args: { brand_id: BRAND } } },
    findTool,
    isReadOnlyAgentToolCall,
    false,
  );
  assertEquals(promoted?.tool.name, "create_discount");
});

Deno.test("#4304 a second read, an unknown tool, no tool call or a read interruption stays a text turn", () => {
  assertEquals(
    followupProposal(
      { toolCall: { name: "list_discounts", args: { brand_id: BRAND } } },
      findTool,
      isReadOnlyAgentToolCall,
      false,
    ),
    null,
  );
  assertEquals(
    followupProposal(
      { toolCall: { name: "not_a_tool", args: {} } },
      findTool,
      isReadOnlyAgentToolCall,
      false,
    ),
    null,
  );
  assertEquals(
    followupProposal(
      { textResponse: "Here it is." },
      findTool,
      isReadOnlyAgentToolCall,
      false,
    ),
    null,
  );
  assertEquals(
    followupProposal(undefined, findTool, isReadOnlyAgentToolCall, false),
    null,
  );
  assertEquals(
    followupProposal(
      { toolCall: { name: "end_discount", args: END_ARGS } },
      findTool,
      isReadOnlyAgentToolCall,
      true,
    ),
    null,
  );
});

Deno.test("#4304 agent-chat's read branch hands a promoted follow-up to the write-proposal path", () => {
  const readStart = chatSource.indexOf(
    "if (isReadOnlyAgentToolCall(tool.name, gemini.toolCall.args)) {",
  );
  const promote = chatSource.indexOf("promoted = followupProposal(", readStart);
  const leave = chatSource.indexOf("break readTurn;", promote);
  const textFallback = chatSource.indexOf(
    `const text = followup?.textResponse ?? "Here's what I found.";`,
    readStart,
  );
  const rebind = chatSource.indexOf(
    "gemini.toolCall = promoted.toolCall;",
    textFallback,
  );
  const retool = chatSource.indexOf("tool = promoted.tool;", textFallback);
  const writePath = chatSource.indexOf(
    "// #2063: bind canonical optimistic state",
    readStart,
  );
  const commitWrite = chatSource.indexOf(
    'classification: "general_write_proposal"',
    writePath,
  );
  assert(readStart > 0, "read branch");
  assert(promote > readStart, "the read branch asks followupProposal");
  assert(
    leave > promote && leave < textFallback,
    "a promoted call leaves before the text turn",
  );
  assert(
    rebind > textFallback && rebind < writePath,
    "the promoted call is rebound before the write path",
  );
  assert(
    retool > textFallback && retool < writePath,
    "the promoted tool is rebound before the write path",
  );
  assert(commitWrite > writePath, "the write path commits a pending proposal");
  assert(
    /readTurn: try \{/.test(chatSource),
    "the read try is labelled readTurn",
  );
  assert(
    chatSource.includes('issue: "4304"') &&
      chatSource.includes("read follow-up proposal promoted"),
    "promotion is logged",
  );
});

function stubClient(
  result: { data: unknown; error: unknown } | Error,
  seen: Record<string, unknown> = {},
): any {
  const query: any = {
    select(cols: string) {
      seen.select = cols;
      return query;
    },
    eq(col: string, val: unknown) {
      seen[col] = val;
      return query;
    },
    maybeSingle() {
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    },
  };
  return {
    from(table: string) {
      seen.table = table;
      return query;
    },
  };
}

Deno.test("#4304 discount preflight names the discount by its code for pause, resume and end", async () => {
  for (const tool of ["pause_discount", "resume_discount", "end_discount"]) {
    const seen: Record<string, unknown> = {};
    const context = await preflightDiscountProposal(
      tool,
      END_ARGS,
      stubClient({
        data: { id: DISCOUNT, code: "TEST10", name: "Ten off" },
        error: null,
      }, seen),
    );
    assertEquals(context, { discount_name: "TEST10" }, tool);
    assertEquals(seen.table, "brand_discounts");
    assertEquals(seen.id, DISCOUNT);
    assertEquals(seen.brand_id, BRAND);
  }
});

Deno.test("#4304 discount preflight uses the name when there is no code", async () => {
  const context = await preflightDiscountProposal(
    "end_discount",
    END_ARGS,
    stubClient({
      data: { id: DISCOUNT, code: null, name: "Early bird sale" },
      error: null,
    }),
  );
  assertEquals(context, { discount_name: "Early bird sale" });
});

Deno.test("#4304 discount preflight returns null on a miss, an error or another tool", async () => {
  assertEquals(
    await preflightDiscountProposal(
      "end_discount",
      END_ARGS,
      stubClient({ data: null, error: null }),
    ),
    null,
  );
  assertEquals(
    await preflightDiscountProposal(
      "end_discount",
      END_ARGS,
      stubClient({ data: null, error: { message: "denied" } }),
    ),
    null,
  );
  assertEquals(
    await preflightDiscountProposal(
      "end_discount",
      END_ARGS,
      stubClient(new Error("network")),
    ),
    null,
  );
  assertEquals(
    await preflightDiscountProposal(
      "end_discount",
      END_ARGS,
      stubClient({ data: { id: "other", code: "NOPE" }, error: null }),
    ),
    null,
  );
  assertEquals(
    await preflightDiscountProposal(
      "create_discount",
      END_ARGS,
      stubClient({ data: { id: DISCOUNT, code: "TEST10" }, error: null }),
    ),
    null,
  );
});

Deno.test("#4304 the verified proposal context keeps discount_name", () => {
  const verified = verifiedProposalArgs(END_ARGS, {
    discount_name: "TEST10",
    smuggled: "x",
  });
  const context = verified.__proposal_context as Record<string, unknown>;
  assertEquals(context.discount_name, "TEST10");
  assertEquals("smuggled" in context, false);
});

Deno.test("#4304 agent-chat merges the discount preflight into the proposal context", () => {
  const writePath = chatSource.indexOf(
    "// #2063: bind canonical optimistic state",
  );
  const call = chatSource.indexOf(
    "await preflightDiscountProposal(",
    writePath,
  );
  const merge = chatSource.indexOf("...(discountContext ?? {}),", call);
  const commit = chatSource.indexOf("return await commitPendingTurn({", merge);
  assert(call > writePath && merge > call && commit > merge);
});
