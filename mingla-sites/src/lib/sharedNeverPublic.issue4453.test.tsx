/*
 * #4453 M8 (orchestrator decision, Constitution rule 9) — a private share link
 * is a preview the owner chose to send, so unreviewed sections on enabled
 * pages may show, with no Draft UI. What must never be public must never be in
 * a share view either: the owner-only prompts a Draft preview draws (an empty
 * offering grid's hint and button). Uses milestone 3's server-side preview
 * context (`showsDraftHints`) through the real renderers of every grid layout.
 * The links test covers every link source (header button, footer, blocks).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { voyageSyntheticArtifact } from "../contracts/voyageSynthetic.fixture";
import { w5EndedTrips } from "../contracts/w5Content.fixture";
import { offeringCard, offeringFilters, type LiveOfferings } from "./offeringCards";
import { homePage } from "./pageRouting";
import type { FormsContext } from "./siteForms";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { SHARED_BLOCK_LAYOUTS } from "../designs/shared/library";
import type { SharedContext } from "../designs/shared/parts";
import { OfferingGridPhotoCard } from "../designs/voyage/blocks/OfferingGridPhotoCard";
import { showsDraftHints } from "./previewPublication";
import { withSharedView, withoutLinksTo } from "./sharedView";

const NOW = new Date("2026-10-26T12:00:00Z");
const TEAM_ID = `preview-${"c".repeat(32)}`;

describe("#4453 M8 a share view carries nothing that must never be public", async () => {
  const base = { ...voyageSyntheticArtifact(), publication_id: TEAM_ID } as ArtifactV2;
  const cards = new Map();
  const offerings = w5EndedTrips();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(base.site_id, offering, NOW, "en"));
  const live: LiveOfferings = { source: "live", offerings, cards, now: NOW, filters: offeringFilters(undefined) };
  const forms = { renderedAt: 1, signature: "s", enquiries: "available", preview: true, notice: null } as unknown as FormsContext;
  const grid = { type: "offering_grid", kind: "trip", mode: "upcoming", heading: "Upcoming trips", empty_text: "OWNER-ONLY-HINT" };
  const ctxFor = (artifact: ArtifactV2): SharedContext => ({
    artifact, page: homePage(artifact)!, live, forms,
    analytics: { siteId: artifact.site_id, brandId: artifact.brand_id, publicationId: artifact.publication_id },
    preview: showsDraftHints(artifact.publication_id),
  });

  it("the team's preview draws the owner's prompt in every grid layout; the shared view draws none", () => {
    const shared = ctxFor(withSharedView(base));
    const team = ctxFor(base);
    for (const [variant, Layout] of Object.entries(SHARED_BLOCK_LAYOUTS.offering_grid!)) {
      const C = Layout as unknown as React.ComponentType<{ block: Record<string, unknown>; index: number; ctx: SharedContext }>;
      expect(renderToStaticMarkup(<C block={{ ...grid, variant }} index={0} ctx={team} />), variant).toContain("OWNER-ONLY-HINT");
      expect(renderToStaticMarkup(<C block={{ ...grid, variant }} index={0} ctx={shared} />), variant).toBe("");
    }
    const Photo = OfferingGridPhotoCard as unknown as React.ComponentType<{ block: Record<string, unknown>; index: number; ctx: SharedContext }>;
    expect(renderToStaticMarkup(<Photo block={grid} index={0} ctx={shared} />)).toBe("");
  });

  it("links to a removed page are taken out of every source: header button, footer, a block's button, a block's bare href field", () => {
    const template = base.pages[1]!;
    const draft = { ...template, path: "private-hire", enabled: false };
    const home = base.pages[0]!;
    const artifact = {
      ...base,
      pages: [{ ...home, blocks: [...home.blocks, { type: "cta", heading: "Hi", primary: { label: "Hire", href: "/private-hire" }, cta_href: "/private-hire/", keep_href: "/trips" }] }, ...base.pages.slice(1), draft],
      navigation: { ...base.navigation, header_cta: { label: "Hire", href: "/private-hire" } },
      footer: { ...base.footer, columns: [{ heading: "Pages", links: [{ label: "Hire", href: "/private-hire#x" }, { label: "Trips", href: "/trips" }] }] },
    } as unknown as ArtifactV2;
    const shared = withSharedView(artifact);
    const text = JSON.stringify(shared);
    expect(text).not.toContain("private-hire");
    expect(text).toContain("/trips");
    expect(JSON.stringify(withoutLinksTo({ a: [{ href: "https://x.test/private-hire" }] }, new Set(["private-hire"])))).toContain("https://x.test/private-hire");
  });
});
