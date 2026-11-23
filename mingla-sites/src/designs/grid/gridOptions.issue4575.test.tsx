// @vitest-environment jsdom
/*
 * #4575 — Grid's design options in the runtime.
 *
 * Without options a Grid page is drawn and linked exactly as before (SC-1).
 * With `design.options` the page scope carries the option attributes, the
 * options stylesheet is linked after Grid's own, every index-sheet hero draws
 * as the full-screen cover (SC-6), and the events list gains a flyer column
 * showing the WHOLE cover (never the c400 / c768 centre crops, SC-8).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { assertArtifactV2, type ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import { offeringCard, offeringFilters, type LiveOfferings, type OfferingCard } from "../../lib/offeringCards";
import { homePage, type ArtifactPage } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";
import { SiteDocument } from "../../components/v2/SiteDocument";
import { galleryArtifact, galleryUpcomingTrips } from "../shared/galleryDesigns.fixture";
import { wholeCoverSources } from "../shared/blocks/Offerings";
import { DESIGN_RENDERERS } from "../registry";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {}, prefetch: () => {} }) }));
vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 7).toString("base64"), videoCdnHosts: [] }) }));

const NOW = new Date("2026-10-26T12:00:00Z");
const forms = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;
const TOKEN = "A".repeat(43);
const CROPPED = { coverUrl: `/om/${TOKEN}/c768`, coverSrcSet: `/om/${TOKEN}/c400 400w, /om/${TOKEN}/c768 768w, /om/${TOKEN}/w1600 1600w` };

/** Grid with every Home offering grid as the list layout (the events list). */
function gridArtifact(options?: ArtifactV2["design"]["options"]): ArtifactV2 {
  const artifact = galleryArtifact("grid");
  for (const page of artifact.pages) {
    page.blocks = page.blocks.map((block) => (block.type === "offering_grid" ? { ...block, variant: "list" } : block)) as typeof page.blocks;
  }
  if (options) artifact.design = { ...artifact.design, options };
  assertArtifactV2(artifact);
  return artifact;
}

async function liveFor(artifact: ArtifactV2, cover: Partial<OfferingCard> = CROPPED): Promise<LiveOfferings> {
  const offerings = galleryUpcomingTrips(NOW);
  const cards = new Map<string, OfferingCard>();
  for (const offering of offerings) {
    const card = await offeringCard(artifact.site_id, offering, NOW, "en");
    // The first trip carries a cover with all three renditions; the second has none.
    cards.set(offering.id, offering.cover ? { ...card, ...cover } : card);
  }
  return { source: "live", offerings, cards, now: NOW, filters: offeringFilters(undefined) };
}

const draw = async (artifact: ArtifactV2, live?: LiveOfferings) =>
  renderToStaticMarkup(<SiteDocument artifact={artifact} page={homePage(artifact) as ArtifactPage} live={live ?? (await liveFor(artifact))} forms={forms} nonce="n" />);

describe("#4575 SC-1 a Grid site without options is drawn as before", () => {
  it("no option attributes, no options stylesheet, no flyer column; the index-sheet hero", async () => {
    const html = await draw(gridArtifact());
    expect(html).not.toContain("data-mg-cover");
    expect(html).not.toContain("data-mg-photos");
    expect(html).not.toContain("options-1.css");
    expect(html).not.toContain("mg-lrow__img");
    expect(html).toContain("mg-lrow__d");
    expect(html).toContain("gr-hero");
    expect(html).toContain('href="/designs/grid/1.css"');
  });
});

