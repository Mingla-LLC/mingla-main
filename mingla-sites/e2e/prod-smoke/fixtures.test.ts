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
import { DESIGN_KEYS, type DesignKey } from "../../src/contracts/generated/designs.ts";
import { assertArtifactV2, type ArtifactV2 } from "../../src/contracts/generated/artifactV2.ts";
import { upgradeV1ToV2 } from "../../src/contracts/generated/upgradeV1ToV2.ts";
import { gogiV1Fixture } from "../../src/contracts/gogiV1.fixture";
import { voyageSyntheticArtifact } from "../../src/contracts/voyageSynthetic.fixture";
import { galleryArtifact } from "../../src/designs/shared/galleryDesigns.fixture";
import { siteCanonicalUrl } from "../../src/lib/siteArtifact";

const OUT = process.env.PROD_SMOKE_DIR;

function artifactFor(key: DesignKey): ArtifactV2 {
  // The stored Voyage site (Young and Stamped's shape); every other key is the gallery composition.
  if (key === "voyage") return voyageSyntheticArtifact();
  if (key === "atelier") return upgradeV1ToV2(gogiV1Fixture()) as ArtifactV2;
  return galleryArtifact(key);
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
      offerings: [trip(1), trip(2), trip(3)],
    }));
    expect(Object.keys(sites)).toHaveLength(DESIGN_KEYS.length);
  });
});
