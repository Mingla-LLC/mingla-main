/*
 * #4453 — the plan preview and Build compose every kind of brand (property
 * test). Was: one live failure per deploy (a Find us block with no hours, an
 * offering-row count mismatch, Atelier given blocks it does not draw).
 * Every plan below must preview, validate as an artifact and satisfy
 * Studio's own block rules (what Build saves); the only refusals allowed
 * are the "avoid" style pairs Core and Host never request.
 *
 * Origin note: #4453 — a venue with an address but no opening hours.
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
import { siteBlocks } from "../blocks/siteBlocks";
import { composePlan, parsePlanPreviewBody, runPlanPreview, type PlanPreviewStore } from "./planPreview";
import type { FontPipelineDeps } from "./fontAssets";


import { FORMAT_KEYS, primaryFormat } from "../contracts/generated/formats.ts";
import { DESIGN_KEYS } from "../contracts/generated/designs.ts";
import { mainActionChips, mainActionPage } from "../contracts/generated/sitePlan.ts";

const BRAND = "a14c4f10-a6c6-4443-969c-bfa358b79883";
let seed = 31337;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
const chance = (p: number) => rnd() < p;
const OFFERINGS = ["trips", "events", "experiences", "venue_food_drink", "venue_play", "venue_creative_arts", "venue_stay"];
const KINDS = ["trip", "event", "experience"] as const;
const longText = (n: number) => ("Lagos' favourite ₦ playground — émoji 🎉 & \"quotes\". ").repeat(Math.ceil(n / 50)).slice(0, n);
let n = 1;
const uid = () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
function offering() {
  const kind = pick(KINDS);
  const startDays = pick([-30, -1, 0, 1, 7, 90]);
  const status = pick(["scheduled", "scheduled", "scheduled", "cancelled", "ended", "sold_out"]);
  return {
    id: uid(), kind, slug: `${kind}-${n}`, title: chance(0.2) ? longText(120) : `${kind} ${n}`,
    summary: pick([null, "Short.", longText(500)]),
    cover: pick([null, { path: `event_covers/x/${n}.jpg`, type: "image" }, { path: `event_covers/x/${n}.mp4`, type: "video" }]),
    destination_text: pick([null, "Lagos, NG", longText(200)]),
    start_at: new Date(Date.now() + startDays * 86_400_000).toISOString(),
    end_at: chance(0.5) ? null : new Date(Date.now() + (startDays + 1) * 86_400_000).toISOString(),
    timezone: pick(["Africa/Lagos", "Europe/London", "America/New_York"]), status,
    bookings_closed: chance(0.2), capacity: pick([null, 0, 50, 500]), spots_left: pick([null, 0, 5]), group_minimum: pick([null, 2]),
    min_price_minor: pick([0, 500000, 400000000]), currency: pick(["NGN", "NGN", "GBP", "USD"]), has_free_tier: chance(0.3),
    public_url: `https://host.usemingla.com/e/brand/${kind}-${n}`, waitlist_enabled: chance(0.2), installments_available: chance(0.2),
  };
}
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



type PField = { name?: string; type?: string; required?: boolean; minRows?: number; maxRows?: number; maxLength?: number; fields?: PField[]; options?: unknown[] };
const BLOCK_RULES = new Map(siteBlocks.map((b) => [b.slug, b.fields as unknown as PField[]]));
function payloadProblems(type: string, value: Record<string, unknown>, fields: PField[], path: string, out: string[]) {
  for (const f of fields) {
    if (!f.name) { if (f.fields) payloadProblems(type, value, f.fields, path, out); continue; }
    const v = value[f.name];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (f.required && empty && f.type !== "checkbox") out.push(`${type}.${path}${f.name} required`);
    if (f.type === "array" && Array.isArray(v)) {
      if (f.minRows && v.length < f.minRows) out.push(`${type}.${path}${f.name} minRows ${f.minRows}`);
      if (f.maxRows && v.length > f.maxRows) out.push(`${type}.${path}${f.name} maxRows ${f.maxRows}`);
      for (const row of v) if (row && typeof row === "object") payloadProblems(type, row as Record<string, unknown>, f.fields ?? [], `${path}${f.name}[].`, out);
    }
    if (f.type === "array" && f.minRows && empty) out.push(`${type}.${path}${f.name} minRows ${f.minRows} (missing)`);
    if (typeof v === "string" && f.maxLength && v.length > f.maxLength) out.push(`${type}.${path}${f.name} maxLength ${f.maxLength}`);
  }
}
const offlineFonts2 = offlineFonts;
describe("#4453 plan preview property test: the block-rule checker", () => {
  it("flags an hours block with no hours", () => {
    const out: string[] = [];
    payloadProblems("hours_location", { blockType: "hours_location", heading: "Find us", address: "x" }, BLOCK_RULES.get("hours_location")!, "", out);
    expect(out.length).toBeGreaterThan(0);
  });
});
describe("#4453 plan preview property test", () => {
  it("1,000 random plans across every format and style preview and satisfy Studio's block rules", async () => {
    const failures = new Map<string, { count: number; example: string }>();
    const refused = { body: 0, format: 0 };
    const refusals = new Map<string, number>();
    let ok = 0;
    for (let i = 0; i < 1000; i++) {
      const offerings_selected = [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(OFFERINGS)))];
      const chips = mainActionChips(offerings_selected);
      const main_action = pick(chips).label;
      const format = primaryFormat({ offerings_selected, main_action_page: mainActionPage(main_action, offerings_selected) });
      if (!format) { refused.format++; continue; }
      const feedRows = Array.from({ length: pick([0, 1, 3, 8, 20]) }, offering);
      const feed = { generated_at: new Date().toISOString(), brand: { slug: "brand", currency: "NGN", payment_rails: pick(["paystack", "stripe"]) }, offerings: feedRows };
      const upcoming = feedRows.filter((row) => row.status === "scheduled");
      const next: Record<string, string> = {};
      for (const k of KINDS) { const r = upcoming.find((row) => row.kind === k); if (r && chance(0.8)) next[k] = r.id; }
      const venueCat = pick(["restaurants", "play", "art", "hotels"]);
      const hasVenue = chance(0.5);
      const facts = {
        upcoming: { trip: upcoming.filter((r) => r.kind === "trip").length, event: upcoming.filter((r) => r.kind === "event").length, experience: upcoming.filter((r) => r.kind === "experience").length },
        ended: { trip: 0, event: 0, experience: 0 }, next_offering: next,
        bookable: Object.fromEntries(Object.keys(next).map((k) => [k, pick([0, 1, 14])])),
        venue_id: hasVenue ? { [venueCat]: uid() } : {}, verified_venues: hasVenue ? { [venueCat]: 1 } : {},
        venue_reservations_on: hasVenue ? { [venueCat]: chance(0.6) } : {}, open_venue_slots: hasVenue ? { [venueCat]: pick([0, 12]) } : {},
        published_menu: chance(0.5), live_stay_offerings: 0, stay_offering_id: null, public_ticket_tiers: pick([0, 1, 3]), mingla_reviews: pick([0, 4]),
      };
      const answers = {
        value_points: chance(0.5) ? Array.from({ length: pick([1, 2, 4, 6]) }, (_, j) => ({ title: chance(0.2) ? longText(120) : `Point ${j}`, sentence: chance(0.2) ? longText(500) : "One sentence." })) : [],
        faq: chance(0.5) ? Array.from({ length: pick([1, 4, 12]) }, (_, j) => ({ question: `Q${j}?`, answer: chance(0.2) ? longText(1000) : "An answer." })) : [],
        process_steps: chance(0.5) ? Array.from({ length: pick([1, 3, 5]) }, (_, j) => ({ title: `Step ${j}`, text: "Do this." })) : [],
        quick_facts: chance(0.3) ? { facts: [{ big: "100+", small: "Games" }, { big: "12-12", small: "Open daily" }], use_in_ticker: chance(0.5), ticker: ["One", "Two"] } : null,
      };
      const brand = { name: pick(["Gameland Lagos", longText(120)]), tagline: pick([null, "Lagos' favourite outdoor playground", longText(300)]), bio: pick([null, "Short bio.", longText(4000), longText(1500) + "\n\n" + longText(1500)]), contact_email: pick([null, "support@usemingla.com"]), city: pick([null, "Lagos", longText(120)]) };
      const story = { who: pick(["Friends in Lagos.", longText(300)]), why: pick(["Games.", longText(300)]), main_action };
      const style = pick(DESIGN_KEYS);
      const raw = { kind: "plan_preview", brand_id: BRAND, plan_revision: i + 1, format, styles: [style], plan: { offerings_selected, venue_descriptor: pick([null, "games bar"]), story }, answers, brand, address: pick([null, "14 The Providence St, Lekki Phase I, Lagos"]), facts, feed, live_fingerprints: [] };
      const body = parsePlanPreviewBody(raw, BRAND);
      if (!body) {
        refused.body++;
        const asVoyage = parsePlanPreviewBody({ ...raw, styles: ["voyage"] }, BRAND);
        const why = asVoyage ? `style ${style} refused for ${format}` : `content refused (format ${format})`;
        refusals.set(why, (refusals.get(why) ?? 0) + 1);
        continue;
      }
      const composedForBuild = composePlan(body, style as never).composed;
      for (const page of composedForBuild?.pages ?? []) for (const block of page.blocks) {
        const rules = BLOCK_RULES.get(String(block.blockType));
        if (!rules) { failures.set(`PAYLOAD unknown block ${block.blockType}`, { count: (failures.get(`PAYLOAD unknown block ${block.blockType}`)?.count ?? 0) + 1, example: "" }); continue; }
        const problems: string[] = [];
        payloadProblems(String(block.blockType), block as Record<string, unknown>, rules, "", problems);
        for (const p of problems) { const k = `PAYLOAD ${p}`; failures.set(k, { count: (failures.get(k)?.count ?? 0) + 1, example: failures.get(k)?.example ?? `${format}/${style}` }); }
      }
      try {
        await runPlanPreview(body, { store: store(), req, fontPipeline: offlineFonts2 });
        ok++;
      } catch (e) {
        const msg = (e as Error).message;
        const where = (e as Error).stack?.split("\n")[1]?.trim().replace(/\(.*mingla-site-cms\//, "(") ?? "";
        let detail = "";
        if (msg === "ARTIFACT_BLOCK_TYPE_MISMATCH") {
          const composed = composePlan(body, style as never).composed;
          detail = composed ? composed.pages.flatMap((p) => p.blocks.map((b) => `${b.blockType}:${(b as { variant?: string }).variant ?? "-"}`)).join(",") : "no-compose";
        }
        const key = `${msg} @ ${where} ${detail.slice(0, 400)}`;
        const prev = failures.get(key);
        failures.set(key, { count: (prev?.count ?? 0) + 1, example: prev?.example ?? JSON.stringify({ format, style, offerings_selected, main_action, feedKinds: feedRows.map((r) => `${r.kind}:${r.status}:${r.cover?.type ?? "none"}`), facts: { next, venue: facts.venue_id, res: facts.venue_reservations_on, menu: facts.published_menu, tiers: facts.public_ticket_tiers, reviews: facts.mingla_reviews }, address: raw.address, answers: { vp: answers.value_points.length, faq: answers.faq.length, steps: answers.process_steps.length, qf: Boolean(answers.quick_facts) }, brandBio: brand.bio?.length ?? 0 }).slice(0, 900) });
      }
    }
    const report = [...failures].map(([key, v]) => `${v.count}x ${key}\n   e.g. ${v.example}`);
    expect(report).toEqual([]);
    expect([...refusals.keys()].every((why) => why.startsWith("style "))).toBe(true);
    expect(ok).toBeGreaterThan(700);
  }, 600_000);
});
