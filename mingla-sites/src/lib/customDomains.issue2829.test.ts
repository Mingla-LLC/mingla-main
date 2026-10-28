/*
 * #2829 W8 (AD-10) — the runtime serves a brand's own domain.
 *
 * Proves: in production a brand's own domain is a CANDIDATE host (Core's
 * brand_site_hosts decides; Mingla's and its providers' domains, reserved
 * names and IPs are never candidates) while the default scope and local mode
 * stay exactly as strict as before; the Mingla subdomain 308s to the custom
 * main address and a detaching custom host 308s back to the subdomain; an
 * artifact whose canonical is one of the site's own addresses (current or
 * earlier) renders, another site's never does; canonical URLs are presented on
 * the CURRENT main address; and /.well-known/mingla-site answers only the
 * site-id hash for the exact host Core names.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearResolutionCaches,
  isOwnCanonical,
  normalizePublicHost,
  onPrimaryOrigin,
  PRODUCTION_HOST_SCOPE,
  primaryRedirectUrl,
} from "./publication";
import { sha256 } from "./crypto";

const SITE = "aaaaaaaa-1111-4111-8111-111111111111";

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

const CUSTOM = { ...PRODUCTION_HOST_SCOPE, customDomains: true };

describe("#2829 W8 which hosts are candidates", () => {
  it("production accepts a brand's own domain as a candidate; Core decides", () => {
    expect(normalizePublicHost("YoungAndStamped.com", CUSTOM)).toBe("youngandstamped.com");
    expect(normalizePublicHost("www.brand.co.uk", CUSTOM)).toBe("www.brand.co.uk");
    expect(normalizePublicHost("young-stamped.sites.usemingla.com", CUSTOM)).toBe("young-stamped.sites.usemingla.com");
  });

  it("never treats Mingla's or a provider's domain, a reserved name or an IP as a brand's domain", () => {
    for (const host of [
      "a.b.sites.usemingla.com", "sites.usemingla.com", "shop.usemingla.com", "mingla.app",
      "brand.vercel.app", "x.supabase.co", "vz.b-cdn.net", "brand.test", "brand.localhost",
      "10.1.2.3", "brand.com:443", "brand.com.", "bad_name.com",
    ]) expect(() => normalizePublicHost(host, CUSTOM), host).toThrow("NOT_FOUND");
    // Only the first forwarding hop is ever considered.
    expect(normalizePublicHost("other.com, youngandstamped.com", CUSTOM)).toBe("other.com");
  });

  it("the default scope and local mode stay as strict as before", () => {
    expect(() => normalizePublicHost("youngandstamped.com")).toThrow("NOT_FOUND");
    const local = { suffix: "sites.localhost", extraHosts: ["youngandstamped.test"], allowPort: true };
    expect(normalizePublicHost("youngandstamped.test:3100", local)).toBe("youngandstamped.test");
    expect(() => normalizePublicHost("youngandstamped.com", local)).toThrow("NOT_FOUND");
  });
});

describe("#2829 W8 308s between the addresses", () => {
  it("the Mingla subdomain 308s to the brand's own main address, same path", () => {
    expect(primaryRedirectUrl(
      { is_primary: false, hostname: "young-stamped.sites.usemingla.com", primary_hostname: "youngandstamped.com" },
      "/trips?x=1",
    )).toBe("https://youngandstamped.com/trips?x=1");
  });
  it("a detaching custom host 308s back to the subdomain; the main address does not redirect", () => {
    expect(primaryRedirectUrl(
      { is_primary: false, hostname: "youngandstamped.com", primary_hostname: "young-stamped.sites.usemingla.com" },
      "/",
    )).toBe("https://young-stamped.sites.usemingla.com/");
    expect(primaryRedirectUrl(
      { is_primary: true, hostname: "youngandstamped.com", primary_hostname: "youngandstamped.com" },
      "/",
    )).toBeNull();
  });
});

describe("#2829 W8 canonical across a main-address change", () => {
  const resolution = {
    primary_hostname: "youngandstamped.com",
    site_hostnames: ["young-stamped.sites.usemingla.com", "youngandstamped.com"],
  };
  it("accepts the site's own addresses only", () => {
    expect(isOwnCanonical("https://youngandstamped.com", resolution)).toBe(true);
    expect(isOwnCanonical("https://young-stamped.sites.usemingla.com", resolution)).toBe(true);
    expect(isOwnCanonical("https://other-brand.sites.usemingla.com", resolution)).toBe(false);
    expect(isOwnCanonical("http://young-stamped.sites.usemingla.com", resolution)).toBe(false);
    expect(isOwnCanonical(undefined, resolution)).toBe(false);
    // An older Core (no address list): only the primary.
    expect(isOwnCanonical("https://young-stamped.sites.usemingla.com", { primary_hostname: "youngandstamped.com" })).toBe(false);
  });
  it("presents canonical URLs on the current main address", () => {
    expect(onPrimaryOrigin("https://young-stamped.sites.usemingla.com", resolution)).toBe("https://youngandstamped.com");
    expect(onPrimaryOrigin("https://young-stamped.sites.usemingla.com/about-us", resolution)).toBe("https://youngandstamped.com/about-us");
    expect(onPrimaryOrigin(undefined, resolution)).toBeUndefined();
  });
});

describe("#2829 W8 /.well-known/mingla-site", () => {
  async function call(host: string, core: (url: string, init?: RequestInit) => Response) {
    vi.resetModules();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => core(url, init));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("../app/.well-known/mingla-site/route");
    const response = await GET(new Request(`https://${host}/.well-known/mingla-site`, { headers: { host } }));
    return { response, fetchMock };
  }

  it("answers the site-id hash for the exact host Core names, through the probe resolver", async () => {
    const { response, fetchMock } = await call("young-stamped.sites.usemingla.com", () =>
      Response.json({ ok: true, data: { site_id: SITE, hostname: "young-stamped.sites.usemingla.com" } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ site: (await sha256(SITE)).slice(0, 16) });
    expect(Object.keys(body)).toEqual(["site"]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/brand-site-runtime-resolve/internal/v1/hosts/young-stamped.sites.usemingla.com/probe");
  });

  it("404s an unknown host, a host Core does not name, and a refused shape", async () => {
    expect((await call("young-stamped.sites.usemingla.com", () => Response.json({ ok: false }, { status: 404 }))).response.status).toBe(404);
    expect((await call("young-stamped.sites.usemingla.com", () =>
      Response.json({ ok: true, data: { site_id: SITE, hostname: "other.sites.usemingla.com" } }))).response.status).toBe(404);
    const refused = await call("brand.vercel.app", () => Response.json({ ok: true, data: { site_id: SITE, hostname: "brand.vercel.app" } }));
    expect(refused.response.status).toBe(404);
    expect(refused.fetchMock).not.toHaveBeenCalled();
  });
});
