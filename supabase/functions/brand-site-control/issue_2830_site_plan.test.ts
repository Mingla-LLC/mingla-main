import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  handleSitePlanRoute,
  planFailureFromRpc,
  type SitePlanContext,
} from "./sitePlan.ts";

const BRAND_ID = "28300000-0000-4000-8000-000000000002";
const USER_ID = "28300000-0000-4000-8000-000000000001";

async function json(response: Response | null) {
  if (!response) throw new Error("expected a response");
  return await response.json() as Record<string, unknown>;
}

function context() {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const completeness = {
    revision: 3,
    design_key: "voyage",
    gap_count: 2,
    required_gap_count: 0,
    recommended_gap_count: 2,
    context_complete: false,
    fields: [
      { key: "contact_phone", state: "missing", requirement: "recommended" },
      {
        key: "cover_media",
        state: "missing",
        requirement: "recommended",
        human_action_required: true,
      },
    ],
  };
  const ctx: SitePlanContext = {
    userId: USER_ID,
    userRpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "brand_site_plan_get") {
        return {
          data: { plan: { revision: 3 }, status: { done_count: 3, parts: [] } },
          error: null,
        };
      }
      if (fn === "brand_context_completeness") {
        return { data: completeness, error: null };
      }
      if (fn === "brand_site_plan_save_design") {
        return {
          data: { plan: { revision: 4 }, status: { done_count: 4, parts: [] } },
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    serviceRpc: async () => ({ data: null, error: null }),
    callCms: async () => new Response(null, { status: 204 }),
  };
  return { ctx, calls };
}

Deno.test("#2830 the setup read joins plan truth with the complete field audit", async () => {
  const f = context();
  const body = await json(
    await handleSitePlanRoute(
      `/v1/brands/${BRAND_ID}/site-plan`,
      "GET",
      {},
      f.ctx,
    ),
  );
  const data = body.data as Record<string, unknown>;
  assertEquals((data.plan as { design_key: string }).design_key, "voyage");
  assertEquals((data.completeness as { gap_count: number }).gap_count, 2);
  assertEquals(f.calls.map((call) => call.fn), [
    "brand_site_plan_get",
    "brand_context_completeness",
  ]);
});

Deno.test("#2830 design selection is a revision-safe plan route without a site id", async () => {
  const f = context();
  const body = await json(
    await handleSitePlanRoute(
      `/v1/brands/${BRAND_ID}/site-plan/design`,
      "POST",
      { revision: 3, design_key: "voyage", source_type: "owner" },
      f.ctx,
    ),
  );
  assertEquals(body.ok, true);
  assertEquals(f.calls[0], {
    fn: "brand_site_plan_save_design",
    args: {
      p_brand_id: BRAND_ID,
      p_revision: 3,
      p_design_key: "voyage",
      p_source_type: "owner",
      p_source_url: null,
    },
  });
  assertEquals(f.calls.some((call) => call.fn.includes("provision")), false);
});

Deno.test("#2830 an incomplete context is a named, non-retryable plan refusal", async () => {
  const response = planFailureFromRpc("sites_context_incomplete");
  assertEquals(response.status, 409);
  const body = await json(response);
  const error = body.error as {
    code: string;
    message: string;
    retryable: boolean;
  };
  assertEquals(error.code, "PLAN_NOT_READY");
  assertEquals(error.retryable, false);
  assertMatch(error.message, /Finish the earlier parts/i);
});
