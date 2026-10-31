import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildSystemPrompt } from "../agentSystemPrompt.ts";
import {
  findTool,
  isAgentStateToolCall,
  isReadOnlyAgentToolCall,
  ToolError,
} from "../agentTools.ts";

const USER_ID = "28300000-0000-4000-8000-000000000001";
const BRAND_ID = "28300000-0000-4000-8000-000000000002";
const OPERATION_ID = "28300000-0000-4000-8000-000000000003";

function thenableQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not", "limit"]) {
    query[method] = () => query;
  }
  query.maybeSingle = () => Promise.resolve(result);
  query.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function fixture() {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const invokeCalls: Record<string, unknown>[] = [];
  const completeness = {
    revision: 4,
    required_gap_count: 0,
    recommended_gap_count: 1,
    gap_count: 1,
    context_complete: false,
    fields: [{
      key: "contact_phone",
      requirement: "recommended",
      state: "missing",
    }],
  };
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      if (name === "biz_brand_effective_rank_for_caller") {
        return { data: 60, error: null };
      }
      if (name === "biz_role_rank") return { data: 50, error: null };
      if (name === "ari_start_brand_completeness_job") {
        return {
          data: {
            job: { id: OPERATION_ID, pending_step_keys: ["contact_phone"] },
            completeness,
          },
          error: null,
        };
      }
      if (name === "ari_update_brand_context") {
        return {
          data: {
            brand_id: BRAND_ID,
            plan_revision: 5,
            completeness: {
              ...completeness,
              gap_count: 0,
              context_complete: true,
            },
          },
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    functions: {
      invoke: async (
        _name: string,
        options: { body: Record<string, unknown> },
      ) => {
        invokeCalls.push(options.body);
        return {
          data: {
            ok: true,
            data: {
              plan: { revision: 4, design_key: "voyage" },
              status: { done_count: 4, parts: [] },
              completeness,
            },
          },
          error: null,
        };
      },
    },
    from: (table: string) => {
      if (table === "brand_sites") {
        return thenableQuery({ data: [], error: null });
      }
      if (table === "brands") {
        return thenableQuery({
          data: [{
            id: BRAND_ID,
            name: "North Star",
            slug: "north-star",
            default_currency: "USD",
            cover_media_url: null,
          }],
          error: null,
        });
      }
      if (table === "brand_team_members") {
        return thenableQuery({ data: [], error: null });
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, rpcCalls, invokeCalls };
}

Deno.test("#2830 Website setup reads the complete plan manifest before speaking", async () => {
  const tool = findTool("get_site_plan");
  assert(tool);
  const f = fixture();
  const result = await tool.executor(
    { brand_id: BRAND_ID },
    f.client as never,
    USER_ID,
    { operationId: null },
  ) as Record<string, unknown>;
  assertEquals((result.completeness as { gap_count: number }).gap_count, 1);
  assertEquals(f.invokeCalls[0], {
    route: `/v1/brands/${BRAND_ID}/site-plan`,
    method: "GET",
  });
});

Deno.test("#2830 Fix all is a resumable agent-state job, not a confirmed brand write", async () => {
  const tool = findTool("start_brand_completeness_job");
  assert(tool);
  assert(isAgentStateToolCall(tool.name));
  assert(isReadOnlyAgentToolCall(tool.name, { brand_id: BRAND_ID }));
  const f = fixture();
  const result = await tool.executor(
    { brand_id: BRAND_ID },
    f.client as never,
    USER_ID,
    { operationId: null },
  ) as { job: { pending_step_keys: string[] } };
  assertEquals(result.job.pending_step_keys, ["contact_phone"]);
  assertEquals(f.rpcCalls.at(-1), {
    name: "ari_start_brand_completeness_job",
    params: { p_brand_id: BRAND_ID },
  });
});

Deno.test("#2830 context writes are confirmed, revision-safe and receipt-backed", async () => {
  const tool = findTool("update_brand_context");
  assert(tool);
  const f = fixture();
  await tool.executor(
    {
      brand_id: BRAND_ID,
      expected_plan_revision: 4,
      patch: { contact_phone: "+12125550100" },
      evidence: { source_type: "owner" },
      why: "Use the phone number the owner confirmed for Website contact.",
      cites: [{ kind: "owner_words", quote: "+1 212 555 0100" }],
    },
    f.client as never,
    USER_ID,
    { operationId: OPERATION_ID },
  );
  const call = f.rpcCalls.find((candidate) =>
    candidate.name === "ari_update_brand_context"
  );
  assertEquals(call?.params, {
    p_operation_id: OPERATION_ID,
    p_brand_id: BRAND_ID,
    p_expected_plan_revision: 4,
    p_patch: { contact_phone: "+12125550100" },
    p_exceptions: [],
    p_evidence: { source_type: "owner" },
  });

  const missingReceipt = fixture();
  const error = await assertRejects(
    () =>
      tool.executor(
        {
          brand_id: BRAND_ID,
          expected_plan_revision: 4,
          patch: { contact_phone: "+12125550100" },
          evidence: { source_type: "owner" },
          why: "Confirmed by the owner.",
          cites: [{ kind: "owner_words", quote: "+1 212 555 0100" }],
        },
        missingReceipt.client as never,
        USER_ID,
        { operationId: null },
      ),
    ToolError,
  );
  assertEquals(error.code, "OPERATION_ID_REQUIRED");
  assertEquals(
    missingReceipt.rpcCalls.some((candidate) =>
      candidate.name === "ari_update_brand_context"
    ),
    false,
  );
});

Deno.test("#2830 pre-draft design save stays on the plan and never creates a site", async () => {
  const tool = findTool("save_site_plan_design");
  assert(tool);
  const f = fixture();
  const result = await tool.executor(
    {
      brand_id: BRAND_ID,
      expected_plan_revision: 4,
      design_key: "voyage",
      why: "The owner chose Voyage.",
      cites: [{ kind: "owner_words", quote: "Use Voyage" }],
    },
    f.client as never,
    USER_ID,
    { operationId: OPERATION_ID },
  ) as { draft_created: boolean };
  assertEquals(result.draft_created, false);
  assertEquals(f.invokeCalls[0], {
    route: `/v1/brands/${BRAND_ID}/site-plan/design`,
    method: "POST",
    revision: 4,
    design_key: "voyage",
    source_type: "owner",
    source_url: null,
  });
});

Deno.test("#2830 system contract makes Ari own the chain without inventing completion", () => {
  const prompt = buildSystemPrompt(null, [{
    id: BRAND_ID,
    name: "North Star",
    slug: "north-star",
    role: "owner",
    effectiveRank: 60,
    defaultCurrency: "USD",
    hasCover: true,
    hasBlockingEvents: false,
  }], {
    injectStrictReminder: false,
    business: {
      brands: [],
      activeBrand: {
        id: BRAND_ID,
        name: "North Star",
        slug: "north-star",
        role: "owner",
        effectiveRank: 60,
        defaultCurrency: "USD",
        hasCover: true,
        hasBlockingEvents: false,
      },
      offerings: [],
      payoutReady: true,
      roleHint: "owner",
      conversationSummary: null,
    },
  });
  assertMatch(prompt, /call get_site_plan before speaking/i);
  assertMatch(prompt, /Fix all gaps.*durable chain/i);
  assertMatch(prompt, /ask one necessary clarification at a time/i);
  assertMatch(
    prompt,
    /required_gap_count\s*=\s*0,? recommended_gap_count\s*=\s*0/i,
  );
  assertMatch(prompt, /Do not show or describe a draft that does not exist/i);
});