describe("#4575 with options", () => {
  it("marks the scope, links options-1.css after grid/1.css, and draws the cover hero (SC-6)", async () => {
    const html = await draw(gridArtifact({ cover: "full", photos: "colour" }));
    expect(html).toMatch(/id="mg-scope"[^>]*data-mg-cover="full"/);
    expect(html).toMatch(/id="mg-scope"[^>]*data-mg-photos="colour"/);
    const grid = html.indexOf('href="/designs/grid/1.css"');
    const options = html.indexOf('href="/designs/grid/options-1.css"');
    expect(grid).toBeGreaterThan(-1);
    expect(options).toBeGreaterThan(grid);
    expect(html).toContain("mg-hero-full");
    expect(html).not.toContain("gr-hero");
  });

  it("photos alone: colour without the cover keeps the index-sheet hero and the plain list", async () => {
    const html = await draw(gridArtifact({ photos: "colour" }));
    expect(html).toContain('data-mg-photos="colour"');
    expect(html).not.toContain("data-mg-cover");
    expect(html).toContain("options-1.css");
    expect(html).toContain("gr-hero");
    expect(html).not.toContain("mg-lrow__img");
  });

  it("the list gains a flyer column with the whole picture only (SC-8)", async () => {
    const html = await draw(gridArtifact({ cover: "full", photos: "colour" }));
    const flyers = [...html.matchAll(/<div class="mg-lrow__img">(.*?)<\/div>/g)].map((m) => m[1]!);
    expect(flyers).toHaveLength(2);
    expect(flyers[0]).toContain(`src="/om/${TOKEN}/w1600"`);
    expect(flyers[0]).toContain(`srcSet="/om/${TOKEN}/w1600 1600w"`);
    expect(flyers[0]).not.toMatch(/\/c400|\/c768/);
    // A row with no cover keeps its column, empty.
    expect(flyers[1]).toBe("");
    const rowOrder = /<p class="mg-lrow__d">.*?<\/p><div class="mg-lrow__img">.*?<\/div><div class="mg-lrow__t">/;
    expect(html).toMatch(rowOrder);
  });

  it("a preview-stamped cover keeps its key on the whole picture", async () => {
    const stamped = { coverUrl: `/om/${TOKEN}/c768?k=abc`, coverSrcSet: `/om/${TOKEN}/c400?k=abc 400w, /om/${TOKEN}/c768?k=abc 768w, /om/${TOKEN}/w1600?k=abc 1600w` };
    const artifact = gridArtifact({ cover: "full", photos: "colour" });
    const html = await draw(artifact, await liveFor(artifact, stamped));
    expect(html).toContain(`src="/om/${TOKEN}/w1600?k=abc"`);
    expect(html).not.toMatch(/mg-lrow__img"><img[^>]*\/c(400|768)/);
  });

  it("an options artifact on any design without options is refused", () => {
    const voyage = galleryArtifact("voyage");
    voyage.design = { ...voyage.design, options: { cover: "full" } };
    expect(() => assertArtifactV2(voyage)).toThrow("ARTIFACT_DESIGN_MISMATCH");
  });

  it("only Grid has an options stylesheet", () => {
    expect(DESIGN_RENDERERS.grid.optionsStylesheet).toBe("/designs/grid/options-1.css");
    for (const [key, renderer] of Object.entries(DESIGN_RENDERERS)) if (key !== "grid") expect(renderer.optionsStylesheet, key).toBeUndefined();
  });
});

describe("#4575 wholeCoverSources", () => {
  it("drops the centre crops from the srcset", () => {
    expect(wholeCoverSources(CROPPED)).toEqual({ src: `/om/${TOKEN}/w1600`, srcSet: `/om/${TOKEN}/w1600 1600w` });
    expect(wholeCoverSources({ coverUrl: "/om/x/c768", coverSrcSet: "/om/x/c400 400w, /om/x/c768 768w, /om/x/w1600 1600w, /om/x/original 2400w" }))
      .toEqual({ src: "/om/x/w1600", srcSet: "/om/x/w1600 1600w, /om/x/original 2400w" });
  });

  it("with no srcset, the stored cover in place of a crop", () => {
    expect(wholeCoverSources({ coverUrl: "/om/x/c768", coverSrcSet: null })).toEqual({ src: "/om/x/original", srcSet: null });
    expect(wholeCoverSources({ coverUrl: "/om/x/c400?k=1", coverSrcSet: null })).toEqual({ src: "/om/x/original?k=1", srcSet: null });
    expect(wholeCoverSources({ coverUrl: "/om/x/original", coverSrcSet: null })).toEqual({ src: "/om/x/original", srcSet: null });
    // Only crops in the srcset: the stored cover.
    expect(wholeCoverSources({ coverUrl: "/om/x/c768", coverSrcSet: "/om/x/c400 400w, /om/x/c768 768w" })).toEqual({ src: "/om/x/original", srcSet: null });
  });

  it("is null with no cover", () => {
    expect(wholeCoverSources({ coverUrl: null, coverSrcSet: null })).toBeNull();
  });
});
