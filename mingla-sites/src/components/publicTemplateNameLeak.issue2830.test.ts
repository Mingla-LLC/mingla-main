import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RestaurantV1 } from "./RestaurantV1";
import type { RestaurantArtifact } from "../contracts/artifact";
import { assertRestaurantArtifact } from "../contracts/artifact";

/**
 * #2830 — Mingla's internal template name must never render on a CUSTOMER'S
 * OWN public website.
 *
 * It shipped as the hero eyebrow AND the footer eyebrow of every published
 * site, so a member of the public visiting gogi.sites.usemingla.com read
 * "Restaurant Website v1" above the restaurant's own name. A third copy sat in
 * the preview iframe's title, where only screen readers heard it.
 *
 * DELIBERATELY NARROW. `docs/runbooks/MINGLA_SITES_PILOT.md` names "Restaurant
 * Website v1" as APPROVED customer-facing copy — but the customer there is the
 * BRAND OWNER inside Studio and the Website workspace, not the public visitor
 * on the brand's own domain. So this pins the PUBLIC renderer only; the
 * `renderer:` API field and the Studio chrome keep the name on purpose.
 */
const read = (relative: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;
const SITE = U(90);
const LOGO = {
  id: U(80),
  url: `/media/${U(80)}/960.webp`,
  alt: "",
  width: 960,
  height: 240,
  integrity: "8".repeat(64),
  object_key: `approved/${SITE}/${U(80)}/960.webp`,
};

/** The real footer, from the real renderer, over a contract-valid artifact. */
function renderedFooter(withLogo = false): string {
  const artifact = {
    schema_version: 1,
    site_id: SITE,
    brand_id: U(91),
    publication_id: U(92),
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    source_revision_id: U(93),
    source_digest: "a".repeat(64),
    generated_at: "2026-09-10T00:00:00Z",
    pages: [{
      role: "home",
      slug: "home",
      title: "Home",
      enabled: true,
      nav_label: "Home",
      nav_order: 0,
      blocks: [{ type: "pull_quote", quote: "Find gögi." }],
    }],
    navigation: { page_roles: ["home"] },
    footer: {
      address: "69 Admiralty Way, Lekki Phase 1, Lagos",
      hours_summary: "Open 24 hours, 7 days",
      legal_text: "Gogi Lagos Ltd",
      links: [],
    },
    site_settings: {
      display_name: "gögi",
      ...(withLogo ? { logo: LOGO } : {}),
      seo: { canonical_url: "https://gogi.sites.usemingla.com" },
    },
    media: withLogo ? [LOGO] : [],
    commercial_references: [],
  } as unknown as RestaurantArtifact;
  assertRestaurantArtifact(artifact);
  /*
   * `createElement` rather than JSX so this file keeps its `.ts` extension.
   * Renaming it to `.tsx` would read as a delete-and-add to the append-only
   * test gate, which is a worse thing to explain than one un-sugared call.
   */
  const html = renderToStaticMarkup(
    createElement(RestaurantV1, { artifact, page: artifact.pages[0]! }),
  );
  return html.slice(html.indexOf('<footer class="footer">'));
}

describe("#2830 public output carries no Mingla template name", () => {
  it("the public renderer never prints it", () => {
    expect(read("src/components/RestaurantV1.tsx")).not.toContain(
      "Restaurant Website v1",
    );
  });

  it("no eyebrow element survives in the hero or the footer", () => {
    const src = read("src/components/RestaurantV1.tsx");
    expect(src).not.toContain('<p className="eyebrow">Restaurant Website v1</p>');
  });

  it("the brand's own display name is still what the footer leads with", () => {
    /*
     * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4:
     *   const src = read("src/components/RestaurantV1.tsx");
     *   expect(src).toContain(
     *     '<footer className="footer"><div><strong>{artifact.site_settings.display_name}</strong>',
     *   );
     *
     * The footer is four columns now, and the brand's name sits inside the
     * first of them — beside an uploaded wordmark where a brand has one.
     *
     * SHARPENED, and in the dimension that matters. The superseded line was a
     * SOURCE grep: it matched a string in a file and proved nothing about what
     * a visitor is served, so any refactor that kept those exact characters
     * while rendering something else would have passed. This RENDERS the
     * footer and asserts on the markup — that the brand's own name is the
     * first thing in it, that Mingla's template name appears nowhere, and that
     * the one line of Mingla chrome that IS there is the credit and says so.
     */
    const footer = renderedFooter();
    expect(footer).toContain("<strong>gögi</strong>");
    expect(footer.indexOf("gögi")).toBeLessThan(footer.indexOf("Powered by Mingla"));
    expect(footer).not.toContain("Restaurant Website v1");
    expect(footer).not.toContain("restaurant-website-v1");
    // A wordmark, when the brand uploaded one, still names the brand.
    const withLogo = renderedFooter(true);
    expect(withLogo).toContain('class="footer-wordmark"');
    expect(withLogo).toContain('alt="gögi"');
    expect(withLogo).not.toContain("Restaurant Website v1");
  });
});
