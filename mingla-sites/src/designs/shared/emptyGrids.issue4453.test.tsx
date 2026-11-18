// MINGLA-INVARIANT: I-SITES-NO-PUBLIC-EMPTY-STATE | issue #4453 | an upcoming offering grid with no live offering is left out of the public site in every design; only an owner preview (a preview- publication) keeps the hint.
/*
 * #4453 PR 3 (SC-4.4, I-SITES-NO-PUBLIC-EMPTY-STATE) — an upcoming offering
 * grid with no live offering is left out of the public site in every design:
 * the shared block library (every offering_grid layout), Voyage and Atelier
 * (components/v2/LiveOfferingGrid, pinned in liveOfferingGrid.issue2829).
 * Only a Draft preview (a `preview-` publication) keeps the owner's hint.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { w5EndedTrips } from "../../contracts/w5Content.fixture";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../lib/offeringCards";
import { homePage } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";
import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import { SHARED_BLOCK_LAYOUTS } from "./library";
import type { SharedContext } from "./parts";
import { VoyagePage } from "../voyage/VoyagePage";
import { OfferingGridPhotoCard } from "../voyage/blocks/OfferingGridPhotoCard";
import { LiveOfferingGrid } from "../../components/v2/LiveOfferingGrid";

const NOW = new Date("2026-10-26T12:00:00Z");
const forms = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;
const HINT = "will appear here as soon as they are on sale";

// Only ended trips: every upcoming grid is empty.
async function liveFor(artifact: ArtifactV2): Promise<LiveOfferings> {
  const offerings = w5EndedTrips();
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(artifact.site_id, offering, NOW, "en"));
  return { source: "live", offerings, cards, now: NOW, filters: offeringFilters(undefined) };
}

const grid = { type: "offering_grid", kind: "trip", mode: "upcoming", heading: "Upcoming trips", empty_text: "New dates soon." };

describe("#4453 empty upcoming grids are left out of the public site", async () => {
  const artifact = voyageSyntheticArtifact();
  const live = await liveFor(artifact);
  const page = homePage(artifact)!;
  const publicCtx: SharedContext = { artifact, page, live, forms, analytics: { siteId: artifact.site_id, brandId: artifact.brand_id, publicationId: artifact.publication_id } };
  const previewCtx: SharedContext = { ...publicCtx, analytics: { ...publicCtx.analytics, publicationId: "preview-4453" } };

  it("shared library: every offering_grid layout renders nothing publicly, the hint in a Draft preview", () => {
    const layouts = Object.entries(SHARED_BLOCK_LAYOUTS.offering_grid!);
    expect(layouts.length).toBeGreaterThan(0);
    for (const [variant, Layout] of layouts) {
      const Component = Layout as unknown as React.ComponentType<{ block: Record<string, unknown>; index: number; ctx: SharedContext }>;
      expect(renderToStaticMarkup(<Component block={{ ...grid, variant }} index={0} ctx={publicCtx} />), variant).toBe("");
      expect(renderToStaticMarkup(<Component block={{ ...grid, variant }} index={0} ctx={previewCtx} />), variant).toContain("New dates soon.");
    }
  });

  it("voyage: the photo-card grid renders nothing publicly (upcoming and all), the hint in a Draft preview", () => {
    const Grid = OfferingGridPhotoCard as unknown as React.ComponentType<{ block: Record<string, unknown>; index: number; ctx: SharedContext }>;
    expect(renderToStaticMarkup(<Grid block={grid} index={0} ctx={publicCtx} />)).toBe("");
    expect(renderToStaticMarkup(<Grid block={grid} index={0} ctx={previewCtx} />)).toContain("New dates soon.");
    const allEmpty = { ...grid, mode: "all" };
    const noOfferings = { ...publicCtx, live: { ...live, offerings: [], cards: new Map() } };
    expect(renderToStaticMarkup(<Grid block={allEmpty} index={0} ctx={noOfferings} />)).toBe("");
  });

  it("voyage home: no empty upcoming card, no heading left behind", () => {
    const html = renderToStaticMarkup(<VoyagePage artifact={artifact} page={page} live={live} forms={forms} nonce="n0nce" notFound={false} />);
    expect(html).not.toContain("No upcoming trips right now");
    expect(html).not.toContain(HINT);
  });

  it("atelier (LiveOfferingGrid): nothing at all", () => {
    const html = renderToStaticMarkup(<LiveOfferingGrid block={grid} live={live} context={publicCtx.analytics} clearHref="/trips" />);
    expect(html).toBe("");
  });
});
