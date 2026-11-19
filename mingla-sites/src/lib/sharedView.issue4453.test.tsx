/*
 * #4453 M8 (spec v2 §7, v2.1 N10) — a private share link never shows what the
 * team alone should see: the Draft-only empty-grid hints (unconfirmed content)
 * and pages that are not enabled, nor menu or footer links to them. The
 * team's own preview keeps its hints. The strip reads "Private preview ·
 * {brand} · expires {date}".
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
import { VoyagePage } from "../designs/voyage/VoyagePage";
import { isPreviewPublication, isSharedPreviewPublication, showsDraftHints } from "./previewPublication";
import { withSharedView } from "./sharedView";
import { sharedBannerText } from "./sharedBanner";

const NOW = new Date("2026-10-26T12:00:00Z");
const forms = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;
const HINT = "No upcoming trips right now";
const TEAM_ID = `preview-${"c".repeat(32)}`;

async function liveFor(artifact: ArtifactV2): Promise<LiveOfferings> {
  const offerings = w5EndedTrips();
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(artifact.site_id, offering, NOW, "en"));
  return { source: "live", offerings, cards, now: NOW, filters: offeringFilters(undefined) };
}

describe("#4453 M8 share link view", async () => {
  const base = { ...voyageSyntheticArtifact(), publication_id: TEAM_ID } as ArtifactV2;
  const live = await liveFor(base);
  const draw = (artifact: ArtifactV2) =>
    renderToStaticMarkup(<VoyagePage artifact={artifact} page={homePage(artifact)!} live={live} forms={forms} nonce="n0nce" notFound={false} />);

  it("the team's preview draws the owner's hint; the shared view never does", () => {
    expect(draw(base)).toContain(HINT);
    const shared = withSharedView(base);
    expect(draw(shared)).not.toContain(HINT);
  });

  it("the shared publication id is still a preview (nothing counted) but not a Draft", () => {
    const shared = withSharedView(base);
    expect(isPreviewPublication(shared.publication_id)).toBe(true);
    expect(isSharedPreviewPublication(shared.publication_id)).toBe(true);
    expect(showsDraftHints(shared.publication_id)).toBe(false);
    expect(showsDraftHints(TEAM_ID)).toBe(true);
    expect(showsDraftHints("11111111-1111-4111-8111-111111111111")).toBe(false);
    expect(withSharedView(shared).publication_id).toBe(shared.publication_id);
  });

  it("pages that are not enabled, and links to them, are removed; the stored artifact is untouched", () => {
    const [first, second] = base.pages;
    const draftPage = { ...second!, path: "private-hire", enabled: false };
    const withDraft = {
      ...base,
      pages: [...base.pages, draftPage],
      navigation: { ...base.navigation, items: [...base.navigation.items, { label: "Private hire", href: "/private-hire" }] },
      footer: { ...base.footer, columns: [{ heading: "Pages", links: [{ label: "Private hire", href: "/private-hire" }, { label: first!.title, href: `/${first!.path}` }] }] },
    } as ArtifactV2;
    const shared = withSharedView(withDraft);
    expect(shared.pages.some((page) => page.path === "private-hire")).toBe(false);
    expect(shared.navigation.items.some((item) => item.href === "/private-hire")).toBe(false);
    expect(shared.footer.columns![0]!.links.map((link) => link.href)).not.toContain("/private-hire");
    expect(shared.footer.columns![0]!.links).toHaveLength(1);
    expect(withDraft.pages.some((page) => page.path === "private-hire")).toBe(true);
    expect(withDraft.publication_id).toBe(TEAM_ID);
  });

  it("the strip names the brand and the expiry date", () => {
    expect(sharedBannerText("Young and Stamped", "2026-11-20T10:00:00Z")).toBe("Private preview · Young and Stamped · expires 20 Nov 2026");
    expect(sharedBannerText("Young and Stamped", null)).toBe("Private preview · Young and Stamped");
    expect(sharedBannerText("Young and Stamped", "not a date")).toBe("Private preview · Young and Stamped");
  });
});

describe("#4453 M8 unavailable share link", () => {
  it("one plain page for expired, turned-off and unknown links, with no brand and no indexing", async () => {
    const mod = await import("../app/preview/share/[token]/not-found");
    const html = renderToStaticMarkup(<mod.default />);
    expect(html).toContain("This preview link isn&#x27;t working");
    expect(html).toContain("expired or been turned off");
    expect(mod.metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
