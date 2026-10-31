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
import { BRAND_COMPLETENESS_AUDIT_PATHS } from "./issue_2830_brand_completeness_144_paths.fixture.ts";

const USER_ID = "28300000-0000-4000-8000-000000000001";
const BRAND_ID = "28300000-0000-4000-8000-000000000002";
const OPERATION_ID = "28300000-0000-4000-8000-000000000003";
const CONTEXT_REVISION = "a".repeat(64);

type EvalCriterion =
  | "tool_choice"
  | "question_necessity"
  | "unsupported_inference"
  | "provenance"
  | "approval_boundaries"
  | "idempotency"
  | "readback"
  | "recovery"
  | "terminal_truth";

const ALL_EVAL_CRITERIA: readonly EvalCriterion[] = [
  "tool_choice",
  "question_necessity",
  "unsupported_inference",
  "provenance",
  "approval_boundaries",
  "idempotency",
  "readback",
  "recovery",
  "terminal_truth",
];

const ROUTE_CRITERIA: Readonly<Record<string, readonly EvalCriterion[]>> = {
  "Read automatically": [
    "tool_choice",
    "question_necessity",
    "unsupported_inference",
    "readback",
  ],
  "Ask owner": [
    "tool_choice",
    "question_necessity",
    "unsupported_inference",
    "approval_boundaries",
  ],
  "Ask then draft": [
    "tool_choice",
    "question_necessity",
    "unsupported_inference",
    "provenance",
    "approval_boundaries",
  ],
  "Block & explain": [
    "tool_choice",
    "unsupported_inference",
    "approval_boundaries",
  ],
  "Confirm write": [
    "tool_choice",
    "approval_boundaries",
    "idempotency",
    "readback",
  ],
  "Human handoff": [
    "tool_choice",
    "approval_boundaries",
    "readback",
    "recovery",
  ],
  "Measure traces": ALL_EVAL_CRITERIA,
  "Own focused chain": ALL_EVAL_CRITERIA,
  "Own full chain": ALL_EVAL_CRITERIA,
  "Propose options": [
    "tool_choice",
    "question_necessity",
    "unsupported_inference",
    "approval_boundaries",
    "readback",
  ],
  "Re-audit": ["tool_choice", "readback", "recovery", "terminal_truth"],
  "Record exception": [
    "approval_boundaries",
    "provenance",
    "readback",
    "terminal_truth",
  ],
  "Recover & resume": ["tool_choice", "idempotency", "readback", "recovery"],
  "Research automatically": [
    "tool_choice",
    "unsupported_inference",
    "provenance",
  ],
  "Research then ask": [
    "tool_choice",
    "question_necessity",
    "unsupported_inference",
    "provenance",
    "approval_boundaries",
  ],
  "Research then propose": [
    "tool_choice",
    "question_necessity",
    "unsupported_inference",
    "provenance",
    "approval_boundaries",
  ],
  "Separate state": ["tool_choice", "approval_boundaries", "readback"],
  "Verify or remove": [
    "tool_choice",
    "unsupported_inference",
    "provenance",
    "approval_boundaries",
    "readback",
  ],
};

