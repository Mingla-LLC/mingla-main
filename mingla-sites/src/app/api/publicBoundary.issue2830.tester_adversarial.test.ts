/*
 * #2830 — INDEPENDENT TESTER PASS: what does an anonymous caller get to assert?
 *
 * Checklist item 12 of #2830 asks for an independent tenant-isolation pass.
 * Every published Mingla site is a public web server, so the honest place to
 * start is the request that needs no credential at all.
 *
 * The renderer has four entry points that reach Core. Three of them take the
 * site they are acting for from the REQUEST BODY. One takes it from the
 * publication the hostname resolved to. Only the last of those is a tenant
 * binding; the others are the caller repeating back an id, and the thing that
 * currently stops a caller naming someone else's id is a single-tenant
 * constant (`pilotSiteId`) rather than the host the request arrived on.
 *
 * These tests do NOT claim the pilot is exploitable today. With one site the
 * constant holds, and Core's own routine re-checks the site/brand/publication
 * triple against the database, which is the layer that genuinely binds. They
 * assert the SHAPE the boundary has to have before a second site exists, and
 * they name the route that already has that shape as the reference.
 *
 * Also here: the residual of #3164. That fix stops one dropped block from
 * failing the whole publish and stops an emptied inner page staying in the
 * navigation. It exempts home — deliberately, with a comment promising an
 * empty home is "a publish-time problem to surface". These tests ask whether
 * anything surfaces it.
 *
 * Run: npm test -- src/app/api/publicBoundary.issue2830.tester_adversarial
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertRestaurantArtifact } from "../../contracts/artifact";
import { normalizePublicHost } from "../../lib/publication";
import { areCandidateLinksSafe } from "./internal/candidate-probe/route";

const SRC = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(SRC, relative), "utf8");

/* ------------------------------------------------------------------ *
 * 1. Where does each public route learn which site it is acting for?
 * ------------------------------------------------------------------ */

/**
 * The reference shape, taken from the route that already gets this right:
 * resolve the host, load the publication, and read the site off the ARTIFACT.
 */
const HOST_DERIVED = /artifact\.site_id|venue\.siteId/;

