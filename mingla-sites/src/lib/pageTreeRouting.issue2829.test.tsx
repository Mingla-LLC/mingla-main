/*
 * #2829 W2 — the runtime side of the page tree: one resolver for both artifact
 * forms (redirect → page by full path → … → not found), menus with dropdown
 * children, and the guarantee that a role-form site converted to the tree
 * renders the same HTML (gögi's pages after the W2 data migration).
 */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RestaurantV1 } from "../components/RestaurantV1";
import type { RestaurantArtifact } from "../contracts/artifact";
import {
  homePage,
  hrefForPage,
  isIndexable,
  navigablePages,
  resolveSitePath,
  siteNavigation,
} from "./pageRouting";

const base = {
  schema_version: 1,
  site_id: "00000000-0000-4000-8000-000000000c01",
  brand_id: "00000000-0000-4000-8000-000000000c02",
  renderer_key: "restaurant-website-v1",
  renderer_version: 1,
  publication_id: "00000000-0000-4000-8000-000000000c03",
  source_revision_id: "r",
  source_digest: "d".repeat(64),
  generated_at: "2026-10-26T00:00:00Z",
  footer: { address: "69 Admiralty Way", legal_text: "c 2026", links: [{ label: "Instagram", href: "https://instagram.com/x" }] },
  site_settings: { display_name: "gogi", seo: { canonical_url: "https://gogi.sites.localhost" } },
  media: [],
  commercial_references: [],
};

const HOME_BLOCKS = [
  { type: "hero", heading: "Where Lagos comes to eat", subheading: "sub", ctas: [] },
  { type: "faq", heading: "Questions", items: [{ question: "Late?", answer: "Always." }] },
];
const block = (heading: string) => [{ type: "rich_text", heading, paragraphs: [{ text: `${heading} text` }] }];

const legacy = {
  ...base,
  pages: [
    { role: "home", slug: "/", title: "Home", enabled: true, nav_label: "Home", nav_order: 0, blocks: HOME_BLOCKS },
    { role: "about", slug: "about", title: "About", enabled: true, nav_label: "About us", nav_order: 1, blocks: block("About") },
    { role: "menu", slug: "menu", title: "Menu", enabled: false, nav_label: "Menu", nav_order: 2, blocks: [] },
    { role: "contact", slug: "contact", title: "Contact", enabled: true, nav_label: "Contact", nav_order: 3, blocks: block("Contact") },
  ],
  navigation: { page_roles: ["home"] },
} as unknown as RestaurantArtifact;

/** The same site after the W2 conversion: same addresses, menu rebuilt from what was shown. */
const converted = {
  ...base,
  pages: [
    { path: "", title: "Home", enabled: true, kind: "standard", blocks: HOME_BLOCKS },
    { path: "about", title: "About", enabled: true, kind: "standard", blocks: block("About") },
    { path: "contact", title: "Contact", enabled: true, kind: "standard", blocks: block("Contact") },
    { path: "menu", title: "Menu", enabled: false, kind: "standard", blocks: [] },
  ],
  navigation: { items: [
    { label: "Home", href: "/" },
    { label: "About us", href: "/about" },
    { label: "Contact", href: "/contact" },
  ] },
  site_routes: {
    routes: { trips: "trips", events: "events", experiences: "experiences", destinations: "destinations", stories: "stories" },
    redirects: [],
    language: "en",
  },
} as unknown as RestaurantArtifact;

const nested = {
  ...converted,
  pages: [
    ...(converted.pages as object[]),
    { path: "resources", title: "Resources", enabled: true, kind: "standard", blocks: block("Resources") },
    { path: "resources/faqs", title: "FAQs", enabled: true, kind: "standard", blocks: block("FAQs"), seo: { noindex: true } },
  ],
  navigation: {
    items: [
      { label: "Home", href: "/" },
      { label: "Resources", href: "/resources", children: [{ label: "FAQs", href: "/resources/faqs" }] },
    ],
    header_cta: { label: "Plan a trip", href: "/contact" },
    wordmark: "GOGI",
  },
  site_routes: {
    ...(converted.site_routes as object),
    redirects: [
      { from: "/destinations", to: "/stamped-destinations", status: 308 },
      { from: "/old-faqs", to: "/resources/faqs", status: 301 },
    ],
  },
} as unknown as RestaurantArtifact;

