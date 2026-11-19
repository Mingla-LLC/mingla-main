// deno-lint-ignore-file no-explicit-any require-await -- stubs mirror the client
/*
 * Issue #4453 Website workspace — a confirmed plan's progress rows and its
 * answer on the confirm path.
 *
 *   - each step is one activity row on the turn that proposed the plan
 *     (`site_step_started` / `site_step_done` / `site_step_failed`), with the
 *     step's index, label and group in `detail`;
 *   - a database function that does not take `p_detail` yet still gets the
 *     row (the Host reads the step from the order of the rows);
 *   - a row that cannot be written never throws into the executor;
 *   - agent-confirm-action hands the writer to the change set only, says the
 *     result in the server's words, and shows no "Saved" receipt for a plan
 *     that was put back; a re-run of an `executing` approval stays refused.
 *
 * Run: deno test --no-check --allow-read --allow-env --allow-net \
 *   supabase/functions/agent-confirm-action/__tests__/issue_4453_site_step_activity.implementor.test.ts
 */
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import type { SiteStepActivity } from "../../_shared/agentSiteWorkspaceTools.ts";
import { siteStepActivityWriter } from "../siteStepActivity.ts";
import { toolErrorHttpStatus } from "../executionOutcome.ts";

const USER = "c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5";
const CONVERSATION = "44444444-4444-4444-8444-444444444444";
const PENDING = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "55555555-5555-4555-8555-555555555555";
const TURN = "66666666-6666-4666-8666-666666666666";

function client(options: {
  proposal?: boolean;
  rpc?: (args: Record<string, any>) => { error: unknown };
} = {}) {
  const rpcCalls: Array<Record<string, any>> = [];
  const reads: string[] = [];
  const table = (name: string) => {
    reads.push(name);
    const builder: any = {};
    for (const method of ["select", "eq", "contains", "order", "limit"]) {
      builder[method] = () => builder;
    }
    builder.maybeSingle = async () => ({
      data: name === "agent_messages"
        ? options.proposal === false ? null : { client_turn_id: TURN }
        : { id: ATTEMPT, attempt_number: 2 },
      error: null,
    });
    return builder;
  };
  return {
    rpcCalls,
    reads,
    from: table,
    rpc: async (fn: string, args: Record<string, any>) => {
      rpcCalls.push({ fn, ...args });
      return options.rpc?.(args) ?? { error: null };
    },
  };
}

const started: SiteStepActivity = {
  type: "site_step_started",
  detail: {
    group_id: PENDING,
    index: 0,
    total: 2,
    label: "Shorten the heading",
  },
};
const failed: SiteStepActivity = {
  type: "site_step_failed",
  detail: {
    group_id: PENDING,
    index: 1,
    total: 2,
    label: "Move reviews up",
    reason: "That section is not on the page.",
    rolled_back: true,
  },
};

Deno.test("#4453 each step is one activity row on the proposing turn, with its detail", async () => {
  const db = client();
  const write = siteStepActivityWriter({
    client: db,
    userId: USER,
    conversationId: CONVERSATION,
    pendingActionId: PENDING,
    now: () => "2026-11-19T10:00:00.000Z",
  });
  await write(started);
  await write({ ...started, type: "site_step_done" });
  await write(failed);
  assertEquals(db.rpcCalls.map((call) => call.p_event_type), [
    "site_step_started",
    "site_step_done",
    "site_step_failed",
  ]);
  assertEquals(db.rpcCalls[0], {
    fn: "append_agent_activity_event",
    p_attempt_id: ATTEMPT,
    p_user_id: USER,
    p_attempt_number: 2,
    p_event_type: "site_step_started",
    p_now: "2026-11-19T10:00:00.000Z",
    p_detail: {
      group_id: PENDING,
      index: 0,
      total: 2,
      label: "Shorten the heading",
    },
  });
  assertEquals(db.rpcCalls[2].p_detail, failed.detail);
  // The proposing turn is looked up once for the whole plan.
  assertEquals(db.reads, ["agent_messages", "agent_turn_attempts"]);
});

