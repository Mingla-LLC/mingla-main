/*
 * #2829 W2 (T-W2) — the page tree and the PATH_COLLISION publish refusal.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();
vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({
  readCoreProjection: async () => ({ offerings: [], menu: [], menu_venue_id: null }),
}));
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => {
    stored.set(`${bucket}:${key}`, bytes);
  },
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
}));

import {
  ariPageAddress,
  assertNoPathCollision,
  pageTreePaths,
  siteRouting,
  type TreePage,
} from "./pageTree";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";

const page = (id: string, slug: string | null, parent: string | null = null, extra: Partial<TreePage> = {}): TreePage =>
  ({ id, slug, parent, ...extra });

beforeEach(() => stored.clear());

describe("#2829 page tree", () => {
  it("computes nested addresses up to three levels", () => {
    const result = pageTreePaths([
      page("h", null),
      page("r", "resources"),
      page("f", "faqs", "r"),
      page("x", "extra", "f"),
    ]);
    expect(result.ok && Object.fromEntries(result.paths)).toEqual({
      h: "", r: "resources", f: "resources/faqs", x: "resources/faqs/extra",
    });
  });

  it("refuses a fourth level, a loop, a missing parent and a child of home", () => {
    expect(pageTreePaths([page("h", null), page("a", "a"), page("b", "b", "a"), page("c", "c", "b"), page("d", "d", "c")]))
      .toMatchObject({ ok: false, problem: "DEPTH_EXCEEDED" });
    expect(pageTreePaths([page("h", null), page("a", "a", "b"), page("b", "b", "a")]))
      .toMatchObject({ ok: false, problem: "PARENT_CYCLE" });
    expect(pageTreePaths([page("h", null), page("a", "a", "nope")]))
      .toMatchObject({ ok: false, problem: "PARENT_MISSING" });
    expect(pageTreePaths([page("h", null), page("a", "a", "h")]))
      .toMatchObject({ ok: false, problem: "PARENT_IS_HOME" });
  });

  it("refuses two pages at one address, a second home, a bad or reserved slug", () => {
    expect(pageTreePaths([page("h", null), page("a", "about"), page("b", "about")]))
      .toMatchObject({ ok: false, problem: "SLUG_DUPLICATE" });
    expect(pageTreePaths([page("h", null), page("h2", null)]))
      .toMatchObject({ ok: false, problem: "HOME_DUPLICATE" });
    expect(pageTreePaths([page("h", null), page("a", "About")]))
      .toMatchObject({ ok: false, problem: "SLUG_INVALID" });
    expect(pageTreePaths([page("h", null), page("a", "preview")]))
      .toMatchObject({ ok: false, problem: "SLUG_RESERVED" });
    // A reserved word is fine below the top level (it cannot shadow a route there).
    expect(pageTreePaths([page("h", null), page("a", "help"), page("b", "preview", "a")]).ok).toBe(true);
  });

  it("allows the same slug under different parents", () => {
    expect(pageTreePaths([page("h", null), page("a", "a"), page("b", "b"), page("a1", "faq", "a"), page("b1", "faq", "b")]).ok)
      .toBe(true);
  });

  it("requires a collection on a list page", () => {
    expect(pageTreePaths([page("h", null), page("t", "trips", null, { kind: "collection_index" })]))
      .toMatchObject({ ok: false, problem: "COLLECTION_INVALID" });
    expect(pageTreePaths([page("h", null), page("t", "trips", null, { kind: "collection_index", collection: "trips" })]).ok)
      .toBe(true);
  });
});

describe("#2829 site routing settings", () => {
  it("defaults the base paths and keeps an empty stories path as the root", () => {
    expect(siteRouting({}).routes.trips).toBe("trips");
    expect(siteRouting({ routes: { trips: "", stories: "" } }).routes).toMatchObject({ trips: "trips", stories: "" });
  });
  it("refuses a broken redirect rather than publishing it", () => {
    expect(() => siteRouting({ redirects: [{ from: "/x", to: "javascript:alert(1)", status: "308" }] }))
      .toThrow("VALIDATION_FAILED");
    expect(siteRouting({ redirects: [{ from: "/destinations", to: "/stamped-destinations", status: "308" }] }).redirects)
      .toEqual([{ from: "/destinations", to: "/stamped-destinations", status: 308 }]);
  });
});

describe("#2829 PATH_COLLISION", () => {
  const docs = [
    { id: "h", slug: "", parent: null, enabled: true },
    { id: "a", slug: "about", parent: null, enabled: true },
  ];
  it("passes a clean site", () => {
    expect(() => assertNoPathCollision(docs, {})).not.toThrow();
  });
  it("refuses two pages at one address", () => {
    expect(() => assertNoPathCollision([...docs, { id: "b", slug: "about", parent: null, enabled: true }], {}))
      .toThrow("PATH_COLLISION");
  });
  it("refuses a redirect away from a live page, but not from a page that is off", () => {
    const settings = { redirects: [{ from: "/about", to: "/", status: "308" }] };
    expect(() => assertNoPathCollision(docs, settings)).toThrow("PATH_COLLISION");
    expect(() => assertNoPathCollision(docs, settings, new Set(["h"]))).not.toThrow();
  });
  it("refuses two collections on one base path", () => {
    expect(() => assertNoPathCollision(docs, { routes: { trips: "journeys", events: "journeys" } }))
      .toThrow("PATH_COLLISION");
  });
});

describe("#2829 the builder refuses a collision and writes NOTHING", () => {
  it("throws PATH_COLLISION before any artifact is stored", async () => {
    const pages = [
      { id: "h", tenant: "t", slug: "", parent: null, title: "Home", enabled: true, blocks: [{ blockType: "faq", heading: "Hi", items: [{ question: "Q?", answer: "A." }] }] },
      { id: "a", tenant: "t", slug: "about", parent: null, title: "About", enabled: true, blocks: [{ blockType: "faq", heading: "About", items: [{ question: "Q?", answer: "A." }] }] },
    ];
    const settings = { id: "s", tenant: "t", display_name: "Clash", redirects: [{ from: "/about", to: "/", status: "308" }] };
    const collections: Record<string, unknown[]> = {
      pages, navigation: [{ id: "n", tenant: "t", items: [] }], footer: [{ id: "f", tenant: "t" }],
      "site-settings": [settings], media: [],
    };
    const sourceDigest = await publicationDraftDigest({
      pages, navigation: collections.navigation![0]!, footer: collections.footer![0]!, settings, media: [],
    });
    await expect(buildPublicationArtifact(
      { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never,
      {
        tenant: { id: "t", core_site_id: "00000000-0000-4000-8000-000000000b02", core_brand_id: "00000000-0000-4000-8000-000000000b03", primary_hostname: "clash.sites.localhost" },
        operationId: "op", publicationId: "00000000-0000-4000-8000-000000000b04",
        sourceRevisionId: "r", sourceDigest, generatedAt: "2026-10-26T00:00:00Z",
      },
    )).rejects.toThrow("PATH_COLLISION");
    expect(stored.size).toBe(0);
  });

  it("drops a menu link to a page that is not published instead of linking to nothing", async () => {
    const faq = [{ blockType: "faq", heading: "Hi", items: [{ question: "Q?", answer: "A." }] }];
    const pages = [
      { id: "h", tenant: "t", slug: "", parent: null, title: "Home", enabled: true, blocks: faq },
      { id: "off", tenant: "t", slug: "hidden", parent: null, title: "Hidden", enabled: false, blocks: faq },
      { id: "empty", tenant: "t", slug: "empty", parent: null, title: "Empty", enabled: true, blocks: [] },
    ];
    const settings = { id: "s", tenant: "t", display_name: "Links" };
    // The W2 footer fields exist on every footer row; they must not leak into
    // this artifact form (its contract refuses unknown keys).
    const footer = {
      id: "f", tenant: "t", label: "Website footer", address: "1 Road", hours_summary: null, legal_text: "c",
      links: [{ id: "l1", label: "Mail", href: "mailto:a@b.co" }], tagline_lines: [], location: null, email: null,
      columns: [], socials: [], copyright: null, built_by: { label: null, url: null }, createdAt: "x", updatedAt: "y", _status: "draft",
    };
    const navigation = { id: "n", tenant: "t", items: [
      { label: "Home", target_type: "page", page: "h" },
      { label: "Hidden", target_type: "page", page: "off" },
      { label: "Empty", target_type: "page", page: "empty" },
      { label: "Elsewhere", target_type: "url", url: "https://example.com/x" },
      { label: "Plain http", target_type: "url", url: "http://example.com/x" },
    ] };
    const collections: Record<string, unknown[]> = {
      pages, navigation: [navigation], footer: [footer], "site-settings": [settings], media: [],
    };
    const sourceDigest = await publicationDraftDigest({ pages, navigation, footer, settings, media: [] });
    const { artifact } = await buildPublicationArtifact(
      { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never,
      {
        tenant: { id: "t", core_site_id: "00000000-0000-4000-8000-000000000b02", core_brand_id: "00000000-0000-4000-8000-000000000b03", primary_hostname: "links.sites.localhost" },
        operationId: "op", publicationId: "00000000-0000-4000-8000-000000000b05",
        sourceRevisionId: "r", sourceDigest, generatedAt: "2026-10-26T00:00:00Z",
      },
    );
    expect((artifact.navigation as { items: unknown[] }).items).toEqual([
      { label: "Home", href: "/" },
      { label: "Elsewhere", href: "https://example.com/x" },
    ]);
    expect(artifact.footer).toEqual({
      address: "1 Road", hours_summary: null, legal_text: "c", links: [{ label: "Mail", href: "mailto:a@b.co" }],
    });
    const contract = (await import("../contracts/generated/artifactV2.ts").then((m) => ({ assertRestaurantArtifact: m.assertArtifactV2 }))) as { assertRestaurantArtifact: (value: unknown) => void };
    expect(() => contract.assertRestaurantArtifact(JSON.parse(JSON.stringify(artifact)))).not.toThrow();
    // #2829 W3 — v2 artifacts carry routes, redirects and language at the top level.
    expect({ routes: artifact.routes, redirects: artifact.redirects, language: artifact.language }).toEqual({
      routes: { trips: "trips", events: "events", experiences: "experiences", destinations: "destinations", stories: "stories" },
      redirects: [],
      language: "en",
    });
  });
});

describe("#2829 Ari reads pages by address", () => {
  it("names home and top-level role pages the way Ari's tools still ask for them", () => {
    expect(ariPageAddress({ slug: "" })).toEqual({ page_path: "", page_role: "home" });
    expect(ariPageAddress({ slug: "menu", parent: null })).toEqual({ page_path: "menu", page_role: "menu" });
    expect(ariPageAddress({ slug: "story", parent: null })).toEqual({ page_path: "story", page_role: null });
    expect(ariPageAddress({ slug: "faqs", parent: "p" })).toEqual({ page_path: null, page_role: null });
  });

  it("the Ari endpoint resolves page_role through the page path, never a role column", () => {
    const endpoints = fs.readFileSync(path.resolve(process.cwd(), "src/endpoints/sitesEndpoints.ts"), "utf8");
    expect(endpoints).toContain('(args.page_role === "home" ? "" : args.page_role)');
    expect(endpoints).not.toMatch(/role: \{ equals:/);
  });
});

describe("#2829 Studio refuses a bad tree edit in plain words", () => {
  const TENANT = "00000000-0000-4000-8000-000000000c01";
  const existing = [
    { id: "home", tenant: TENANT, slug: "", parent: null, title: "Home" },
    { id: "about", tenant: TENANT, slug: "about", parent: null, title: "About" },
    { id: "a", tenant: TENANT, slug: "a", parent: null, title: "A" },
    { id: "b", tenant: TENANT, slug: "b", parent: "a", title: "B" },
    { id: "c", tenant: TENANT, slug: "c", parent: "b", title: "C" },
  ];
  const hook = async (data: Record<string, unknown>) => {
    const { Pages } = await import("../collections/Pages");
    const beforeChange = Pages.hooks!.beforeChange![0]!;
    const req = {
      user: { tenantId: TENANT },
      context: {},
      t: (key: string) => key,
      payload: { find: async () => ({ docs: existing, totalDocs: existing.length }) },
    };
    return beforeChange({ data, req, operation: "create", originalDoc: undefined } as never);
  };

  it("a duplicate address is a 400 field error naming the problem", async () => {
    await expect(hook({ title: "Again", slug: "about", revision: 1 })).rejects.toMatchObject({
      name: "ValidationError",
      status: 400,
      data: { errors: [{ path: "slug", message: "Another page already uses this address. Choose a different one." }] },
    });
  });

  it("a fourth level is refused on the parent field", async () => {
    await expect(hook({ title: "Deep", slug: "d", parent: "c", revision: 1 })).rejects.toMatchObject({
      status: 400,
      data: { errors: [{ path: "parent", message: "Pages can be at most three levels deep." }] },
    });
  });

  it("a valid nested page is accepted and stored with its kind and parent", async () => {
    const result = await hook({ title: "FAQs", slug: "faqs", parent: "about", revision: 1 }) as Record<string, unknown>;
    expect(result).toMatchObject({ slug: "faqs", parent: "about", kind: "standard", revision: 1 });
  });
});

describe("#2829 the preview carries only a shape-checked page path", () => {
  it("accepts slug paths and refuses anything else", async () => {
    const { previewPagePath } = await import("./previewPath");
    expect(previewPagePath("resources/faqs")).toBe("resources/faqs");
    expect(previewPagePath("/about/")).toBe("about");
    for (const bad of ["", null, "../x", "a//b", "About", "https://evil.example", "a/b/c/d/e", "x?y=1"]) {
      expect(previewPagePath(bad)).toBeNull();
    }
  });
  it("Studio's preview page and its preview redirect both forward it", () => {
    const page = fs.readFileSync(path.resolve(process.cwd(), "src/app/(frontend)/preview/page.tsx"), "utf8");
    const endpoints = fs.readFileSync(path.resolve(process.cwd(), "src/endpoints/sitesEndpoints.ts"), "utf8");
    expect(page).toContain('if (pagePath) query.set("path", pagePath);');
    expect(endpoints).toContain('if (requestedPath) target.searchParams.set("path", requestedPath);');
  });
});
