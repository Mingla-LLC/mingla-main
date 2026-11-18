/*
 * #4453 milestone 10 — L3 tester adversarial proof of Studio's plan preview.
 * Attacks angles the implementor suite does not: Build-vs-preview equality
 * when Core's no-site facts differ from Build's site facts (SC-PP4), the
 * zero-listing page list (SC-PP4 + samples), writes made through the DEFAULT
 * font pipeline on a font-cache miss (SC-PP1), and sneaking sample content
 * past assertArtifactV2 (SC-PP3).
 */
import { describe, expect, it, vi } from "vitest";

const objectWrites: string[] = [];
vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket", approvedBucket: "approved-bucket", googleFonts: {} }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({ readCoreProjection: async () => { throw new Error("PLAN_MODE_MUST_NOT_CALL_CORE"); } }));
vi.mock("./objectStore", () => ({
  writeObject: async (_bucket: string, key: string) => { objectWrites.push(key); },
  readObject: async () => { throw new Error("NOT_FOUND"); },
}));

import { assertArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { containsSampleContent, splitPlanArtifact } from "../contracts/generated/planPreview.ts";
import { composeFormatSite } from "./composeFormat";
import { inventoryAndSources, parseSignedDesignPass } from "./designPassInputs";
import { composePlan, pageSequence, parsePlanPreviewBody, runPlanPreview, type PlanPreviewStore } from "./planPreview";
// Core's facts builder (rework: the no-site facts come from the real Core code, not a literal).
import { composeFacts } from "../../../supabase/functions/brand-site-control/designPass.ts";

const BRAND = "00000000-0000-4000-8000-0000000020b1";
const NO_RECORDS = { photos: [], destination_ids: [], stories: 0, confirmed_reviews: 0, ready_videos: 0, has_logo: false } as never;
const brand = { name: "Tester Brand", tagline: "Go far.", bio: "Small-group trips.", contact_email: "hello@tester.example", city: "London" };
const answers = { value_points: [{ title: "Two guides", sentence: "A guide travels with every group." }], faq: [], process_steps: [], quick_facts: null };
const baseFacts = () => ({
  upcoming: { trip: 0, event: 0, experience: 0 }, ended: { trip: 0, event: 0, experience: 0 }, next_offering: {}, bookable: {},
  verified_venues: {}, venue_id: {}, venue_reservations_on: {}, open_venue_slots: {}, published_menu: false, live_stay_offerings: 0,
  public_ticket_tiers: 0, mingla_reviews: 0,
});
const EMPTY_FEED = { generated_at: new Date().toISOString(), brand: { slug: "tester", currency: "GBP", payment_rails: "stripe" }, offerings: [] };

/** What Build (compose-from-plan) composes from the same plan with Core's site facts. */
function buildCompose(style: string, plan: Record<string, unknown>, facts: Record<string, unknown>) {
  const signed = parseSignedDesignPass({ design_key: style, plan, answers, address: null, facts, style_library: true, live_fingerprints: [] })!;
  const { inventory, sources } = inventoryAndSources({ signed, records: NO_RECORDS, offerings_selected: signed.plan!.offerings_selected, brand, cover_media_id: null });
  return composeFormatSite({ plan: signed.plan!, answers: signed.answers, brand, design: style as never, inventory, sources, existing: [], currentWordmark: null })!;
}
const pageList = (composed: { pages: { slug: string }[] }) => composed.pages.map((page) => page.slug);

describe("#4453 M10 tester — Studio plan preview, adversarial", () => {
  it("SC-PP4 zero listings: the preview's PAGE LIST and MENU equal what Build composes for the same brand (samples aside)", () => {
    const plan = { offerings_selected: ["trips"], venue_descriptor: null, story: { main_action: "Reserve the next trip" } };
    const body = parsePlanPreviewBody({ kind: "plan_preview", brand_id: BRAND, plan_revision: 1, format: "trips", styles: ["voyage"], plan, answers, brand, address: null, facts: baseFacts(), feed: EMPTY_FEED, live_fingerprints: [] }, BRAND)!;
    const preview = composePlan(body, "voyage");
    expect(preview.samples).not.toBeNull();
    const build = buildCompose("voyage", plan, baseFacts());
    expect(pageList(preview.composed!)).toEqual(pageList(build));
    expect(preview.composed!.menu).toEqual(build.menu);
  });

  it("SC-PP4 deviation 2: Core's no-site facts give the SAME type:variant sequence as Build's site facts for the same brand", async () => {
    const plan = { offerings_selected: ["trips"], venue_descriptor: null, story: { main_action: "Reserve the next trip" } };
    const tripId = "11111111-1111-4111-8111-000000000001";
    const feed = { ...EMPTY_FEED, offerings: [{ id: tripId, kind: "trip", slug: "porto", title: "Porto in spring", summary: null, cover: null, destination_text: "Porto",
      start_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), end_at: null, timezone: "Europe/London", status: "scheduled", bookings_closed: false,
      capacity: 12, spots_left: 5, group_minimum: null, min_price_minor: 69000, currency: "GBP", has_free_tier: false,
      public_url: "https://host.usemingla.com/t/tester/porto", waitlist_enabled: false, installments_available: false }] };
    // One fake database for the brand: 4 open departures in the next 14 days and 12 Mingla reviews.
    // Site reads (Build, site now exists) and their brand twins (plan preview, no site) answer from it.
    const SITE = "22222222-2222-4222-8222-000000000001";
    const db = (fn: string, args: Record<string, unknown>) => {
      const scoped = args.p_site_id === SITE || args.p_brand_id === BRAND;
      if (!scoped) return { data: null, error: null };
      const base = fn.replace(/_for_brand$/, "");
      if (base === "brand_site_compose_facts") return { data: { venues: {}, published_menu: false, mingla_reviews: 12 }, error: null };
      if (base === "brand_site_offering_dates" && args.p_offering_id === tripId) {
        return { data: { days: [{ local_date: "2099-01-01", slots: [{ state: "open" }, { state: "few" }, { state: "open" }, { state: "open" }, { state: "full" }] }] }, error: null };
      }
      return { data: null, error: null };
    };
    const rpc = async (fn: string, args: Record<string, unknown>) => db(fn, args);
    // Core's REAL composeFacts: the plan preview (no site yet: by brand) and Build (by site).
    const noSite = await composeFacts(rpc, { brandId: BRAND }, feed.offerings);
    const withSite = await composeFacts(rpc, SITE, feed.offerings);
    expect(withSite.bookable).toEqual({ trip: 4 });
    expect(withSite.mingla_reviews).toBe(12);
    const body = parsePlanPreviewBody({ kind: "plan_preview", brand_id: BRAND, plan_revision: 1, format: "trips", styles: ["voyage"], plan, answers, brand, address: null, facts: noSite, feed, live_fingerprints: [] }, BRAND)!;
    const preview = composePlan(body, "voyage").composed!;
    const build = buildCompose("voyage", plan, withSite);
    expect(pageSequence(preview)).toEqual(pageSequence(build));
  });

  it("SC-PP1 a font-cache miss through the DEFAULT font pipeline writes nothing outside plan-previews/", async () => {
    objectWrites.length = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string) => {
      const url = new URL(String(input));
      if (url.hostname === "fonts.googleapis.com") {
        const family = decodeURIComponent((url.searchParams.get("family") ?? "").split(":")[0]!).replace(/\+/g, " ");
        const css = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) =>
          `/* latin */\n@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; src: url(https://fonts.gstatic.com/s/x${weight}.woff2) format('woff2'); unicode-range: U+0000-00FF; }`).join("\n");
        return new Response(css, { status: 200, headers: { "content-type": "text/css" } });
      }
      return new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, url.pathname.length]), { status: 200 });
    }) as typeof fetch;
    const store: PlanPreviewStore & { keys: string[] } = {
      keys: [], write: async (key) => { store.keys.push(key); }, read: async () => null, list: async () => [], remove: async () => {},
    };
    // the Studio font store has no cached faces yet; Payload writes are blocked by the preview's own proxy
    const payload = { find: async () => ({ docs: [], totalDocs: 0, hasNextPage: false }), create: async () => ({}), update: async () => ({}), delete: async () => ({}) };
    const plan = { offerings_selected: ["trips"], venue_descriptor: null, story: { main_action: "Reserve the next trip" } };
    const body = parsePlanPreviewBody({ kind: "plan_preview", brand_id: BRAND, plan_revision: 1, format: "trips", styles: ["voyage"], plan, answers, brand, address: null, facts: baseFacts(), feed: EMPTY_FEED, live_fingerprints: [] }, BRAND)!;
    try {
      // the endpoint passes no fontPipeline (planPreviewEndpoint.ts), so the builder uses payloadFontPipeline(req)
      await runPlanPreview(body, { store: { ...store, read: async (key) => (store.keys.includes(key) ? new Uint8Array() : null) }, req: { context: {}, payload } as never }).catch(() => null);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(objectWrites.filter((key) => !key.startsWith("plan-previews/"))).toEqual([]);
  });

  it("SC-PP3 sample content cannot be sneaked past assertArtifactV2 by nesting it deep", () => {
    let nested: Record<string, unknown> = { sample: true };
    for (let depth = 0; depth < 45; depth += 1) nested = { x: nested };
    expect(containsSampleContent(nested)).toBe(true);
  });

  it("SC-PP3 a plan artifact with samples never validates as a publishable artifact, even with the marker renamed", () => {
    const plan = { offerings_selected: ["trips"], venue_descriptor: null, story: { main_action: "Reserve the next trip" } };
    const art = { preview_kind: "plan", plan_samples: { strip: "x", listings: [] } };
    expect(() => assertArtifactV2(art)).toThrow("SAMPLE_CONTENT_IN_ARTIFACT");
    expect(() => splitPlanArtifact({ preview_kind: "plan", plan_samples: { strip: "Sample listings. Your real Mingla listings replace these when you add them.", listings: [{ sample: true, kind: "trip", title: "<script>", summary: "x" }] } })).toThrow("NOT_PLAN_PREVIEW");
    void plan;
  });
});
