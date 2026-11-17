/**
 * #4238 W5 — Ari's ad tools: get_ad_budget_guidance (the Host builder's
 * guidance, read inline), apply_ad_suggestion (one confirmed tap, id only,
 * never an amount), and propose_ad_plan's goal + visits-fallback yes.
 */
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ariBudgetGuidanceRequest,
  ariSuggestionRequest,
  ariVisitsFallbackApps,
  DOMAIN_READ_ONLY,
  MONEY_CONFIRM_TOOLS,
} from "../agentDomainTools.ts";
import { AGENT_TOOLS } from "../agentTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const ID = "a".repeat(40);

Deno.test("registry: guidance is an inline read; a suggestion is a confirmed money write", () => {
  const names = AGENT_TOOLS.map((tool) => tool.name);
  assert(names.includes("get_ad_budget_guidance"));
  assert(names.includes("apply_ad_suggestion"));
  assert(DOMAIN_READ_ONLY.has("get_ad_budget_guidance"));
  assert(!DOMAIN_READ_ONLY.has("apply_ad_suggestion"));
  assert(MONEY_CONFIRM_TOOLS.has("apply_ad_suggestion"));
  assertEquals(AGENT_TOOL_AUTHORIZATION.apply_ad_suggestion?.hostAdActions, [
    "fund",
    "launch",
  ]);
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_ad_budget_guidance?.hostAdActions, [
    "plan",
  ]);
  const apply = AGENT_TOOLS.find((tool) =>
    tool.name === "apply_ad_suggestion"
  )!;
  const props =
    (apply.parameters as { properties: Record<string, unknown> }).properties;
  // No amount, end date or learning acknowledgement can be sent by Ari.
  assertEquals(Object.keys(props).sort(), [
    "brand_id",
    "campaign_id",
    "suggestion_id",
  ]);
});

Deno.test("apply_ad_suggestion sends only the id and plan; a stale or advice-only one is refused first", () => {
  const report = {
    plan_id: PLAN,
    suggestion: {
      suggestion_id: ID,
      kind: "raise_budget",
      apply_action: "change_live",
      host_budget_cents: 5100,
    },
  };
  const body = ariSuggestionRequest(
    { brand_id: BRAND, suggestion_id: ID },
    report,
    "op-12345678",
  );
  assertEquals(body, {
    action: "change_live",
    brand_id: BRAND,
    plan_id: PLAN,
    suggestion_id: ID,
    idempotency_key: "ari_suggest_op-12345678",
  });
  assert(
    !("new_budget_cents" in body) && !("acknowledge_learning_reset" in body),
  );
  assertThrows(
    () =>
      ariSuggestionRequest(
        { brand_id: BRAND, suggestion_id: "b".repeat(40) },
        report,
        "op",
      ),
    ToolError,
    "changed since I read it",
  );
  assertThrows(
    () =>
      ariSuggestionRequest({ brand_id: BRAND, suggestion_id: ID }, {
        plan_id: PLAN,
        suggestion: null,
      }, "op"),
    ToolError,
  );
  assertThrows(
    () =>
      ariSuggestionRequest({ brand_id: BRAND, suggestion_id: ID }, {
        plan_id: PLAN,
        suggestion: {
          suggestion_id: ID,
          kind: "new_video",
          apply_action: null,
        },
      }, "op"),
    ToolError,
    "advice only",
  );
  assertEquals(
    ariSuggestionRequest({ brand_id: BRAND, suggestion_id: ID }, {
      plan_id: PLAN,
      suggestion: {
        suggestion_id: ID,
        kind: "accept_last_tickets",
        apply_action: "accept_last_tickets",
      },
    }, "op"),
    {
      action: "accept_last_tickets",
      brand_id: BRAND,
      plan_id: PLAN,
      suggestion_id: ID,
    },
  );
});

Deno.test("SC-2.5: Ari asks ad-plan host_budget_guidance exactly like the builder", () => {
  assertEquals(
    ariBudgetGuidanceRequest({
      brand_id: BRAND,
      dest_page_type: "event",
      dest_brand_slug: "harmattan",
      dest_entity_slug: "afro-nation",
      platforms: ["Meta", "tiktok", "meta"],
      optimize_for: "sales",
      daily_budget_cents: 1000,
      budget_mode: "daily",
    }),
    {
      action: "host_budget_guidance",
      brand_id: BRAND,
      destination: {
        page_type: "event",
        brand_slug: "harmattan",
        entity_slug: "afro-nation",
      },
      platforms: ["meta", "tiktok"],
      optimization: "sales",
      budget_mode: "daily",
      daily_cents: 1000,
    },
  );
  const lifetime = ariBudgetGuidanceRequest({
    brand_id: BRAND,
    dest_page_type: "event",
    dest_brand_slug: "harmattan",
    platforms: ["meta"],
    optimize_for: "signups",
    budget_cents: 50_000,
    starts_at: "2026-11-20T00:00:00Z",
    ends_at: "2026-11-30T00:00:00Z",
  });
  assertEquals(lifetime.budget_mode, "lifetime");
  assertEquals(lifetime.total_cents, 50_000);
  assertThrows(
    () => ariBudgetGuidanceRequest({ platforms: ["myspace"] }),
    ToolError,
  );
});

Deno.test("U-3 for Ari: the fallback apps need the Host's yes, as in the builder", async () => {
  assertEquals(
    ariVisitsFallbackApps("sales", ["meta", "tiktok"], {
      meta: "sales",
      tiktok: "visits",
    }),
    ["tiktok"],
  );
  assertEquals(
    ariVisitsFallbackApps("visits", ["meta"], { meta: "visits" }),
    [],
  );
  const src = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  // Checked before the plan opens, and the goal + yes ride on the plan.
  const gate = src.indexOf("const unacknowledged = fallbackApps.filter(");
  const open = src.indexOf('action: "open",\n      client_kind: "ari",');
  assert(gate > 0 && open > gate);
  assert(
    src.includes(
      "optimization_goal: args.optimize_for,\n          acknowledged_visits_fallback: fallbackApps,",
    ),
  );
});
