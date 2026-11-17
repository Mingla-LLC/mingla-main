/*
 * #4453 production-build smoke, step 1: write the fixture publications the
 * smoke serves (one stored site per design key, every one passing the public
 * contract) and a feed with three upcoming trips. Runs only when
 * PROD_SMOKE_DIR is set (`npm run smoke:prod`); a normal `vitest run` skips it.
 *
 * Step 2 (smoke.mjs) builds the runtime with `next build`, starts it with
 * `next start` in local mode against a loopback mock of Core and storage, and
 * requests Home and Trips for every design with an empty feed and with
 * upcoming trips. Unit renders cannot see the server/client boundary (a
 * server component calling a "use client" export only fails in a real build).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESIGN_KEYS, DESIGNS, HERO_LAYOUTS_WITH_BOOKING, type DesignKey } from "../../src/contracts/generated/designs.ts";
import { assertArtifactV2, type ArtifactV2 } from "../../src/contracts/generated/artifactV2.ts";
import { upgradeV1ToV2 } from "../../src/contracts/generated/upgradeV1ToV2.ts";
import { gogiV1Fixture } from "../../src/contracts/gogiV1.fixture";
import { voyageSyntheticArtifact } from "../../src/contracts/voyageSynthetic.fixture";
import { galleryArtifact } from "../../src/designs/shared/galleryDesigns.fixture";
import { siteCanonicalUrl } from "../../src/lib/siteArtifact";
import { offeringDetailPath } from "../../src/contracts/generated/offeringDetail.ts";

const OUT = process.env.PROD_SMOKE_DIR;

/* #4453 milestone 5 — the live booking blocks on every Home that can draw them (the smoke's mock answers /booking). */
export const SMOKE_VENUE = "22222222-2222-4222-8222-000000000001";
export const SMOKE_EVENT = "22222222-2222-4222-8222-000000000002";

/* #4453 milestone 9 — the offerings whose detail pages the smoke requests (a trip, an event, a session and a room). */
export const SMOKE_DETAILS = [
  { kind: "trip" as const, slug: "smoke-trip-1", title: "Smoke Trip 1", id: "11111111-1111-4111-8111-000000000001" },
  { kind: "event" as const, slug: "smoke-supper", title: "Smoke Supper Club", id: "11111111-1111-4111-8111-000000000021" },
  { kind: "experience" as const, slug: "smoke-session", title: "Smoke Pottery Session", id: "11111111-1111-4111-8111-000000000022" },
  { kind: "stay" as const, slug: "11111111-1111-4111-8111-000000000023", title: "Smoke Lagoon Room", id: "11111111-1111-4111-8111-000000000023" },
];

function withBookingBlocks(artifact: ArtifactV2): ArtifactV2 {
  const a = artifact as ArtifactV2 & { action_scope?: { brand_slug: string } };
  a.action_scope = { brand_slug: "fixture" };
  const home = a.pages.find((page) => page.path === "");
  if (!home) return a;
  const blocks = home.blocks as unknown as Array<Record<string, unknown>>;
  const hero = blocks.find((block) => block.type === "hero");
  if (hero) {
    hero.show_rating = true;
    if (hero.show_search !== true) Object.assign(hero, { booking_bar: "venue_table", booking_target_id: SMOKE_VENUE });
  }
  blocks.splice(hero ? blocks.indexOf(hero) + 1 : 0, 0,
    { type: "availability", variant: "strip", heading: "Book a table", source: "venue_slots", offering_id: SMOKE_VENUE, party_size: 2, days: 7 },
    { type: "ticket_tiers", variant: "split", heading: "Supper club", offering_id: SMOKE_EVENT },
    { type: "process_steps", variant: "band", heading: "How it works", items: [{ title: "Book" }, { title: "Arrive" }, { title: "Eat slowly" }] });
  a.navigation.sticky_booking = true;
  return a;
}

/** #4453 milestone 7c (tester P2-3) — the long brand name the phone header must survive. */
// One long word (no space to wrap at), the hardest case for a phone header (milestone 7c).
export const SMOKE_LONG_NAME = "Wanderlustandsupperclubcompany";
export const SMOKE_LONG_BUTTON = "Book your next weekend away";

/*
 * #4453 milestone 7c — every design's fixture carries what broke Young and
 * Stamped's phone header (a long brand name AND a header button), so the
 * header check guards all 11 designs; and the page-set blocks ("Keep
 * exploring" with the pages a publish would compute, and the owner's facts),
 * so every design draws them on a production build.
 */
function withHeaderAndPageSet(artifact: ArtifactV2, key: DesignKey): ArtifactV2 {
  const a = artifact as ArtifactV2 & { navigation: Record<string, unknown> };
  a.navigation.wordmark = SMOKE_LONG_NAME;
  const live = a.pages.filter((page) => page.enabled && page.path !== "");
  const target = live.find((page) => page.blocks.some((block) => block.type === "offering_grid")) ?? live[0];
  a.navigation.header_cta = { label: SMOKE_LONG_BUTTON, href: target ? `/${target.path}` : "/" };
  const variants = DESIGNS[key].variants;
  const home = a.pages.find((page) => page.path === "");
  if (home && variants.page_links.length && variants.facts_table.length) {
    const blocks = home.blocks as unknown as Array<Record<string, unknown>>;
    const links = live.slice(0, 4).map((page) => ({ label: (page.title || page.path).slice(0, 40), href: `/${page.path}`, description: `About ${page.path}`.slice(0, 120) }));
    const at = Math.max(0, blocks.length - 1);
    if (links.length >= 2) blocks.splice(at, 0, { type: "page_links", variant: variants.page_links[0], heading: "Keep exploring", mode: "teaser", items: links });
    blocks.splice(at, 0, { type: "facts_table", variant: variants.facts_table[0], heading: "Good to know", items: [{ label: "Group size", value: "Twelve at most" }, { label: "Guides", value: "Two on every trip" }] });
  }
  return a;
}

