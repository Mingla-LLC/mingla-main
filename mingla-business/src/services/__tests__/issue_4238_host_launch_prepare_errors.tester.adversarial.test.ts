/**
 * #4238 wave 2 retest 3 — TESTER adversarial. The rework (1d10a2cf8) made a
 * ready prepare envelope (`error: null`) count as success. This pins the two
 * prepare answers that are NOT success, seen live on the local stack:
 *
 * A. admin-ad-creative-prepare answers non-2xx with its own `{ error, trace_id }`
 *    body (no detail, no message), e.g. 503 connection_lookup_failed. invoke()
 *    falls back to the SDK's own text, and the Host reads "Edge Function
 *    returned a non-2xx status code" on the review screen.
 * B. prepare answers 200 with `state: "failed"` and an error OBJECT. invoke()
 *    still throws on any non-null `error`, so the loop's one retry never runs
 *    and the Host gets the generic "The campaign could not launch." instead of
 *    the video copy the loop writes.
 */
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import { supabase } from "../supabase";
// eslint-disable-next-line import/first
import { launchHostAdPlan } from "../hostAdPlanService";
// eslint-disable-next-line import/first
import { hostAdErrorMessage } from "../../components/marketing/ads/hostAdCopy";

const HASH = "e".repeat(64);
const LAUNCH_FALLBACK = "The campaign could not launch.";
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

/** admin-ad-creative-prepare's envelope() for a video the app could not process. */
const PREPARE_FAILED = {
  trace_id: "t1",
  creative_library_id: "a4238000-0000-4000-8000-000000000001",
  ref_id: "r1",
  platform: "meta",
  lane: "consumer",
  state: "failed",
  capability: "create_and_real_preview",
  cached: true,
  retryable: false,
  started_at: null,
  last_checked_at: null,
  deadline_at: null,
  elapsed_seconds: 300,
  retry_after_seconds: null,
  preview: null,
  error: {
    code: "provider_terminal",
    message: "The platform could not process this video. Retry this platform.",
    trace_id: "t1",
  },
};

/** What supabase-js hands back for a non-2xx edge answer (FunctionsHttpError). */
function edgeHttpError(status: number, body: Record<string, unknown>) {
  return Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: { status, json: async () => body },
  });
}

type Call = { name: string; body: Record<string, unknown> };

function mockEdges(prepare: (body: Record<string, unknown>) => { data: unknown; error: unknown }): Call[] {
  const calls: Call[] = [];
  (supabase.functions.invoke as jest.Mock).mockImplementation(
    async (name: string, { body }: { body: Record<string, unknown> }) => {
      calls.push({ name, body });
      if (name === "ad-plan" && body.action === "get") return { data: AGGREGATE, error: null };
      if (name === "ad-plan") return { data: { ok: true }, error: null };
      if (name === "admin-ad-creative-prepare") return prepare(body);
      if (name === "admin-ad-create-campaign") return { data: { validated: true }, error: null };
      if (name === "host-ad-campaign") return { data: { ok: true }, error: null };
      return { data: null, error: new Error(`unexpected ${name}`) };
    },
  );
  return calls;
}

async function hostCopyAfterStart(): Promise<string> {
  try {
    await launchHostAdPlan({ planId: "p1", versionId: "v1", planHash: HASH });
  } catch (cause) {
    // Exactly what the review screen shows (create.tsx handleLaunch).
    return hostAdErrorMessage(cause, LAUNCH_FALLBACK);
  }
  return "(launched)";
}

describe("#4238 Host Start my ad when the video handoff fails", () => {
  afterEach(() => jest.clearAllMocks());

  it("A: a non-2xx prepare answer never shows the SDK's technical text", async () => {
    const calls = mockEdges(() => ({
      data: null,
      error: edgeHttpError(503, { error: "connection_lookup_failed", trace_id: "t2" }),
    }));
    const copy = await hostCopyAfterStart();
    expect(calls.some((c) => c.name === "admin-ad-create-campaign")).toBe(false);
    expect(copy).not.toMatch(/edge function|non-2xx|status code/i);
    expect(copy).not.toBe("(launched)");
  });

  it("B: a failed video is retried once, then the Host reads the video copy", async () => {
    const calls = mockEdges(() => ({ data: PREPARE_FAILED, error: null }));
    const copy = await hostCopyAfterStart();
    const prepareActions = calls
      .filter((c) => c.name === "admin-ad-creative-prepare")
      .map((c) => c.body.action);
    expect({
      retried: prepareActions.includes("retry"),
      creates: calls.filter((c) => c.name === "admin-ad-create-campaign").length,
      mentionsVideo: /video/i.test(copy),
      genericFallback: copy === LAUNCH_FALLBACK,
      raw: /[{}_]/.test(copy),
    }).toEqual({
      retried: true,
      creates: 0,
      mentionsVideo: true,
      genericFallback: false,
      raw: false,
    });
  });
});
