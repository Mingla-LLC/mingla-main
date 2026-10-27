/*
 * #2829 W1 — Studio for more than one brand.
 *
 * The builder takes each tenant's canonical from Core's primary host (two
 * tenants, two addresses, a stored or defaulted canonical is ignored), media
 * URLs are relative, a tenant with no known address cannot build, exports are
 * real zips, and no single-brand address remains in Studio code.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
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

import { buildPublicationArtifact, publicationDraftDigest, tenantCanonicalUrl } from "./artifactBuilder";
import { buildZip, exportObjectKey, jsonEntry, zipEntryNames } from "./siteExport";

beforeEach(() => stored.clear());

async function build(tenant: Record<string, unknown>) {
  const settings = {
    id: "settings-1", tenant: tenant.id, display_name: "Brand",
    background_color: "#111111", foreground_color: "#eeeeee", accent_color: "#cc9900",
    typography: "condensed-display",
    // A stale stored value must never reach the artifact.
    canonical_url: "https://somebody-else.sites.usemingla.com",
  };
  const page = {
    id: "page-home", tenant: tenant.id, role: "home", slug: "" /* #2829 W2: home has no slug */, title: "Home",
    enabled: true, nav_label: "Home", nav_order: 0, blocks: [{ blockType: "divider" }],
  };
  const collections: Record<string, unknown[]> = {
    pages: [page],
    navigation: [{ id: "nav-1", tenant: tenant.id, pages: ["page-home"] }],
    footer: [{ id: "footer-1", tenant: tenant.id }],
    "site-settings": [settings],
    media: [],
  };
  const sourceDigest = await publicationDraftDigest({
    pages: collections.pages!, navigation: collections.navigation![0] ?? null,
    footer: collections.footer![0] ?? null, settings, media: [],
  });
  const req = {
    context: {},
    payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) },
  } as never;
  return buildPublicationArtifact(req, {
    tenant: tenant as never,
    operationId: "op-2829",
    publicationId: "00000000-0000-4000-8000-000000000904",
    sourceRevisionId: "rev-2829",
    sourceDigest,
    generatedAt: "2026-10-25T00:00:00Z",
  });
}

const artifactOf = (key: string) =>
  JSON.parse(new TextDecoder().decode(stored.get(`artifact-bucket:${key}`)!));

describe("#2829 each tenant publishes under its own address", () => {
  it("takes the canonical from the tenant's primary host, never the stored value", async () => {
    const first = await build({ id: "t1", core_site_id: "00000000-0000-4000-8000-000000000001", core_brand_id: "00000000-0000-4000-8000-000000000002", primary_hostname: "first.sites.usemingla.com" });
    const second = await build({ id: "t2", core_site_id: "00000000-0000-4000-8000-000000000011", core_brand_id: "00000000-0000-4000-8000-000000000012", primary_hostname: "second.sites.localhost" });
    // #2829 W3 — v2 artifacts carry the canonical at `seo.canonical_url`.
    expect(artifactOf(first.artifactKey).seo.canonical_url).toBe("https://first.sites.usemingla.com");
    expect(artifactOf(second.artifactKey).seo.canonical_url).toBe("https://second.sites.localhost");
  });

  it("refuses to build for a tenant whose address is unknown", async () => {
    await expect(build({ id: "t3", core_site_id: "00000000-0000-4000-8000-000000000021", core_brand_id: "00000000-0000-4000-8000-000000000022" })).rejects.toThrow();
  });

  it("validates hostnames before using them", () => {
    expect(tenantCanonicalUrl({ primary_hostname: "ok.sites.usemingla.com" })).toBe("https://ok.sites.usemingla.com");
    for (const bad of ["", "Bad.example.com", "evil.com/path", "a..b", "x"]) {
      expect(tenantCanonicalUrl({ primary_hostname: bad })).toBeUndefined();
    }
  });
});

describe("#2829 exports", () => {
  it("writes a real zip with every entry and a per-site key", () => {
    const zip = buildZip([jsonEntry("pages.json", [{ id: 1 }]), { name: "media/a.webp", bytes: new Uint8Array([1, 2, 3]) }]);
    expect(zipEntryNames(zip)).toEqual(["pages.json", "media/a.webp"]);
    expect(exportObjectKey("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"))
      .toBe("exports/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.zip");
    expect(() => buildZip([{ name: "../escape", bytes: new Uint8Array() }])).toThrow();
    expect(() => exportObjectKey("../x", "00000000-0000-4000-8000-000000000002")).toThrow();
  });
});

describe("#2829 no single-brand address in Studio code", () => {
  it("names no fixed site host and no fixed tenant name outside migrations and tests", () => {
    const root = path.resolve(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "migrations" && name !== "node_modules") walk(full);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "payload-types.ts") {
          files.push(full);
        }
      }
    };
    walk(root);
    const offenders = files.filter((file) =>
      /gogi\.sites\.usemingla\.com|Gogi Restaurant/.test(
        readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe("#2829 a new tenant's first documents are written", () => {
  // The multi-tenant plugin refuses tenant assignment on a userless REST
  // request; Core's signed provisioning call carries no Studio user, so its
  // writes must run as server-side Local API work, and a tenant left without a
  // home page by an earlier failure must be healed on the next provision.
  const source = readFileSync(path.resolve(__dirname, "../endpoints/sitesEndpoints.ts"), "utf8");
  const provision = source.slice(source.indexOf("async function provisionOrReconcile"), source.indexOf("async function publish("));
  it("marks provisioning writes as Local API work", () => {
    expect(provision).toMatch(/const provisioningRequest = \{\s*\.\.\.req,\s*payloadAPI: "local",/);
  });
  it("re-creates the default documents for a tenant with no home page", () => {
    // #2829 W2 — the existence check reads through findAllTenantPages (no capped page read).
    expect(provision).toContain("const existingHome = (await findAllTenantPages(req, tenant.id");
    expect(provision.indexOf("if (!existingHome)")).toBeGreaterThan(provision.indexOf("if (!tenant)"));
  });
});
