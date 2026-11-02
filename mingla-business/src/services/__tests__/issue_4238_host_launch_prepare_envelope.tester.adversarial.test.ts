/**
 * #4238 wave 2 retest — TESTER adversarial (different angle from the
 * implementor's payload-shape test): drive the whole Host "Start my ad"
 * service call with the EXACT success envelope admin-ad-creative-prepare
 * returns. Its envelope() always carries an `error` key, null when the video
 * is ready. hostAdPlanService.invoke() treats any `"error" in data` as a
 * failure, so a ready video aborts the launch before admin-ad-create-campaign
 * is ever called ("The campaign could not launch."). Seen live on the local
 * stack: confirm_launch -> prepare:status 200 (state ready, error null) ->
 * record_create_failure, with no create call.
 */
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import { supabase } from "../supabase";
// eslint-disable-next-line import/first
import { launchHostAdPlan } from "../hostAdPlanService";

const HASH = "e".repeat(64);
const AGGREGATE = {
  ok: true,
  plan: { id: "p1", brand_id: "b1", state: "staff_approved", current_version_id: "v1" },
  version: {
    id: "v1",
    plan_hash: HASH,
    canonical_plan: {
      name: "Deserted Island — past guests",
      destination: {
        ok: true,
        page_type: "event",
        brand_slug: "femzy",
        entity_slug: "deserted-island",
        title: "Deserted Island",
      },
      creative_library_id: "a4238000-0000-4000-8000-000000000001",
      copy: { primary: "Three days off-grid.", headline: "Deserted Island" },
      delivery_budgets: { meta: { host_amount_cents: 15_000_000, provider_amount_cents: 9_677 } },
    },
  },
  funding_hold: { state: "held" },
  provider_allocations: [
    { platform: "meta", host_budget_cents: 150_000_000, provider_budget_cents: 96_774 },
  ],
  targeting_snapshots: [
    { platform: "meta", audience_intent: { countries: ["NG"] }, compiled_targeting: { geo_locations: { countries: ["NG"] } } },
  ],
};

/** admin-ad-creative-prepare's envelope() for a cached, ready video. */
const PREPARE_READY = {
  trace_id: "t1",
  creative_library_id: "a4238000-0000-4000-8000-000000000001",
  ref_id: "r1",
  platform: "meta",
  lane: "consumer",
  state: "ready",
  capability: "create_and_real_preview",
  cached: true,
  retryable: false,
  started_at: null,
  last_checked_at: null,
  deadline_at: null,
  elapsed_seconds: 0,
  retry_after_seconds: null,
  preview: null,
  error: null,
};

describe("#4238 Host Start my ad with a ready video", () => {
  it("reaches admin-ad-create-campaign (validate, then create) when prepare says ready", async () => {
    const calls: { name: string; body: Record<string, unknown> }[] = [];
    (supabase.functions.invoke as jest.Mock).mockImplementation(
      async (name: string, { body }: { body: Record<string, unknown> }) => {
        calls.push({ name, body });
        if (name === "ad-plan" && body.action === "get") return { data: AGGREGATE, error: null };
        if (name === "ad-plan") return { data: { ok: true }, error: null };
        if (name === "admin-ad-creative-prepare") return { data: PREPARE_READY, error: null };
        if (name === "admin-ad-create-campaign") {
          return body.validate_only === true
            ? { data: { validated: true }, error: null }
            : { data: { campaign_id: "c1" }, error: null };
        }
        if (name === "host-ad-campaign") return { data: { ok: true }, error: null };
        return { data: null, error: new Error(`unexpected ${name}`) };
      },
    );

    let outcome: unknown;
    try {
      outcome = await launchHostAdPlan({ planId: "p1", versionId: "v1", planHash: HASH });
    } catch (cause) {
      outcome = { threw: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause) };
    }

    const creates = calls.filter((call) => call.name === "admin-ad-create-campaign");
    const recordedFailure = calls.some(
      (call) => call.name === "ad-plan" && call.body.action === "record_create_failure",
    );
    expect({ outcome, creates: creates.length, recordedFailure }).toEqual({
      outcome: expect.objectContaining({ state: "launched" }),
      creates: 2,
      recordedFailure: false,
    });
    expect(creates[0].body.validate_only).toBe(true);
    expect(creates[1].body.validate_only).toBeUndefined();
  });
});
