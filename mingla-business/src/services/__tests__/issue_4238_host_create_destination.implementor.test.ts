/**
 * #4238 investigation — a real Host create sent canonical_plan.destination
 * whole (the full ad_plan_destination_resolve result: ok, ready, title,
 * canonical_url, destination_family, ...). admin-ad-create-campaign's resolver
 * accepts page_type, brand_slug and entity_slug only and refuses anything
 * else with destination_descriptor_unknown_field, so every Host launch failed
 * at its validate step (on main too). The payload now sends the descriptor.
 */
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import { hostAdDestinationDescriptor, providerCreatePayload } from "../hostAdPlanService";

const CANONICAL_DESTINATION = {
  ok: true,
  ready: true,
  code: null,
  page_type: "event",
  brand_slug: "femzy",
  entity_slug: "deserted-island",
  title: "Deserted Island",
  canonical_url: "https://host.usemingla.com/e/femzy/deserted-island",
  destination_family: "public_mingla_page",
  destination_key: "event:femzy:deserted-island",
  objective: "web_traffic",
  measurement_event: "tickets",
};
const ACCEPTED_KEYS = ["page_type", "brand_slug", "entity_slug"];

describe("#4238 Host create payload destination", () => {
  it.each(["meta", "snapchat", "tiktok", "google", "reddit"])("%s sends only the descriptor", (platform) => {
    const aggregate = {
      plan: { id: "p1", brand_id: "b1", state: "funded_held" },
      version: {
        id: "v1",
        plan_hash: "c".repeat(64),
        canonical_plan: {
          name: "Host ad",
          destination: CANONICAL_DESTINATION,
          creative_library_id: "lib-1",
          delivery_budgets: { [platform]: { host_amount_cents: 10_000, provider_amount_cents: 700 } },
        },
      },
      provider_allocations: [{ platform, host_budget_cents: 100_000, provider_budget_cents: 7_000 }],
      targeting_snapshots: [{ platform, audience_intent: { countries: ["NG"] }, compiled_targeting: {} }],
    };
    const payload = providerCreatePayload(
      aggregate as unknown as Parameters<typeof providerCreatePayload>[0],
      { platform, host_budget_cents: 100_000, provider_budget_cents: 7_000 },
      true,
    );
    const expected = { page_type: "event", brand_slug: "femzy", entity_slug: "deserted-island" };
    expect(payload.destination).toEqual(expected);
    expect(payload.destinations).toEqual([expected]);
    for (const sent of [payload.destination, ...(payload.destinations as unknown[])]) {
      expect(Object.keys(sent as object).every((key) => ACCEPTED_KEYS.includes(key))).toBe(true);
    }
  });

  it("a brand page (no entity) sends no entity_slug", () => {
    expect(hostAdDestinationDescriptor({ ...CANONICAL_DESTINATION, page_type: "brand", entity_slug: null })).toEqual({
      page_type: "brand",
      brand_slug: "femzy",
    });
  });
});
