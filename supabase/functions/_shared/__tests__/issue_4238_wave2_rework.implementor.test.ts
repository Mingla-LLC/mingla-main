// Issue #4238 wave 2 rework — host_setup audience states before the first
// worker pass, provider audience names, and Ari's card-time audience check
// and plain audience names. Fakes only: no provider, no database.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { audienceProviderName, hostAudiencePlatformStates } from "../adListAudienceRules.ts";
import { preflightMoneyProposal } from "../agentDomainTools.ts";
import { OWNER_SPOKEN_REFUSAL_CODES } from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";

Deno.test("#4238 P2-3 before the first sync: Google not eligible, Reddit not available, never 'N more needed'", () => {
  const list = hostAudiencePlatformStates({
    kind: "list",
    platforms: ["meta", "google", "reddit", "snapchat"],
    known: [],
    memberCount: 40,
    countryCount: null,
  });
  assertEquals(list, [
    { platform: "meta", state: "below_minimum", needed_count: 60 },
    { platform: "google", state: "ineligible", needed_count: null },
    { platform: "reddit", state: "unsupported", needed_count: null },
    { platform: "snapchat", state: "below_minimum", needed_count: 960 },
  ]);
  const lookalike = hostAudiencePlatformStates({
    kind: "lookalike",
    platforms: ["meta", "google", "reddit"],
    known: [],
    memberCount: 40,
    countryCount: 40,
  });
  assertEquals(lookalike.map((row) => row.platform), ["meta", "reddit"], "no Google line on a lookalike");
  assertEquals(lookalike[1].state, "unsupported");
  // A state the worker wrote wins.
  const known = hostAudiencePlatformStates({
    kind: "list",
    platforms: ["google"],
    known: [{ platform: "google", state: "ready", needed_count: null }],
    memberCount: 4000,
    countryCount: null,
  });
  assertEquals(known[0].state, "ready");
});

Deno.test("#4238 P3 a lookalike's provider name says its country once", () => {
  const name = audienceProviderName({
    ownerKind: "host",
    brandName: "Room 27",
    brandId: "b4238000-0000",
    displayName: "People like your guests (NG)",
    country: "NG",
    platform: "meta",
  });
  assertEquals(name, "Mingla · Room 27 [b4238000] · People like your guests (NG)");
  assertEquals(audienceProviderName({ ownerKind: "mingla", displayName: "Everyone", country: "NG" }), "Mingla · Everyone · NG");
});

const BRAND = "b4238000-0000-4000-8000-000000000001";
const RIVAL = "b4238000-0000-4000-8000-0000000000c9";
const rows = [
  { audience_key: `brand:${BRAND}:guests`, display_name: "Your past guests", kind: "list", approx_size: 100, lookalike_country: null, platforms: [] },
  { audience_key: `brand:${BRAND}:lookalike:NG`, display_name: "People like your guests (NG)", kind: "lookalike", approx_size: null, lookalike_country: "NG", platforms: [] },
];
function fakeClient(aggregate: unknown = null) {
  const rpcs: string[] = [];
  return {
    rpcs,
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push(name);
      if (name !== "host_ad_audiences") return Promise.resolve({ data: null, error: { message: "unexpected" } });
      return Promise.resolve(args.p_brand_id === BRAND ? { data: rows, error: null } : { data: null, error: { code: "42501" } });
    },
    functions: {
      invoke: (_name: string, opts: { body: Record<string, unknown> }) =>
        opts.body.action === "get"
          ? Promise.resolve({ data: aggregate, error: null })
          : Promise.resolve({ data: null, error: new Error("not in this test") }),
    },
  };
}
const base = {
  brand_id: BRAND, name: "Ari ad", dest_page_type: "event", dest_brand_slug: "femzy", platforms: ["meta"],
  budget_cents: 150_000, countries: ["NG"], rights_confirmed: true, rights_basis: "owned", ai_generated: false,
};

Deno.test("#4238 P2-4 propose_ad_plan refuses another brand's, the seed and Mingla-wide keys before any card", async () => {
  assert(OWNER_SPOKEN_REFUSAL_CODES.has("AD_AUDIENCE_NOT_OWNED"), "said in plain words, never as a card");
  for (const key of [`brand:${RIVAL}:guests`, `brand:${BRAND}:seed`, "mingla:everyone:all", `brand:${BRAND}:retired_list`]) {
    const error = await assertRejects(
      () => preflightMoneyProposal("propose_ad_plan", { ...base, audience_keys: [key] }, fakeClient()),
      ToolError,
    );
    assertEquals((error as ToolError).code, "AD_AUDIENCE_NOT_OWNED", key);
  }
});