function websitePrompt(): string {
  return buildSystemPrompt(null, [{
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
}

function criteriaForPath(
  path: typeof BRAND_COMPLETENESS_AUDIT_PATHS[number],
): Set<EvalCriterion> {
  const criteria = new Set(ROUTE_CRITERIA[path.expectedRoute] ?? []);
  const corpus =
    `${path.scenario} ${path.requiredBehavior} ${path.ownerCheckpoint} ${path.terminalProof}`;
  if (
    /source|evidence|citation|provenance|research|public page|record id/i.test(
      corpus,
    )
  ) criteria.add("provenance");
  if (
    /approve|confirm|owner|protected write|permission|role check/i.test(corpus)
  ) criteria.add("approval_boundaries");
  if (
    /idempot|duplicate|replay|receipt|same job id|one mutation/i.test(corpus)
  ) criteria.add("idempotency");
  if (
    /readback|fresh read|re-read|re-audit|validator|check passes|current truth/i
      .test(corpus)
  ) criteria.add("readback");
  if (
    /resume|recover|retry|checkpoint|offline|conflict|failed|interrupted|reconnect/i
      .test(corpus)
  ) criteria.add("recovery");
  if (
    /complete|terminal|zero|ready|no unresolved|ends only|never falsely/i.test(
      corpus,
    )
  ) criteria.add("terminal_truth");
  return criteria;
}

function expectedToolsForPath(
  path: typeof BRAND_COMPLETENESS_AUDIT_PATHS[number],
): Set<string> {
  const tools = new Set(["get_site_plan"]);
  const corpus =
    `${path.scenario} ${path.expectedRoute} ${path.requiredBehavior} ${path.terminalProof}`;
  if (
    /fix all|full chain|durable|job|resume|checkpoint|reconnect|continue/i.test(
      corpus,
    )
  ) {
    tools.add("start_brand_completeness_job");
    tools.add("manage_agent_job");
  }
  if (
    /research|public (?:web|page|source)|search result|social profile|source changes/i
      .test(corpus)
  ) {
    tools.add("search_public_web");
    tools.add("read_public_url");
  }
  if (
    /stale|conflict|disagree|several .*sources|several .*candidates/i.test(
      corpus,
    )
  ) {
    tools.add("record_brand_context_finding");
  }
  if (/social profile|instagram|social account/i.test(corpus)) {
    tools.add("inspect_public_social_profile");
  }
  if (/upload|human handoff|file|logo|cover media/i.test(corpus)) {
    tools.add("open_handoff");
  }
  if (/design|theme|font|motion|look/i.test(corpus)) {
    tools.add("list_site_designs");
  }
  if (/design choice|choose the design|plan-choice/i.test(corpus)) {
    tools.add("save_site_plan_design");
  }
  if (
    /write|save|phone|email|address|city|country|link|theme|brand name|description/i
      .test(corpus)
  ) {
    tools.add("update_brand_context");
  }
  if (
    /operation status|ambiguous|times out|network fails during a write/i.test(
      corpus,
    )
  ) {
    tools.add("get_site_operation_status");
  }
  return tools;
}

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
    context_revision: CONTEXT_REVISION,
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
      if (name === "ari_record_brand_context_finding") {
        return {
          data: {
            brand_id: BRAND_ID,
            field_key: params.p_field_key,
            disposition: params.p_disposition,
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

const WEBSITE_EVAL_CONTRACT = websitePrompt();
const CONTRACT_PROBES: Readonly<Record<EvalCriterion, readonly RegExp[]>> = {
  tool_choice: [
    /call get_site_plan before speaking/i,
    /start_brand_completeness_job/i,
  ],
  question_necessity: [/ask one necessary clarification at a time/i],
  unsupported_inference: [
    /Never turn missing into verified/i,
    /Unknown .* stays unset/i,
    /never invent/i,
  ],
  provenance: [
    /exact HTTPS source and observed time/i,
    /candidate values with source and date/i,
    /Owner words are owner evidence/i,
  ],
  approval_boundaries: [
    /Every website change is a proposal the owner confirms/i,
    /Never approve the plan for the owner/i,
  ],
  idempotency: [
    /never repeat a completed write/i,
    /never blindly repeat a write/i,
  ],
  readback: [
    /Read back get_site_plan after every confirmed write/i,
    /fresh get_site_plan read/i,
  ],
  recovery: [
    /Resume an active job instead of starting over/i,
    /On REVISION_CONFLICT, read again/i,
    /failed or ambiguous receipt/i,
  ],
  terminal_truth: [
    /required_gap_count\s*=\s*0,? recommended_gap_count\s*=\s*0/i,
    /failed_validation_count\s*=\s*0/i,
    /context_complete=true/i,
  ],
};

Deno.test("#2830 approved completeness eval contains exactly 144 durable paths", () => {
  assertEquals(BRAND_COMPLETENESS_AUDIT_PATHS.length, 144);
  const domains = new Map<string, number>();
  BRAND_COMPLETENESS_AUDIT_PATHS.forEach((path, index) => {
    assertEquals(path.id, `PATH ${String(index + 1).padStart(3, "0")}`);
    assert(
      ROUTE_CRITERIA[path.expectedRoute],
      `${path.id} has unmapped route ${path.expectedRoute}`,
    );
    assert(
      path.requiredBehavior.length > 20,
      `${path.id} lacks required behavior`,
    );
    assert(path.terminalProof.length > 20, `${path.id} lacks terminal proof`);
    domains.set(path.domain, (domains.get(path.domain) ?? 0) + 1);
  });
  assertEquals(domains.size, 18);
  for (const [domain, count] of domains) {
    assertEquals(count, 8, `${domain} must retain all eight approved paths`);
  }
});

for (const path of BRAND_COMPLETENESS_AUDIT_PATHS) {
  Deno.test(`#2830 completeness eval ${path.id}: ${path.scenario}`, () => {
    const criteria = criteriaForPath(path);
    assert(criteria.size > 0, `${path.id} has no evaluation criteria`);
    for (const criterion of criteria) {
      assert(
        CONTRACT_PROBES[criterion].some((probe) =>
          probe.test(WEBSITE_EVAL_CONTRACT)
        ),
        `${path.id} lacks ${criterion} contract coverage`,
      );
    }
    for (const toolName of expectedToolsForPath(path)) {
      assert(
        findTool(toolName),
        `${path.id} requires unavailable tool ${toolName}`,
      );
    }
  });
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
    params: { p_brand_id: BRAND_ID, p_takeover: false },
  });
  await tool.executor(
    { brand_id: BRAND_ID, takeover: true },
    f.client as never,
    USER_ID,
    { operationId: null },
  );
  assertEquals(f.rpcCalls.at(-1), {
    name: "ari_start_brand_completeness_job",
    params: { p_brand_id: BRAND_ID, p_takeover: true },
  });
});

Deno.test("#2830 stale and conflicting research stays canonical without changing the public value", async () => {
  const tool = findTool("record_brand_context_finding");
  assert(tool);
  assert(isAgentStateToolCall(tool.name));
  assert(isReadOnlyAgentToolCall(tool.name, { brand_id: BRAND_ID }));
  const f = fixture();
  const candidates = [{
    value: "Brooklyn, US",
    source_type: "mingla",
    source_ref: `brand:${BRAND_ID}`,
    observed_at: "2026-10-31T12:00:00Z",
    confidence: 1,
  }, {
    value: "Toronto, CA",
    source_type: "public_research",
    source_ref: "Official contact page",
    source_url: "https://example.com/contact",
    observed_at: "2026-10-31T12:01:00Z",
    confidence: 0.9,
  }];
  await tool.executor(
    {
      brand_id: BRAND_ID,
      field_key: "city_country",
      state: "conflict",
      candidates,
    },
    f.client as never,
    USER_ID,
    { operationId: null },
  );
  assertEquals(f.rpcCalls.at(-1), {
    name: "ari_record_brand_context_finding",
    params: {
      p_brand_id: BRAND_ID,
      p_field_key: "city_country",
      p_disposition: "conflict",
      p_candidates: candidates,
    },
  });
  const error = await assertRejects(
    () =>
      tool.executor(
        {
          brand_id: BRAND_ID,
          field_key: "city_country",
          state: "conflict",
          candidates: [candidates[0]],
        },
        f.client as never,
        USER_ID,
        { operationId: null },
      ),
    ToolError,
  );
  assertEquals(error.code, "INVALID_ARGS");
});

Deno.test("#2830 durable checkpoints preserve blockers, handoffs, evidence and the next action", async () => {
  const tool = findTool("manage_agent_job");
  assert(tool);
  let rpc: { name: string; params: Record<string, unknown> } = {
    name: "",
    params: {},
  };
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpc = { name, params };
      return { data: { id: OPERATION_ID, revision: 2 }, error: null };
    },
  };
  await tool.executor(
    {
      action: "checkpoint",
      job_id: OPERATION_ID,
      expected_revision: 1,
      status: "awaiting_approval",
      current_step: "profile_photo",
      next_action: {
        kind: "human_handoff",
        field_key: "profile_photo",
        detail: "Open the owner upload handoff, then read the plan again.",
        requires_owner_input: true,
        recheck_triggers: ["media_changed"],
      },
      active_question: "Would you like to upload the logo now?",
      completed_step_keys: ["contact_phone"],
      pending_step_keys: ["profile_photo", "cover_media"],
      blocked_step_keys: ["profile_photo"],
      human_action_step_keys: ["profile_photo", "cover_media"],
      evidence_refs: [{
        field_key: "contact_phone",
        source_type: "owner",
        source_ref: "conversation:turn-12",
        observed_at: "2026-10-31T12:00:00Z",
      }],
    },
    client as never,
    USER_ID,
    { operationId: null },
  );
  assertEquals(rpc, {
    name: "ari_manage_agent_job",
    params: {
      p_action: "checkpoint",
      p_job_id: OPERATION_ID,
      p_brand_id: null,
      p_conversation_id: null,
      p_idempotency_key: null,
      p_expected_revision: 1,
      p_patch: {
        status: "awaiting_approval",
        checkpoint: {
          current_step: "profile_photo",
          next_action: {
            kind: "human_handoff",
            field_key: "profile_photo",
            detail: "Open the owner upload handoff, then read the plan again.",
            requires_owner_input: true,
            recheck_triggers: ["media_changed"],
          },
          active_question: "Would you like to upload the logo now?",
          blocked_step_keys: ["profile_photo"],
          human_action_step_keys: ["profile_photo", "cover_media"],
          evidence_refs: [{
            field_key: "contact_phone",
            source_type: "owner",
            source_ref: "conversation:turn-12",
            observed_at: "2026-10-31T12:00:00Z",
          }],
        },
        completed_step_keys: ["contact_phone"],
        pending_step_keys: ["profile_photo", "cover_media"],
      },
    },
  });
  await tool.executor(
    {
      action: "checkpoint",
      job_id: OPERATION_ID,
      expected_revision: 2,
      current_step: null,
      next_action: null,
      active_question: null,
    },
    client as never,
    USER_ID,
    { operationId: null },
  );
  assertEquals(rpc.params.p_patch, {
    checkpoint: {
      current_step: null,
      next_action: null,
      active_question: null,
    },
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
      expected_context_revision: CONTEXT_REVISION,
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
    p_expected_context_revision: CONTEXT_REVISION,
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
          expected_context_revision: CONTEXT_REVISION,
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

  const invalidEvidence = fixture();
  const originalRpc = invalidEvidence.client.rpc;
  invalidEvidence.client.rpc =
    (async (name: string, params: Record<string, unknown>) =>
      name === "ari_update_brand_context"
        ? { data: null, error: { message: "invalid_evidence" } }
        : await originalRpc(
          name,
          params,
        )) as unknown as typeof invalidEvidence.client.rpc;
  const invalidError = await assertRejects(
    () =>
      tool.executor(
        {
          brand_id: BRAND_ID,
          expected_plan_revision: 4,
          expected_context_revision: CONTEXT_REVISION,
          patch: { contact_phone: "+12125550100" },
          evidence: { source_type: "owner" },
          why: "Confirmed by the owner.",
          cites: [{ kind: "owner_words", quote: "+1 212 555 0100" }],
        },
        invalidEvidence.client as never,
        USER_ID,
        { operationId: OPERATION_ID },
      ),
    ToolError,
  );
  assertEquals(invalidError.code, "INVALID_ARGS");
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
  assertMatch(prompt, /completed, pending, blocked and human-action keys/i);
  assertMatch(prompt, /bounded evidence references/i);
  assertMatch(
    prompt,
    /required_gap_count\s*=\s*0,? recommended_gap_count\s*=\s*0/i,
  );
  assertMatch(prompt, /failed_validation_count\s*=\s*0/i);
  assertMatch(prompt, /cross-field alignment/i);
  assertMatch(prompt, /Do not show or describe a draft that does not exist/i);
});
