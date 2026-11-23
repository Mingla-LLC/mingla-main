// @vitest-environment jsdom
/*
 * #4575 (cover gap) — the top of a Grid page under the full-screen cover.
 *
 * SC-1: without options the page is byte-identical to origin/main (the hash
 * below was taken from origin/main's render of the same artifact).
 * SC-2: with the cover the header is always Grid's black bar.
 * SC-3: with the cover a photo Page title is drawn as the cover (HeroFullbleed
 * markup); without a photo it stays the dark band.
 */
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DESIGNS } from "../../contracts/generated/designs.ts";
import { assertArtifactV2, type ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import { homePage, type ArtifactPage } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";
import { SiteDocument } from "../../components/v2/SiteDocument";
import { galleryArtifact } from "../shared/galleryDesigns.fixture";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {}, prefetch: () => {} }) }));
vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 7).toString("base64"), videoCdnHosts: [] }) }));

const forms = { renderedAt: 1, signature: "s", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;
/** sha256 of the page below rendered by origin/main bf45455 (no options, stored `center`, photo Page title). */
const BASELINE_SHA256 = "ea26d23f13511d2c36dccdb476d56e006451d50961f884bddae72563c0b27319";

function artifact(options?: ArtifactV2["design"]["options"], photo = true, header: ArtifactV2["navigation"]["header_variant"] = "center"): ArtifactV2 {
  const a = galleryArtifact("grid");
  a.navigation.header_variant = header;
  const home = a.pages.find((page) => page.path === "")!;
  const title = { type: "page_header", variant: DESIGNS.grid.variants.page_header[0], heading: "Modern art", subheading: "Line A\nLine B", ...(photo ? { media_url: (a.media[0] as { url: string }).url } : {}) };
  home.blocks = [title as never, ...home.blocks.slice(1)];
  if (options) a.design = { ...a.design, options };
  assertArtifactV2(a);
  return a;
}

const draw = (a: ArtifactV2): string =>
  renderToStaticMarkup(
    <SiteDocument artifact={a} page={homePage(a) as ArtifactPage} live={{ source: "live", offerings: [], cards: new Map(), now: new Date("2026-10-26T12:00:00Z"), filters: [] } as never} forms={forms} nonce="n" />,
  );

describe("#4575 cover gap SC-1 without options nothing changes", () => {
  it("renders exactly what origin/main rendered (centre header, photo Page title band)", () => {
    const html = draw(artifact());
    expect(createHash("sha256").update(html).digest("hex")).toBe(BASELINE_SHA256);
    expect(html).toContain("mg-hd--center");
    expect(html).toContain("mg-phd mg-phd--photo");
    expect(html).not.toContain("mg-hero-full");
  });

  it("photos alone (no cover) keeps the stored header and the band", () => {
    const html = draw(artifact({ photos: "colour" }));
    expect(html).toContain("mg-hd--center");
    expect(html).toContain("mg-phd mg-phd--photo");
  });
});

describe("#4575 cover gap SC-2 the header", () => {
  it.each(["center", "glass", "pill"] as const)("stored %s becomes the Grid bar with numbers under the cover", (stored) => {
    const html = draw(artifact({ cover: "full" }, true, stored));
    expect(html).toContain("mg-hd mg-hd--grid-bar");
    expect(html).not.toContain(`mg-hd--${stored}`);
    expect(html).toContain("gr-n");
  });

  it("without the option the stored header is back", () => {
    expect(draw(artifact(undefined, true, "glass"))).toContain("mg-hd--glass");
  });
});

describe("#4575 cover gap SC-3 a photo Page title is the cover", () => {
  it("draws the full-picture hero markup with an h1 and a joined lede", () => {
    const html = draw(artifact({ cover: "full" }));
    expect(html).toMatch(/<section class="mg-hero mg-hero-full mg-on-photo"[^>]*data-mg-hero=""/);
    expect(html).toContain('<h1 id="mg-page_header-0" class="mg-h1">');
    expect(html).toContain("Modern art");
    expect(html).toContain('<p class="mg-lede" data-mg-in="">Line A · Line B</p>');
    expect(html).not.toContain("mg-phd");
  });

  it("with no photo it stays the dark band", () => {
    const html = draw(artifact({ cover: "full" }, false));
    expect(html).toContain("mg-phd mg-band");
    expect(html).not.toContain('class="mg-hero mg-hero-full');
  });

  it("with no lines there is no index row", () => {
    const a = artifact({ cover: "full" });
    const title = a.pages.find((page) => page.path === "")!.blocks[0] as unknown as { subheading?: string };
    delete title.subheading;
    const html = draw(a);
    expect(html).toContain("mg-hero-full");
    expect(html).not.toContain("mg-hero__row");
  });
});
