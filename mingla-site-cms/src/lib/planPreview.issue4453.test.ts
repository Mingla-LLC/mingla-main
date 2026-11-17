/*
 * #4453 milestone 10 — Studio's plan preview (composer v2 dry run + the real
 * builder in plan mode, in memory).
 *
 * invariant: I-SITES-PLAN-PREVIEW-WRITES-NOTHING — a plan preview creates or
 * changes no Payload document (pages, site settings, navigation, media, work
 * log); its only writes are object-store keys under `plan-previews/`.
 * invariant: I-SITES-SAMPLE-NEVER-PUBLISHED — sample listings live only in a
 * plan artifact's `plan_samples`; assertArtifactV2 (publication, site preview
 * and share) refuses SAMPLE_CONTENT_IN_ARTIFACT; Build never reads a sample pack.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({ readCoreProjection: async () => { throw new Error("PLAN_MODE_MUST_NOT_CALL_CORE"); } }));
vi.mock("./objectStore", () => ({
  writeObject: async () => { throw new Error("PLAN_MODE_MUST_NOT_WRITE_PUBLICATIONS"); },
  readObject: async () => { throw new Error("PLAN_MODE_MUST_NOT_READ_PUBLICATIONS"); },
}));

import { assertArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { parsePlanPreviewKey, splitPlanArtifact, SAMPLE_STRIP } from "../contracts/generated/planPreview.ts";
import { composeFormatSite } from "./composeFormat";
import { inventoryAndSources, parseSignedDesignPass } from "./designPassInputs";
import { composePlan, pageSequence, parsePlanPreviewBody, prunePlanPreviews, runPlanPreview, type PlanPreviewStore } from "./planPreview";
import type { FontPipelineDeps } from "./fontAssets";

const BRAND = "00000000-0000-4000-8000-0000000010b1";
const trip = (n: number, startDays: number, status: string) => ({
  id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`, kind: "trip", slug: `trip-${n}`,
  title: ["Porto in spring", "The Dolomites", "Lisbon long weekend"][n - 1]!, summary: "Small-group trip with two local guides.", cover: null,
  destination_text: "Porto", start_at: new Date(Date.now() + startDays * 86_400_000).toISOString(), end_at: new Date(Date.now() + (startDays + 6) * 86_400_000).toISOString(),
  timezone: "Europe/London", status, bookings_closed: false, capacity: 12, spots_left: 5, group_minimum: null,
  min_price_minor: 69000, currency: "GBP", has_free_tier: false, public_url: `https://host.usemingla.com/t/youngandstamped/trip-${n}`,
  waitlist_enabled: false, installments_available: true,
});
const FEED = { generated_at: new Date().toISOString(), brand: { slug: "youngandstamped", currency: "GBP", payment_rails: "stripe" }, offerings: [trip(1, 30, "scheduled"), trip(2, 60, "scheduled"), trip(3, 90, "scheduled")] };
const EMPTY_FEED = { ...FEED, offerings: [] };
const plan = { offerings_selected: ["trips"], venue_descriptor: null, story: { who: "People who want to travel together", why: "Go far. Go together.", main_action: "Reserve the next trip" } };
const answers = {
  value_points: [{ title: "Two guides, every trip", sentence: "A local guide and a trip lead travel with every group." }, { title: "Twelve people", sentence: "Small enough to know everyone." }, { title: "Every night booked", sentence: "We book the beds." }],
  faq: [{ question: "Can I come on my own?", answer: "Most people do." }], process_steps: [], quick_facts: null,
};
const facts = (feed: typeof FEED) => ({
  upcoming: { trip: feed.offerings.length, event: 0, experience: 0 }, ended: { trip: 0, event: 0, experience: 0 },
  next_offering: feed.offerings[0] ? { trip: feed.offerings[0].id } : {}, bookable: {}, mingla_reviews: 0,
});
const brand = { name: "Young and Stamped", tagline: "Go far. Go together.", bio: "Small-group trips.", contact_email: "hello@youngandstamped.example", city: "London" };
const raw = (feed: typeof FEED, styles = ["voyage", "terra", "journal"]) => ({
  kind: "plan_preview", brand_id: BRAND, plan_revision: 7, format: "trips", styles, plan, answers, brand, address: null, facts: facts(feed), feed, live_fingerprints: [],
});
const offlineFonts: FontPipelineDeps = {
  fetch: (async () => { throw new Error("NO_NETWORK_IN_TESTS"); }) as typeof fetch,
  storeFont: async () => {},
  cachedFaces: async (key) => key.split("|")[1]!.split(",").map((weight, index) => ({
    family: key.split("|")[0]!, weight: Number(weight), style: "normal" as const, unicode_range: "U+0000-00FF", digest: String(index).padEnd(64, "b"), bytes: 1000,
  })),
  saveFaces: async () => {},
};
function memoryStore(): PlanPreviewStore & { objects: Map<string, { bytes: Uint8Array; at: string }>; writes: string[] } {
  const objects = new Map<string, { bytes: Uint8Array; at: string }>();
  const writes: string[] = [];
  let tick = 0;
  return {
    objects, writes,
    write: async (key, bytes) => { writes.push(key); objects.set(key, { bytes, at: new Date(Date.UTC(2026, 10, 16, 0, 0, tick++)).toISOString() }); },
    read: async (key) => objects.get(key)?.bytes ?? null,
    list: async (prefix) => [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, lastModified: value.at })),
    remove: async (key) => { objects.delete(key); },
  };
}
function spyReq() {
  const writes: string[] = [];
  const payload = {
    find: async () => ({ docs: [], totalDocs: 0 }),
    create: async ({ collection }: { collection: string }) => { writes.push(`create:${collection}`); return {}; },
    update: async ({ collection }: { collection: string }) => { writes.push(`update:${collection}`); return {}; },
    delete: async ({ collection }: { collection: string }) => { writes.push(`delete:${collection}`); return {}; },
  };
  return { req: { context: {}, payload } as never, writes };
}

describe("#4453 M10 Studio plan preview", () => {
  it("builds three valid plan artifacts and writes only plan-previews/ objects (no Payload document)", async () => {
    const body = parsePlanPreviewBody(raw(FEED), BRAND)!;
    const store = memoryStore();
    const { req, writes } = spyReq();
    const result = await runPlanPreview(body, { store, req, fontPipeline: offlineFonts });
    expect(result.previews.map((preview) => preview.style)).toEqual(["voyage", "terra", "journal"]);
    expect(writes).toEqual([]);
    for (const key of store.writes) expect(key.startsWith(`plan-previews/${BRAND}/`)).toBe(true);
    for (const preview of result.previews) {
      expect(parsePlanPreviewKey(preview.key)?.brandId).toBe(BRAND);
      const artifact = JSON.parse(new TextDecoder().decode(store.objects.get(preview.key)!.bytes));
      expect(artifact.preview_kind).toBe("plan");
      expect(artifact.plan_samples).toBeUndefined();
      const { body: v2 } = splitPlanArtifact(artifact);
      expect(() => assertArtifactV2(v2)).not.toThrow();
      expect(artifact.design.key).toBe(preview.style);
      expect(artifact.offerings_snapshot.map((row: { id: string }) => row.id)).toEqual(FEED.offerings.map((row) => row.id));
      expect(preview.page_labels[0]).toBe("Home");
    }
    expect(result.has_samples).toBe(false);
  });

  it("SC-PP4: the preview's pages, menu and type:variant sequence equal what Build composes", () => {
    const body = parsePlanPreviewBody(raw(FEED), BRAND)!;
    for (const style of body.styles) {
      const preview = composePlan(body, style).composed!;
      const signed = parseSignedDesignPass({ design_key: style, plan, answers, address: null, facts: facts(FEED), style_library: true, live_fingerprints: [] })!;
      const { inventory, sources } = inventoryAndSources({ signed, records: { photos: [], destination_ids: [], stories: 0, confirmed_reviews: 0, ready_videos: 0, has_logo: false } as never, offerings_selected: signed.plan!.offerings_selected, brand, cover_media_id: null });
      const build = composeFormatSite({ plan: signed.plan!, answers: signed.answers, brand, design: style, inventory, sources, existing: [], currentWordmark: null })!;
      expect(pageSequence(preview)).toEqual(pageSequence(build));
      expect(preview.menu).toEqual(build.menu);
    }
  });

  it("SC-PP3: zero listings → labelled samples in plan_samples only; publish/preview validators refuse them; Build never reads a pack", async () => {
    const body = parsePlanPreviewBody(raw(EMPTY_FEED, ["voyage"]), BRAND)!;
    const store = memoryStore();
    const result = await runPlanPreview(body, { store, req: spyReq().req, fontPipeline: offlineFonts });
    expect(result.has_samples).toBe(true);
    const artifact = JSON.parse(new TextDecoder().decode(store.objects.get(result.previews[0]!.key)!.bytes));
    expect(artifact.plan_samples.strip).toBe(SAMPLE_STRIP);
    expect(artifact.plan_samples.listings.length).toBeGreaterThan(0);
    for (const row of artifact.plan_samples.listings) {
      expect(row.sample).toBe(true);
      expect(Object.keys(row).sort()).toEqual(["kind", "sample", "summary", "title"]);
    }
    expect(artifact.offerings_snapshot).toEqual([]);
    expect(() => assertArtifactV2(artifact)).toThrow("SAMPLE_CONTENT_IN_ARTIFACT");
    const { body: v2 } = splitPlanArtifact(artifact);
    expect(() => assertArtifactV2({ ...v2, offerings_snapshot: [{ ...FEED.offerings[0], sample: true }] })).toThrow("SAMPLE_CONTENT_IN_ARTIFACT");
    for (const file of ["composeFormat.ts", "designPassWrite.ts", "designPassInputs.ts", "../endpoints/composeEndpoint.ts", "artifactBuilder.ts"]) {
      expect(readFileSync(join(__dirname, file), "utf8")).not.toMatch(/samplePacks/);
    }
  });

  it("refuses a ✕ style, an envelope for another brand and unknown keys", () => {
    expect(parsePlanPreviewBody(raw(FEED, ["pulse"]), BRAND)).toBeNull();
    expect(parsePlanPreviewBody(raw(FEED), "00000000-0000-4000-8000-0000000010b2")).toBeNull();
    expect(parsePlanPreviewBody({ ...raw(FEED), site_id: BRAND }, BRAND)).toBeNull();
    expect(parsePlanPreviewBody(raw(FEED, ["voyage", "terra", "journal", "haven"]), BRAND)).toBeNull();
  });

  it("a repeat request within 24 h reuses the stored keys; at most 9 live objects per brand", async () => {
    const body = parsePlanPreviewBody(raw(FEED), BRAND)!;
    const store = memoryStore();
    const first = await runPlanPreview(body, { store, req: spyReq().req, fontPipeline: offlineFonts });
    const writes = store.writes.length;
    const again = await runPlanPreview(body, { store, req: spyReq().req, fontPipeline: offlineFonts });
    expect(again.cached).toBe(true);
    expect(again.previews.map((p) => p.key)).toEqual(first.previews.map((p) => p.key));
    expect(store.writes.length).toBe(writes);
    for (let i = 0; i < 12; i += 1) await store.write(`plan-previews/${BRAND}/plan-${String(i).padStart(32, "a")}/${"f".repeat(64)}.json`, new Uint8Array([1]));
    await prunePlanPreviews(store, BRAND);
    const left = (await store.list(`plan-previews/${BRAND}/`)).filter((row) => parsePlanPreviewKey(row.key));
    expect(left.length).toBe(9);
  });
});