Deno.test("#4453 a function without p_detail still gets every row (kind only), decided once", async () => {
  const db = client({
    rpc: (args) =>
      "p_detail" in args
        ? {
          error: { code: "PGRST202", message: "Could not find the function" },
        }
        : { error: null },
  });
  const write = siteStepActivityWriter({
    client: db,
    userId: USER,
    conversationId: CONVERSATION,
    pendingActionId: PENDING,
  });
  await write(started);
  await write(failed);
  assertEquals(
    db.rpcCalls.map((call) => [call.p_event_type, "p_detail" in call]),
    [
      ["site_step_started", true],
      ["site_step_started", false],
      ["site_step_failed", false],
    ],
  );
});

Deno.test("#4453 a row that cannot be written never throws into the executor", async () => {
  const original = console.error;
  const logged: string[] = [];
  console.error = (line: unknown) => {
    logged.push(String(line));
  };
  try {
    // The kind is not allowed yet (22023), the table is down, or it throws.
    const refused = client({
      rpc: () => ({
        error: { code: "22023", message: "unsupported activity event" },
      }),
    });
    await siteStepActivityWriter({
      client: refused,
      userId: USER,
      conversationId: CONVERSATION,
      pendingActionId: PENDING,
    })(started);
    const throwing = {
      from: () => {
        throw new Error("network");
      },
      rpc: async () => ({ error: null }),
    };
    await siteStepActivityWriter({
      client: throwing as any,
      userId: USER,
      conversationId: CONVERSATION,
      pendingActionId: PENDING,
    })(started);
    // No conversation or no proposing turn: nothing to write, nothing thrown.
    const none = client({ proposal: false });
    await siteStepActivityWriter({
      client: none,
      userId: USER,
      conversationId: CONVERSATION,
      pendingActionId: PENDING,
    })(started);
    assertEquals(none.rpcCalls.length, 0);
    const orphan = client();
    await siteStepActivityWriter({
      client: orphan,
      userId: USER,
      conversationId: null,
      pendingActionId: PENDING,
    })(started);
    assertEquals(orphan.rpcCalls.length, 0);
  } finally {
    console.error = original;
  }
  assert(logged.some((line) => line.includes("ari_activity_write_failed")));
  // Never an id, a label or a reason in the log line.
  assert(
    logged.every((line) =>
      !line.includes(PENDING) && !line.includes("Shorten")
    ),
  );
});

Deno.test("#4453 agent-confirm-action wires the plan: writer for the change set only, the server's follow-up, no receipt for a plan put back, no re-run", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  // The writer goes to the change set and to nothing else.
  assertMatch(
    source,
    /\.\.\.\(tool\.name === SITE_CHANGE_SET_TOOL\s*\?\s*\{\s*onSiteStep: siteStepActivityWriter\(\{/,
  );
  // The plan's group is the approval's own id; a retry is flagged.
  assertMatch(
    source,
    /operationId: pending\.id,\s*retry: pending\.status === "executing",/,
  );
  // What happened is said from the result, not by a model continuation.
  assertMatch(
    source,
    /const siteWorkspaceFollowup = siteWorkspaceFollowupText\(tool\.name, result\);/,
  );
  assertMatch(
    source,
    /!websiteSetupFollowup && !siteWorkspaceFollowup && !liveRun/,
  );
  // A plan that was not applied gets no "Saved in Mingla" receipt, and its
  // copy-gate fallback never says "saved".
  assertMatch(
    source,
    /const rendition = siteChangeSetNotApplied \? null : buildToolReceiptRendition\(/,
  );
  assertMatch(
    source,
    /fallback: siteChangeSetNotApplied\s*\? "That change could not be applied to your draft\."/,
  );
  // An approval already `executing` is only re-entered for receipt-backed
  // tools; the change set is not one, so a second confirm never re-runs it.
  const receiptSet = source.slice(
    source.indexOf("const RECEIPT_BACKED_TOOL_NAMES = new Set(["),
    source.indexOf("const RECEIPT_BACKED_EVENT_TOOL_NAMES"),
  );
  assert(receiptSet.length > 0);
  assert(!receiptSet.includes("propose_site_change_set"));
  assert(!receiptSet.includes("propose_website_team_request"));
  // The executor's own refusal of a re-run is a conflict, never a retryable 500.
  assertEquals(toolErrorHttpStatus("DOMAIN_ACTION_REFUSED"), 409);
  assertEquals(toolErrorHttpStatus("INVALID_ARGS"), 400);
});