describe("#2829 one resolver, in AD-5 order", () => {
  it("serves a nested page at its full path", () => {
    const resolved = resolveSitePath(nested, "resources/faqs");
    expect(resolved.kind === "page" && resolved.page.title).toBe("FAQs");
    expect(resolveSitePath(nested, "")).toMatchObject({ kind: "page" });
  });
  it("answers the redirect table first, with the owner's status", () => {
    expect(resolveSitePath(nested, "destinations")).toEqual({ kind: "redirect", location: "/stamped-destinations", status: 308 });
    expect(resolveSitePath(nested, "old-faqs")).toEqual({ kind: "redirect", location: "/resources/faqs", status: 301 });
  });
  it("does not serve an unpublished page, a partial path or an unknown one", () => {
    expect(resolveSitePath(nested, "menu")).toEqual({ kind: "not_found" });
    expect(resolveSitePath(nested, "resources/faq")).toEqual({ kind: "not_found" });
    expect(resolveSitePath(nested, "faqs")).toEqual({ kind: "not_found" });
  });
  it("routes earlier role artifacts through the same entry, retired roles included", () => {
    expect(resolveSitePath(legacy, "about")).toMatchObject({ kind: "page" });
    expect(resolveSitePath(legacy, "")).toMatchObject({ kind: "page" });
    expect(resolveSitePath(legacy, "menu")).toEqual({ kind: "not_found" });
  });
});

describe("#2829 menus", () => {
  it("legacy menus are the published pages in menu order with their menu labels", () => {
    expect(siteNavigation(legacy)).toEqual([
      { label: "Home", href: "/" },
      { label: "About us", href: "/about" },
      { label: "Contact", href: "/contact" },
    ]);
  });
  it("renders dropdown children, marks the current page, and uses the header button and wordmark", () => {
    const faqs = resolveSitePath(nested, "resources/faqs");
    if (faqs.kind !== "page") throw new Error("expected page");
    const html = renderToStaticMarkup(<RestaurantV1 artifact={nested} page={faqs.page} />);
    expect(html).toContain('class="nav-group"');
    expect(html).toMatch(/<ul class="nav-children" aria-label="Resources pages"><li><a aria-current="page" href="\/resources\/faqs">FAQs<\/a><\/li><\/ul>/);
    expect(html).toContain(">GOGI</a>");
    expect(html).toMatch(/class="header-action accent"[^>]*>Plan a trip|href="\/contact" class="header-action accent">Plan a trip/);
  });
  it("leaves noindex pages out of the indexable set", () => {
    expect(navigablePages(nested).filter(isIndexable).map(hrefForPage)).not.toContain("/resources/faqs");
    expect(navigablePages(nested).filter(isIndexable).map(hrefForPage)).toContain("/resources");
  });
});

describe("#2829 a converted role site renders the same HTML", () => {
  for (const [label, path] of [["home", ""], ["about", "about"], ["contact", "contact"]] as const) {
    it(`${label} is byte-identical before and after the conversion`, () => {
      const before = resolveSitePath(legacy, path);
      const after = resolveSitePath(converted, path);
      if (before.kind !== "page" || after.kind !== "page") throw new Error("expected pages");
      expect(renderToStaticMarkup(<RestaurantV1 artifact={converted} page={after.page} />))
        .toBe(renderToStaticMarkup(<RestaurantV1 artifact={legacy} page={before.page} />));
      expect(after.page.key).toBe(before.page.key);
    });
  }
  it("home is the same page in both", () => {
    expect(homePage(converted)?.isHome && homePage(legacy)?.isHome).toBe(true);
  });
});

describe("#2829 the catch-all route replaced the home and one-segment routes", () => {
  it("exists, and the old routes are gone", () => {
    const app = path.resolve(process.cwd(), "src/app");
    expect(fs.existsSync(path.join(app, "[[...path]]/page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(app, "page.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(app, "[slug]/page.tsx"))).toBe(false);
    const route = fs.readFileSync(path.join(app, "[[...path]]/page.tsx"), "utf8");
    expect(route).toContain("resolveSitePath(artifact, path)");
    expect(route).toContain("primaryRedirectUrl(resolution");
  });

  it("the sitemap lists only indexable pages (noindex pages are left out)", () => {
    const sitemap = fs.readFileSync(path.resolve(process.cwd(), "src/app/sitemap.ts"), "utf8");
    expect(sitemap).toContain("navigablePages(artifact).filter(isIndexable)");
  });
});