describe("#2830 a public route's tenant comes from the host, not from the caller", () => {
  it("the order route is the reference: it never takes a site id from the body", () => {
    const source = read("app/api/order/route.ts");
    expect(source).toMatch(HOST_DERIVED);
    expect(source).toContain("loadPublication(host)");
    // The body supplies lines, a buyer and an idempotency key. Never identity.
    expect(source).not.toMatch(/siteId:\s*String\(\s*(payload|body|event)\./);
  });

  it("the analytics route derives its site from the resolved publication", () => {
    const source = read("app/api/events/route.ts");
    expect(
      source,
      "src/app/api/events/route.ts interpolates a site id straight out of the anonymous request body into a Core path and signs for it. Nothing reconciles that id, or the brand_id and publication_id beside it, with the publication the hostname resolved to — the way src/app/api/order/route.ts does. Today a single-tenant constant refuses any other id; that constant is not a host binding and does not survive a second site.",
    ).toMatch(HOST_DERIVED);
  });

  it("the attribution route derives its site from the resolved publication", () => {
    const source = read("app/api/attribution/route.ts");
    expect(
      source,
      "src/app/api/attribution/route.ts takes site, brand and publication ids from the anonymous request body and never reconciles them with the publication the hostname resolved to.",
    ).toMatch(HOST_DERIVED);
  });
});

describe("#2830 the public hostname itself is pinned", () => {
  it("refuses a forged forwarding header, a port, and a trailing dot", () => {
    expect(() => normalizePublicHost("evil.example.com")).toThrow();
    expect(() => normalizePublicHost("gogi.sites.usemingla.com:8443")).toThrow();
    expect(() => normalizePublicHost("gogi.sites.usemingla.com.")).toThrow();
    expect(() => normalizePublicHost("GOGI.SITES.USEMINGLA.COM.evil.com"))
      .toThrow();
    expect(() => normalizePublicHost(null)).toThrow();
    // A forwarding header may carry a list; only the first hop is considered,
    // so a second value cannot smuggle a different host past the check.
    expect(() => normalizePublicHost("evil.com, gogi.sites.usemingla.com"))
      .toThrow();
    expect(normalizePublicHost("GOGI.sites.usemingla.com")).toBe(
      "gogi.sites.usemingla.com",
    );
  });
});

/* ------------------------------------------------------------------ *
 * 2. #3164's residual: the page the fix deliberately left alone.
 * ------------------------------------------------------------------ */

const HERO = {
  type: "hero",
  heading: "Gogi",
  media_url:
    "https://gogi.sites.usemingla.com/media/00000000-0000-4000-8000-000000000004/1440.webp",
  ctas: [],
};

function artifactWith(pages: unknown[]): Record<string, unknown> {
  return {
    schema_version: 1,
    site_id: "00000000-0000-4000-8000-000000000001",
    brand_id: "00000000-0000-4000-8000-000000000002",
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    publication_id: "00000000-0000-4000-8000-000000000003",
    source_revision_id: "revision-1",
    source_digest: "a".repeat(64),
    generated_at: new Date(0).toISOString(),
    pages,
    navigation: { page_roles: ["home"] },
    footer: {},
    site_settings: {
      display_name: "Gogi",
      seo: { canonical_url: "https://gogi.sites.usemingla.com" },
    },
    media: [{
      id: "00000000-0000-4000-8000-000000000004",
      url:
        "https://gogi.sites.usemingla.com/media/00000000-0000-4000-8000-000000000004/1440.webp",
      alt: "",
      width: 1440,
      height: 900,
      integrity: "b".repeat(64),
      object_key:
        "approved/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000004/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/1440.webp",
    }],
    commercial_references: [],
  };
}

const page = (
  role: string,
  blocks: unknown[],
  extra: Record<string, unknown> = {},
) => ({
  role,
  slug: role === "home" ? "/" : role,
  title: role,
  enabled: true,
  nav_label: role,
  nav_order: role === "home" ? 0 : 1,
  blocks,
  ...extra,
});

describe("#3164 a home page with nothing on it", () => {
  it("the control artifact is accepted, so a refusal below means something", () => {
    expect(() => assertRestaurantArtifact(artifactWith([page("home", [HERO])])))
      .not.toThrow();
  });

  it("is refused before it can be published", () => {
    /*
     * Every block the builder cannot build returns null and is filtered out.
     * Home is exempt from the "a page with no blocks is not a page" rule, so a
     * home page whose blocks all dropped arrives here as an empty array. The
     * contract bounds the array from ABOVE (40) and not from below.
     */
    const blankHome = artifactWith([
      page("home", []),
      page("about", [HERO]),
    ]);
    expect(
      () => assertRestaurantArtifact(blankHome),
      "the artifact contract accepts a home page with zero blocks. Combined with the builder's deliberate home exemption, a site whose home blocks all dropped publishes a homepage carrying a header, a footer and nothing else. The comment on that exemption promises an empty home is a publish-time problem to surface; nothing surfaces it.",
    ).toThrow();
  });

  it("is not caught by the one probe check that looks at content", () => {
    /*
     * `accessibility_ok` is the only candidate-probe flag that asks whether the
     * artifact has any content, and it asks across the FLATTENED set of every
     * page's blocks. A hero on an inner page satisfies it while home is empty,
     * so the probe cannot distinguish "the site has a hero" from "the home page
     * has a hero". Recorded here as the coverage gap it is; this assertion
     * passes today and is evidence, not a defect on its own.
     */
    const pages = [page("home", []), page("about", [HERO])];
    const allBlocks = pages.flatMap((entry) => entry.blocks);
    const accessibilityOk = allBlocks.some((block) =>
      (block as { type?: string }).type === "hero" &&
      typeof (block as { heading?: unknown }).heading === "string"
    );
    expect(accessibilityOk).toBe(true);
    expect(areCandidateLinksSafe(allBlocks as never)).toBe(true);
  });

  it("the builder's home exemption is still the reason this can happen", () => {
    const builder = readFileSync(
      join(SRC, "..", "..", "mingla-site-cms", "src", "lib", "artifactBuilder.ts"),
      "utf8",
    );
    // The fix filters dropped blocks, and disables an emptied page — except home.
    expect(builder).toContain(".filter(Boolean)");
    expect(builder).toMatch(
      /page\.role === "home"\s*\?\s*page\.enabled\s*:\s*page\.enabled === true && rendered\.length > 0/,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3. What holds. Kept beside the gaps so a regression is visible.
 * ------------------------------------------------------------------ */

describe("#2830 the artifact contract refuses the shapes a dropped block produces", () => {
  it("refuses a null block, which is what #3164 was", () => {
    expect(() =>
      assertRestaurantArtifact(artifactWith([page("home", [HERO, null])]))
    ).toThrow();
  });

  it("refuses more pages than the pilot contract allows", () => {
    const pages = ["home", "about", "menu", "gallery", "contact", "a", "b"]
      .map((role) => page(role, [HERO]));
    expect(() => assertRestaurantArtifact(artifactWith(pages))).toThrow();
  });

  it("refuses an artifact with no home page at all", () => {
    expect(() => assertRestaurantArtifact(artifactWith([page("about", [HERO])])))
      .toThrow();
  });

  it("refuses a block array longer than the contract's ceiling", () => {
    const tooMany = Array.from({ length: 41 }, () => ({ ...HERO }));
    expect(() => assertRestaurantArtifact(artifactWith([page("home", tooMany)])))
      .toThrow();
  });
});
