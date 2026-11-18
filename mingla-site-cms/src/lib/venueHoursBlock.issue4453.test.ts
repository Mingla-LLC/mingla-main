/*
 * #4453 — a venue with an address but no opening hours.
 *
 * The "Find us" block (hours_location) needs at least one row of hours: the
 * public contract and Studio's own block both refuse an empty list. The
 * composer used to add it from the address alone, so every venue's plan
 * preview (and Build) failed with ARTIFACT_BLOCK_CONTENT_MISMATCH:
 * hours_location.hours. Found live on Gameland Lagos, 2026-11-18: "See your
 * site in three styles" answered "Couldn't load the previews" for every style.
 *
 * Then, once its venue was verified with reservations, a menu, bookable
 * dates and a ticket on sale, every preview failed again with
 * VALIDATION_FAILED: the preview handed the builder a row for every
 * offering_id on the page, while the builder counts only a block's
 * offering_ids list.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({ readCoreProjection: async () => { throw new Error("PLAN_MODE_MUST_NOT_CALL_CORE"); } }));
vi.mock("./objectStore", () => ({
  writeObject: async () => { throw new Error("PLAN_MODE_MUST_NOT_WRITE_PUBLICATIONS"); },
  readObject: async () => { throw new Error("PLAN_MODE_MUST_NOT_READ_PUBLICATIONS"); },
}));

import { composeFormatSite, type ComposeV2Input } from "./composeFormat";
import { EMPTY_INVENTORY } from "../contracts/generated/sectionSources.ts";
import { parsePlanPreviewBody, runPlanPreview, type PlanPreviewStore } from "./planPreview";
import type { FontPipelineDeps } from "./fontAssets";

const BRAND = "a14c4f10-a6c6-4443-969c-bfa358b79883";
const ADDRESS = "14 The Providence St, Lekki Phase I, Lekki 101222, Lagos, Nigeria";
const offering = (n: number, kind: "event" | "experience") => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, kind, slug: `${kind}-${n}`, title: `${kind} ${n}`,
  summary: "Over 100 games on an open-air turf.", cover: null, destination_text: "Lagos, NG",
  start_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), end_at: null, timezone: "Africa/Lagos", status: "scheduled",
  bookings_closed: false, capacity: null, spots_left: null, group_minimum: null, min_price_minor: 500000, currency: "NGN",
  has_free_tier: false, public_url: `https://host.usemingla.com/exp/gameland-lagos/${kind}-${n}`, waitlist_enabled: false, installments_available: false,
});
const FEED = { generated_at: new Date().toISOString(), brand: { slug: "gameland-lagos", currency: "NGN", payment_rails: "paystack" }, offerings: [offering(1, "experience"), offering(2, "experience"), offering(3, "event")] };
const plan = { offerings_selected: ["events", "experiences"], venue_descriptor: null, story: { who: "Friends and work teams in Lagos.", why: "Over 100 games in one place.", main_action: "Book an experience" } };
const answers = { value_points: [], faq: [], process_steps: [], quick_facts: null };
const brand = { name: "Gameland Lagos", tagline: "Lagos' favourite outdoor playground", bio: "Gameland is Lagos' favourite outdoor games centre.", contact_email: "support@usemingla.com", city: "Lagos" };
const facts = { upcoming: { trip: 0, event: 1, experience: 2 }, ended: { trip: 0, event: 0, experience: 0 }, next_offering: { event: FEED.offerings[2]!.id, experience: FEED.offerings[0]!.id }, bookable: {}, mingla_reviews: 0 };
const offlineFonts: FontPipelineDeps = {
  fetch: (async () => { throw new Error("NO_NETWORK_IN_TESTS"); }) as typeof fetch,
  storeFont: async () => {},
  cachedFaces: async (key) => key.split("|")[1]!.split(",").map((weight, index) => ({
    family: key.split("|")[0]!, weight: Number(weight), style: "normal" as const, unicode_range: "U+0000-00FF", digest: String(index).padEnd(64, "b"), bytes: 1000,
  })),
  saveFaces: async () => {},
};
function store(): PlanPreviewStore {
  const objects = new Map<string, Uint8Array>();
  return {
    write: async (key, bytes) => { objects.set(key, bytes); },
    read: async (key) => objects.get(key) ?? null,
    list: async () => [],
    remove: async (key) => { objects.delete(key); },
  };
}
const req = { context: {}, payload: { find: async () => ({ docs: [], totalDocs: 0 }) } } as never;

function input(hours?: { day: string; value: string }[]): ComposeV2Input {
  return {
    plan, answers, brand, design: "voyage", inventory: EMPTY_INVENTORY,
    sources: { cover_media_id: null, photos: [], destination_ids: [], next_offering: facts.next_offering, bookable: {}, venue_id: {}, stay_offering_id: null, address: ADDRESS, ...(hours ? { hours } : {}) },
    existing: [], currentWordmark: null,
  };
}
const blockTypes = (result: ReturnType<typeof composeFormatSite>) => result!.pages.flatMap((page) => page.blocks.map((block) => block.blockType));

describe("#4453 a venue's Find us block", () => {
  it("is left out when only the address is known (never sent without hours)", () => {
    expect(blockTypes(composeFormatSite(input()))).not.toContain("hours_location");
  });

  it("carries the real hours when they are known", () => {
    const result = composeFormatSite(input([{ day: "Every day", value: "12pm to 12am" }]));
    const block = result!.pages.flatMap((page) => page.blocks).find((entry) => entry.blockType === "hours_location");
    expect(block).toBeDefined();
    expect(block).toMatchObject({ address: ADDRESS, hours: [{ day: "Every day", value: "12pm to 12am" }] });
  });

  it("the plan preview of a venue with an address builds in every offered style (the Gameland regression)", async () => {
    for (const style of ["voyage", "terra", "journal", "haven", "pop", "maison", "sunset", "nocturne"]) {
      const body = parsePlanPreviewBody({ kind: "plan_preview", brand_id: BRAND, plan_revision: 7, format: "experiences", styles: [style], plan, answers, brand, address: ADDRESS, facts, feed: FEED, live_fingerprints: [] }, BRAND);
      if (!body) continue; // an "avoid" style for this format is refused before composing
      const result = await runPlanPreview(body, { store: store(), req, fontPipeline: offlineFonts });
      expect(result.previews.map((preview) => preview.style)).toEqual([style]);
    }
  });
});

const realFacts = {
  upcoming: { trip: 0, event: 1, experience: 3 }, ended: { trip: 0, event: 0, experience: 0 },
  next_offering: { event: FEED.offerings[2]!.id, experience: FEED.offerings[0]!.id },
  bookable: { event: 1, experience: 14 }, venue_id: { play: "61dbdc6c-8926-46b4-978d-a3f4cdbd7b08" }, verified_venues: { play: 1 },
  venue_reservations_on: { play: true }, open_venue_slots: { play: 12 }, published_menu: true, live_stay_offerings: 0, stay_offering_id: null,
  public_ticket_tiers: 1, mingla_reviews: 0,
};
const realAnswers = {
  value_points: [{ title: "100+ games in one place", sentence: "PS5 and Xbox, pool and more." }, { title: "Karaoke every Friday", sentence: "Every Friday from 6pm." }, { title: "Food, drinks and space to hire", sentence: "Kitchen and bar." }],
  faq: [{ question: "What are your opening hours?", answer: "Every day from 12pm to 12am." }, { question: "Where are you?", answer: "The Lekki Coliseum." }],
  process_steps: [{ title: "Book your pass", text: "Pay on Mingla." }, { title: "Show it at the gate", text: "Your ticket gets you in." }, { title: "Play all day", text: "Unlimited play." }],
  quick_facts: null,
};
describe("#4453 a live venue: bookable dates, a ticket on sale, reservations and a menu (Gameland, 2026-11-18)", () => {
  for (const style of ["voyage", "terra", "journal", "haven", "pop", "maison", "sunset", "nocturne", "grid", "pulse"]) {
    it(`builds the ${style} preview`, async () => {
      const body = parsePlanPreviewBody({ kind: "plan_preview", brand_id: BRAND, plan_revision: 9, format: "experiences", styles: [style], plan, answers: realAnswers, brand, address: ADDRESS, facts: realFacts, feed: FEED, live_fingerprints: [] }, BRAND);
      if (!body) return; // an "avoid" style for this format is refused before composing
      const result = await runPlanPreview(body, { store: store(), req, fontPipeline: offlineFonts });
      expect(result.previews.map((preview) => preview.style)).toEqual([style]);
    });
  }
});
