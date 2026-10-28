/*
 * #2829 W1 — the runtime serves more than one brand.
 *
 * T-W1: request-scoped Core binding, 308 to the primary host, preview-key host
 * binding, per-host resolution caches, and canonical/media bound to the site's
 * own address.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signedCorePost, HOST_RESOLUTION_SITE_ID } from "./coreGateway";
import {
  clearResolutionCaches,
  primaryRedirectUrl,
  resolveHost,
  type ResolvedSite,
} from "./publication";
import { loadPreviewArtifact, parsePreviewArtifactKey } from "./previewArtifact";
import { assertRestaurantArtifact } from "../contracts/artifact";

const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SITE_B = "bbbbbbbb-2222-4222-8222-222222222222";

beforeAll(() => {
  Object.assign(process.env, {
    SITES_CORE_BASE_URL: "https://gqnoajqerqhnvulmnyvv.supabase.co",
    SITES_CMS_PROJECT_REF: "abcdefghijklmnopqrst",
    SITES_STORAGE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SITES_STORAGE_SUPABASE_ANON_KEY: "fixture-anon-key",
    SITES_STORAGE_READER_EMAIL: "sites-reader@example.invalid",
    SITES_STORAGE_READER_PASSWORD: "fixture-reader-password",
    SITES_PUBLICATION_ARTIFACT_BUCKET: "sites-publication-artifacts",
    SITES_MEDIA_APPROVED_BUCKET: "sites-media-approved",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KID: "runtime-key-1",
    MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
    SITES_CANDIDATE_PROBE_SECRET: "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=",
  });
});

beforeEach(() => clearResolutionCaches());
afterEach(() => vi.unstubAllGlobals());

function resolution(over: Partial<ResolvedSite> = {}): ResolvedSite {
  return {
    site_id: SITE_A,
    brand_id: "cccccccc-3333-4333-8333-333333333333",
    publication_id: "dddddddd-4444-4444-8444-444444444444",
    artifact_key: "x",
    artifact_digest: "a".repeat(64),
    artifact_schema_version: 1,
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    hostname: "first.sites.usemingla.com",
    primary_hostname: "first.sites.usemingla.com",
    is_primary: true,
    host_kind: "mingla_subdomain",
    design_key: null,
    ...over,
  };
}

function envelopeOf(init: RequestInit | undefined): { site_id: string; path: string } {
  const header = new Headers(init?.headers).get("x-mingla-sites-envelope") ?? "";
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

describe("#2829 request-scoped Core binding", () => {
  it("signs a call for the resolved site and refuses any other site id", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    await signedCorePost({
      edgeFunction: "brand-site-attribution",
      path: `/internal/v1/sites/${SITE_A}/analytics-events`,
      site: { site_id: SITE_A },
      body: { site_id: SITE_A },
    });
    expect(envelopeOf(fetchSpy.mock.calls[0][1]).site_id).toBe(SITE_A);
    await expect(signedCorePost({
      edgeFunction: "brand-site-attribution",
      path: `/internal/v1/sites/${SITE_B}/analytics-events`,
      site: { site_id: SITE_A },
      body: { site_id: SITE_B },
    })).rejects.toThrow("SITE_SCOPE_MISMATCH");
    await expect(signedCorePost({
      edgeFunction: "brand-site-attribution",
      path: `/internal/v1/sites/${HOST_RESOLUTION_SITE_ID}/x`,
      site: { site_id: HOST_RESOLUTION_SITE_ID },
      body: {},
    })).rejects.toThrow("SITE_SCOPE_MISMATCH");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("#2829 host resolution", () => {
  it("signs a host lookup with the host-resolution id and caches per host", async () => {
    const fetchSpy = vi.fn(async (...args: [string, RequestInit?]) => {
      const url = args[0];
      const host = String(url).split("/hosts/")[1].split("/")[0];
      return Response.json({ ok: true, data: resolution({
        site_id: host.startsWith("first") ? SITE_A : SITE_B,
        hostname: host, primary_hostname: host,
      }) });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const a = await resolveHost("first.sites.usemingla.com", 1_000);
    const b = await resolveHost("second.sites.usemingla.com", 1_000);
    expect(a.value.site_id).toBe(SITE_A);
    expect(b.value.site_id).toBe(SITE_B);
    expect(envelopeOf(fetchSpy.mock.calls[0][1]).site_id).toBe(HOST_RESOLUTION_SITE_ID);
    // Within 30 s: cached, per host (a revoked site must 404 within 30 s).
    await resolveHost("first.sites.usemingla.com", 29_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await resolveHost("first.sites.usemingla.com", 32_000);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("a refused host stays refused for 30 s and never falls back to an old answer", async () => {
    let refuse = false;
    const fetchSpy = vi.fn(async () => refuse
      ? Response.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 })
      : Response.json({ ok: true, data: resolution() }));
    vi.stubGlobal("fetch", fetchSpy);
    await resolveHost("first.sites.usemingla.com", 0);
    refuse = true; // e.g. the entitlement was revoked
    await expect(resolveHost("first.sites.usemingla.com", 31_000)).rejects.toThrow("NOT_FOUND");
    refuse = false;
    await expect(resolveHost("first.sites.usemingla.com", 50_000)).rejects.toThrow("NOT_FOUND");
    await expect(resolveHost("first.sites.usemingla.com", 62_000)).resolves.toBeTruthy();
  });

  it("serves the last good answer for 5 minutes only when Core is unreachable", async () => {
    let down = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (down) throw new Error("ECONNREFUSED");
      return Response.json({ ok: true, data: resolution() });
    }));
    await resolveHost("first.sites.usemingla.com", 0);
    down = true;
    expect((await resolveHost("first.sites.usemingla.com", 120_000)).stale).toBe(true);
    await expect(resolveHost("first.sites.usemingla.com", 400_000)).rejects.toThrow();
  });
});

describe("#2829 non-primary hosts", () => {
  it("308s to the same path on the primary host, query preserved", () => {
    expect(primaryRedirectUrl(resolution(), "/menu")).toBeNull();
    expect(primaryRedirectUrl(resolution({
      hostname: "old.example.com", is_primary: false,
      primary_hostname: "first.sites.usemingla.com",
    }), "/menu?x=1")).toBe("https://first.sites.usemingla.com/menu?x=1");
  });
});

describe("#2829 preview binding", () => {
  it("refuses a preview key for another site before reading storage", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const parsed = parsePreviewArtifactKey(
      `publications/${SITE_B}/preview-${"0".repeat(32)}/${"a".repeat(64)}.json`,
    );
    expect(parsed).not.toBeNull();
    await expect(loadPreviewArtifact(parsed!, { site_id: SITE_A })).rejects.toThrow("NOT_FOUND");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("#2829 an artifact cannot claim another brand's address", () => {
  const MEDIA = "00000000-0000-4000-8000-000000000004";
  const base = (canonical: string, mediaUrl: string) => ({
    schema_version: 1,
    site_id: "00000000-0000-4000-8000-000000000001",
    brand_id: "00000000-0000-4000-8000-000000000002",
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    publication_id: "00000000-0000-4000-8000-000000000003",
    source_revision_id: "r",
    source_digest: "a".repeat(64),
    generated_at: new Date(0).toISOString(),
    pages: [{ role: "home", slug: "/", title: "Home", enabled: true, nav_label: "Home", nav_order: 0, blocks: [{ type: "divider" }] }],
    navigation: { page_roles: ["home"] },
    footer: {},
    site_settings: { display_name: "A", seo: { canonical_url: canonical } },
    media: [{
      id: MEDIA, url: mediaUrl, alt: "", width: 1440, height: 900, integrity: "b".repeat(64),
      object_key: `approved/00000000-0000-4000-8000-000000000001/${MEDIA}/${"b".repeat(64)}/1440.webp`,
    }],
    commercial_references: [],
  });

  it("accepts relative media and absolute media on its own canonical origin", () => {
    expect(() => assertRestaurantArtifact(base("https://first.sites.usemingla.com", `/media/${MEDIA}/1440.webp`))).not.toThrow();
    expect(() => assertRestaurantArtifact(base("https://first.sites.usemingla.com", `https://first.sites.usemingla.com/media/${MEDIA}/1440.webp`))).not.toThrow();
  });

  it("refuses absolute media on another brand's host and a malformed canonical", () => {
    expect(() => assertRestaurantArtifact(base("https://first.sites.usemingla.com", `https://second.sites.usemingla.com/media/${MEDIA}/1440.webp`))).toThrow("ARTIFACT_MEDIA_MISMATCH");
    expect(() => assertRestaurantArtifact(base("https://first.sites.usemingla.com/path", `/media/${MEDIA}/1440.webp`))).toThrow("ARTIFACT_SETTINGS_MISMATCH");
    expect(() => assertRestaurantArtifact(base("http://first.sites.usemingla.com", `/media/${MEDIA}/1440.webp`))).toThrow("ARTIFACT_SETTINGS_MISMATCH");
  });
});