function artifactFor(key: DesignKey): ArtifactV2 {
  // The stored Voyage site (Young and Stamped's shape); every other key is the gallery composition.
  if (key === "voyage") return withHeaderAndPageSet(withBookingBlocks(voyageSyntheticArtifact()), key);
  // Atelier (frozen) draws no booking block.
  if (key === "atelier") return withHeaderAndPageSet(upgradeV1ToV2(gogiV1Fixture()) as ArtifactV2, key);
  return withHeaderAndPageSet(withBookingBlocks(galleryArtifact(key)), key);
}

describe.skipIf(!OUT)("#4453 prod smoke fixtures", () => {
  it("writes one publication per design key, plus the upcoming feed", () => {
    mkdirSync(OUT!, { recursive: true });
    const sites: Record<string, unknown> = {};
    DESIGN_KEYS.forEach((key, index) => {
      const artifact = artifactFor(key);
      // The fixtures' own ids (their media records name them); each host still gets its own artifact.
      void index;
      assertArtifactV2(artifact);
      const bytes = Buffer.from(JSON.stringify(artifact));
      const digest = createHash("sha256").update(bytes).digest("hex");
      writeFileSync(join(OUT!, `${digest}.json`), bytes);
      const hostname = `${key}.sites.localhost`;
      const canonical = siteCanonicalUrl(artifact);
      const own = typeof canonical === "string" && canonical.startsWith("https://") ? canonical.slice("https://".length) : null;
      const trips = artifact.pages.find((page) => page.blocks.some((block) => block.type === "offering_grid") && page.path !== "")?.path ?? null;
      sites[hostname] = {
        site_id: artifact.site_id, brand_id: artifact.brand_id, publication_id: artifact.publication_id,
        artifact_key: `publications/${artifact.site_id}/${artifact.publication_id}/${digest}.json`, artifact_digest: digest,
        artifact_schema_version: 2, renderer_key: artifact.renderer_key, renderer_version: artifact.renderer_version,
        hostname, primary_hostname: hostname, is_primary: true, host_kind: "subdomain", design_key: key,
        site_hostnames: own ? [hostname, own] : [hostname],
        smoke_paths: ["/", ...(trips ? [`/${trips}`] : [])],
        // #4453 milestone 9 — one detail page per kind, at this site's own bases (the mock turns SITES_DETAIL_PAGES on).
        detail_paths: SMOKE_DETAILS.map((row) => ({ path: `/${offeringDetailPath(artifact.routes, row)!}`, title: row.title })),
        expects_booking: key !== "atelier",
        // The rating is drawn by the hero layouts that draw it (HERO_LAYOUTS_WITH_BOOKING); a signature hero leaves it out by design.
        expects_rating: HERO_LAYOUTS_WITH_BOOKING.includes(String((artifact.pages.find((page) => page.path === "")?.blocks.find((block) => block.type === "hero") as { variant?: unknown } | undefined)?.variant)),
        // A live upcoming grid exists (a v1 site's grid is frozen at publish, so it draws no feed).
        expects_live_trips: artifact.pages.some((page) => page.blocks.some((block) =>
          block.type === "offering_grid" && typeof (block as { mode?: unknown }).mode === "string" && (block as { mode?: unknown }).mode !== "past")),
      };
    });
    const start = Date.now() + 30 * 86_400_000;
    const trip = (n: number) => ({
      kind: "trip", summary: "Seven quiet days on the water.", cover: null, destination_text: "Fixture Coast", timezone: "Africa/Lagos",
      status: "scheduled", bookings_closed: false, capacity: 20, spots_left: 5, group_minimum: null, min_price_minor: 249900, currency: "USD",
      has_free_tier: false, waitlist_enabled: false, installments_available: true,
      id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`, slug: `smoke-trip-${n}`, title: `Smoke Trip ${n}`,
      start_at: new Date(start + n * 86_400_000).toISOString(), end_at: new Date(start + (n + 5) * 86_400_000).toISOString(),
      public_url: `https://host.usemingla.com/t/fixture/smoke-trip-${n}`,
    });
    writeFileSync(join(OUT!, "sites.json"), JSON.stringify(sites, null, 1));
    writeFileSync(join(OUT!, "feed.json"), JSON.stringify({
      generated_at: new Date().toISOString(),
      brand: { slug: "fixture", currency: "USD", payment_rails: "stripe" },
      offerings: [trip(1), trip(2), trip(3), ...SMOKE_DETAILS.filter((row) => row.kind !== "trip").map((row, index) => ({
        ...trip(10 + index), ...row, installments_available: false,
        public_url: row.kind === "stay" ? `https://host.usemingla.com/b/fixture/v/lagoon?tab=stay&room=${row.slug}` : `https://host.usemingla.com/${row.kind === "event" ? "e" : "exp"}/fixture/${row.slug}`,
        ...(row.kind === "stay" ? { start_at: null, end_at: null, timezone: null, spots_left: null } : {}),
      }))],
    }));
    expect(Object.keys(sites)).toHaveLength(DESIGN_KEYS.length);
  });
});
