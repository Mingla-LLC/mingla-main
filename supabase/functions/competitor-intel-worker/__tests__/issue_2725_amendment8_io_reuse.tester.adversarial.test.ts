import { assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { processCompetitorJob, synthesizeBrief } from "../index.ts";

const job = {
  id: "job-1", competitor_id: "watch-1", brand_id: "brand-1",
  venue_listing_id: "venue-1", source_set_fingerprint: "a".repeat(64),
  capability_snapshot: { website: 1 }, lease_owner: "owner-1",
  attempt_count: 1, funding_lane: "manual" as const,
  manual_tool_lead_id: null,
};
const observations = [{
  sourceId: "source-1", kind: "website",
  facts: { profile: { bio: "Live music" } },
  checkedAt: "2026-08-28T00:00:00.000Z", latestObservedAt: null,
  publicUrl: "https://example.com", fingerprint: "b".repeat(64),
}];
const comparisons = [{
  sourceId: "source-1", kind: "website", before: null,
  after: observations[0].facts, changedPaths: [],
}];

function thenableResult(result: unknown) {
  const chain: Record<string, any> = {};
  for (const method of ["select", "eq", "order", "limit", "in", "is"]) {
    chain[method] = (..._args: unknown[]) => chain;
  }
  chain.maybeSingle = async () => result;
  chain.single = async () => result;
  chain.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

Deno.test("issue 2725 amendment 8 refuses all provider I/O without a reservation", async () => {
  let fetchCalls = 0;
  const db = {
    from(table: string) {
      if (table === "tool_competitors") return thenableResult({ data: {
        id: "watch-1", name: "Competitor", city: "Atlanta",
        current_brief_id: null, updated_at: "2026-08-28T00:00:00.000Z",
      }, error: null });
      if (table === "tool_competitor_sources") return thenableResult({ data: [{
        id: "source-1", kind: "website", normalized_url: "https://example.com",
        normalized_identity: "website:example.com/",
        source_fingerprint: "b".repeat(64), capability: "analyzed_weekly",
        health: "pending", last_checked_at: null,
      }], error: null });
      if (table === "tool_competitor_provider_capabilities") {
        return thenableResult({ data: [{
          kind: "website", mode: "analyzed_weekly", enabled: true,
          availability_generation: 1,
        }], error: null });
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name: string) {
      assertEquals(name, "issue_2725_reserve_budget");
      return { data: null, error: { message: "budget refused" } };
    },
  };
  await processCompetitorJob(db, job, (async () => {
    fetchCalls += 1;
    return new Response("provider should never be called");
  }) as typeof fetch);
  assertEquals(fetchCalls, 0);
});

Deno.test("issue 2725 amendment 8 reuses an accepted identical input before model I/O", async () => {
  const previous = Deno.env.get("GOOGLE_AI_API_KEY");
  try {
    Deno.env.set("GOOGLE_AI_API_KEY", "test");
    let fetchCalls = 0;
    let settledClass = "";
    const db = {
      from(table: string) {
        assertEquals(table, "tool_competitor_synthesis_results");
        return thenableResult({ data: { result: {
          what_changed: [{ id: "f1", text: "Cached observation.",
            source_id: "source-1", evidence_id: "e1", confidence: "observed" }],
          why_it_matters: [{ text: "Review against venue context.",
            evidence_ids: ["e1"], confidence: "interpretation" }],
          worth_doing: [{ id: "a1", text: "Review the evidence.", kind: "review",
            confidence: "suggested_action", is_primary: true }], evidence: [],
        } }, error: null });
      },
      async rpc(name: string, args: Record<string, unknown>) {
        assertEquals(name, "issue_2725_settle_zero_cost");
        settledClass = String(args.p_result_class);
        return { data: null, error: null };
      },
    };
    const result = await synthesizeBrief(
      "Competitor", "Atlanta", observations, comparisons,
      { listing: null, brand_published_events: [] },
      (async () => {
        fetchCalls += 1;
        return new Response("model should never be called");
      }) as typeof fetch, { db, job },
    );
    assertEquals(fetchCalls, 0);
    assertEquals(settledClass, "accepted_reuse");
    assertEquals(result.evidence.length, 1);
  } finally {
    previous === undefined ? Deno.env.delete("GOOGLE_AI_API_KEY")
      : Deno.env.set("GOOGLE_AI_API_KEY", previous);
  }
});

Deno.test("issue 2725 amendment 8 missing usage writes a null receipt and never fabricates zero", async () => {
  const previous = Deno.env.get("GOOGLE_AI_API_KEY");
  try {
    Deno.env.set("GOOGLE_AI_API_KEY", "test");
    let receipt: Record<string, unknown> | null = null;
    let requestBody: Record<string, any> | null = null;
    const db = {
      from(table: string) {
        assertEquals(table, "tool_competitor_synthesis_results");
        return thenableResult({ data: null, error: null });
      },
      async rpc(name: string, args: Record<string, unknown>) {
        assertEquals(name, "issue_2725_record_model_usage");
        receipt = args.p_receipt as Record<string, unknown>;
        return { data: "receipt-1", error: null };
      },
    };
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify({
          what_changed: [{ id: "f1", text: "Model text.",
            source_id: "source-1", evidence_id: "e1", confidence: "observed" }],
          why_it_matters: [{ text: "Review against venue context.",
            evidence_ids: ["e1"], confidence: "interpretation" }],
          worth_doing: [{ id: "a1", text: "Review the evidence.", kind: "review",
            confidence: "suggested_action", is_primary: true }],
        }) }] }, }], modelVersion: "gemini-2.5-flash-001" }),
        { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await assertRejects(() => synthesizeBrief(
      "Competitor", "Atlanta", observations, comparisons,
      { listing: null, brand_published_events: [] }, fetcher, { db, job },
    ), Error, "usage_metadata_missing");
    const measuredReceipt = receipt as unknown as Record<string, unknown>;
    const generatedRequest = requestBody as unknown as Record<string, any>;
    assertEquals(measuredReceipt.usage_complete, false);
    assertEquals(measuredReceipt.actual_microusd, null);
    assertEquals(measuredReceipt.prompt_tokens, null);
    assertEquals(measuredReceipt.candidate_tokens, null);
    assertEquals(measuredReceipt.thinking_tokens, 0);
    assertEquals(measuredReceipt.reserved_microusd, 50000);
    assertEquals(generatedRequest.generationConfig.temperature, 0);
    assertEquals(generatedRequest.generationConfig.thinkingConfig.thinkingBudget, 0);
    assertEquals(generatedRequest.generationConfig.candidateCount, 1);
    assertEquals(generatedRequest.generationConfig.maxOutputTokens, 1200);
    assertEquals(generatedRequest.generationConfig.responseJsonSchema.additionalProperties, false);
    assertEquals(Number.isInteger(generatedRequest.generationConfig.seed), true);
  } finally {
    previous === undefined ? Deno.env.delete("GOOGLE_AI_API_KEY")
      : Deno.env.set("GOOGLE_AI_API_KEY", previous);
  }
});