Deno.test("#4238 P2-4 a lookalike with a second country is refused at card time", async () => {
  const error = await assertRejects(
    () =>
      preflightMoneyProposal(
        "propose_ad_plan",
        { ...base, countries: ["NG", "GH"], audience_keys: [`brand:${BRAND}:lookalike:NG`] },
        fakeClient(),
      ),
    ToolError,
  );
  assertEquals((error as ToolError).code, "AD_AUDIENCE_NOT_OWNED");
  assert((error as ToolError).message.includes("Nigeria is the only country"));
});

Deno.test("#4238 P2-4 the propose card names the chosen audiences in plain words", async () => {
  const context = await preflightMoneyProposal(
    "propose_ad_plan",
    { ...base, audience_keys: [`brand:${BRAND}:guests`, `brand:${BRAND}:lookalike:NG`] },
    fakeClient(),
  );
  assertEquals(context?.ad_audiences, "Your past guests · People like your guests in Nigeria");
  const without = await preflightMoneyProposal("propose_ad_plan", base, fakeClient());
  assertEquals(without?.ad_audiences, undefined);
});

Deno.test("#4238 P2-4 the approval (LAUNCH) card names the frozen audiences", async () => {
  const hash = "a".repeat(64);
  const planId = "c4238000-0000-4000-8000-000000000001";
  const versionId = "c4238000-0000-4000-8000-000000000002";
  const aggregate = {
    plan: { id: planId, brand_id: BRAND, state: "ready_for_launch" },
    version: {
      id: versionId, plan_hash: hash, host_budget_cents: 150_000, host_currency: "NGN",
      canonical_plan: {
        audience_intent: { countries: ["NG"] },
        audience_selection: { include_keys: [`brand:${BRAND}:lookalike:NG`, `brand:${BRAND}:guests`] },
      },
    },
    provider_allocations: [],
    targeting_snapshots: [],
  };
  const context = await preflightMoneyProposal(
    "approve_ad_plan",
    { brand_id: BRAND, plan_id: planId, plan_version_id: versionId, plan_hash: hash },
    fakeClient(aggregate),
  );
  assertEquals(context?.ad_audiences, "People like your guests in Nigeria · Your past guests");
});

// #4238 investigation: canonical_plan.destination is the full
// ad_plan_destination_resolve result. Sent whole, create's resolver refuses it
// (destination_descriptor_unknown_field) before anything else, so every Ari
// and Host create failed at the validate step. The payload now carries the
// descriptor only.
import { buildHostAdCreatePayload } from "../agentDomainTools.ts";
import { AdDestinationError, resolveAdDestination } from "../adDestination.ts";

const CANONICAL_DESTINATION = {
  ok: true, ready: true, code: null, page_type: "event", id: "e1", brand_id: BRAND,
  brand_slug: "femzy", entity_slug: "deserted-island", title: "Deserted Island",
  canonical_url: "https://host.usemingla.com/e/femzy/deserted-island", result_kind: "tickets",
  destination_family: "public_mingla_page", destination_key: "event:femzy:deserted-island",
  objective: "web_traffic", measurement_event: "tickets",
};

Deno.test("#4238 Ari's create payload sends only the destination descriptor create accepts", async () => {
  const aggregate = {
    plan: { id: "p1", brand_id: BRAND, state: "funded_held" },
    version: {
      id: "v1", plan_hash: "b".repeat(64), host_budget_cents: 100_000, host_currency: "NGN",
      canonical_plan: {
        name: "Ari ad", destination: CANONICAL_DESTINATION, creative_library_id: "c1",
        delivery_budgets: { meta: { host_amount_cents: 10_000, provider_amount_cents: 700 } },
      },
    },
    provider_allocations: [{ platform: "meta", host_budget_cents: 100_000, provider_budget_cents: 7_000 }],
    targeting_snapshots: [{ platform: "meta", audience_intent: { countries: ["NG"] }, compiled_targeting: {} }],
  };
  // deno-lint-ignore no-explicit-any
  const payload = buildHostAdCreatePayload(aggregate as any, "meta", "op-1", true);
  const expected = { page_type: "event", brand_slug: "femzy", entity_slug: "deserted-island" };
  assertEquals(payload.destination, expected);
  assertEquals(payload.destinations, [expected]);

  const seen: Record<string, unknown>[] = [];
  const db = {
    from: () => ({ select: () => ({}) }),
    rpc: (_name: string, args: Record<string, unknown>) => {
      seen.push(args);
      return Promise.resolve({ data: null, error: { message: "stop here" } });
    },
  };
  // The whole canonical object is refused before any lookup (the old bug).
  const refused = await assertRejects(() => resolveAdDestination(db, CANONICAL_DESTINATION), AdDestinationError);
  assertEquals((refused as AdDestinationError).code, "destination_descriptor_unknown_field");
  assertEquals(seen.length, 0);
  // The descriptor passes the shape check and reaches the resolver.
  await assertRejects(() => resolveAdDestination(db, payload.destination));
  assertEquals(seen[0], { p_page_type: "event", p_brand_slug: "femzy", p_entity_slug: "deserted-island" });
});
