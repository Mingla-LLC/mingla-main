/*
 * #2829 W10 (S2) — private share-preview links on the runtime, robots.txt per
 * host, and outbound links:
 *  - a link renders only the newest preview of the site Core resolved for
 *    THIS host; a token Core doesn't answer for (expired, revoked, unknown),
 *    a malformed token, or a key naming another site is not found;
 *  - every private preview path answers noindex (X-Robots-Tag), no-store,
 *    and a shared link sends no referrer; the share token reaches the layout
 *    only from the path (a visitor-sent header is dropped); framing refused;
 *  - inside a shared link, the site's own links stay in the preview;
 *  - robots.txt names the sitemap on the main address; an address with no
 *    site asks crawlers to stay away.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ published: true }));
vi.mock("./lib/siteRedirects", () => ({ siteRedirectFor: async () => null }));
vi.mock("./lib/siteVideo", () => ({ requestStreamVideoHosts: async () => [] }));
vi.mock("./lib/config", () => ({ runtimeConfig: () => { throw new Error("no config in this test"); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "young.sites.usemingla.com" }) }));
vi.mock("./lib/publication", async (original) => ({
  ...(await original<typeof import("./lib/publication")>()),
  requestHost: () => "young.example.com",
  loadPublication: async () => {
    if (!state.published) throw new Error("NOT_FOUND");
    return { artifact: {}, resolution: { primary_hostname: "youngandstamped.com", hostname: "young.example.com" } };
  },
}));

import { proxy } from "./proxy";
import { loadSharedPreview, SHARE_TOKEN_HEADER, shareTokenFromPath } from "./lib/shareLinks";
import { sharedPreviewHref } from "./lib/sharedPreviewHref";
import { outboundTarget } from "./lib/outboundLinks";
import { frameAncestorsFor } from "./lib/csp";
import robots from "./app/robots";

const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SITE_B = "bbbbbbbb-2222-4222-8222-222222222222";
const TOKEN = "A".repeat(20) + "_-" + "b".repeat(21);
const keyFor = (site: string) => `publications/${site}/preview-${"c".repeat(32)}/${"d".repeat(64)}.json`;

beforeEach(() => { state.published = true; });

describe("#2829 W10 shared preview loading", () => {
  const hostA = async () => ({ site_id: SITE_A, brand_id: "b", hostname: "young.sites.usemingla.com" });

  it("loads the newest preview of THIS host's site for a live token", async () => {
    const asked: Array<{ site: string; token: string }> = [];
    const loaded = await loadSharedPreview("young.sites.usemingla.com", TOKEN, {
      resolveHost: hostA,
      fetcher: async (site, token) => { asked.push({ site: site.site_id, token }); return { artifactKey: keyFor(SITE_A), expiresAt: "2026-11-01T00:00:00Z" }; },
      loadArtifact: async (parsed, hostSite) => ({ site_id: parsed.siteId, host: hostSite.site_id }) as never,
    });
    expect(asked).toEqual([{ site: SITE_A, token: TOKEN }]);
    expect(loaded.key).toBe(keyFor(SITE_A));
    expect(loaded.artifact).toEqual({ site_id: SITE_A, host: SITE_A });
  });

  it("an expired, revoked or unknown token (Core answers nothing) is not found", async () => {
    await expect(loadSharedPreview("young.sites.usemingla.com", TOKEN, { resolveHost: hostA, fetcher: async () => null })).rejects.toThrow("NOT_FOUND");
  });

  it("a key naming another site, or a malformed token, is not found and never loads", async () => {
    const loadArtifact = vi.fn();
    await expect(loadSharedPreview("young.sites.usemingla.com", TOKEN, {
      resolveHost: hostA, fetcher: async () => ({ artifactKey: keyFor(SITE_B), expiresAt: null }), loadArtifact,
    })).rejects.toThrow("NOT_FOUND");
    await expect(loadSharedPreview("young.sites.usemingla.com", TOKEN, {
      resolveHost: hostA, fetcher: async () => ({ artifactKey: `publications/${SITE_A}/${SITE_A}/${"d".repeat(64)}.json`, expiresAt: null }), loadArtifact,
    })).rejects.toThrow("NOT_FOUND");
    const fetcher = vi.fn();
    for (const bad of ["short", `${TOKEN}x`, `${TOKEN.slice(0, 42)}/`, `${TOKEN.slice(0, 42)}=`]) {
      await expect(loadSharedPreview("young.sites.usemingla.com", bad, { resolveHost: hostA, fetcher })).rejects.toThrow("NOT_FOUND");
    }
    expect(loadArtifact).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("the token comes only from a well-formed share path", () => {
    expect(shareTokenFromPath(`/preview/share/${TOKEN}`)).toBe(TOKEN);
    expect(shareTokenFromPath(`/preview/share/${TOKEN}/`)).toBe(TOKEN);
    expect(shareTokenFromPath(`/preview/share/${TOKEN}/x`)).toBeNull();
    expect(shareTokenFromPath(`/preview/${TOKEN}`)).toBeNull();
  });
});

describe("#2829 W10 private preview headers", () => {
  const run = async (path: string, headers: Record<string, string> = {}) => {
    const response = await proxy(new NextRequest(`https://young.sites.usemingla.com${path}`, { headers }));
    return response;
  };

  it("a shared link: noindex, no-store, no referrer, token passed from the path only", async () => {
    const response = await run(`/preview/share/${TOKEN}?path=about-us`, { [SHARE_TOKEN_HEADER]: "forged" });
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get(`x-middleware-request-${SHARE_TOKEN_HEADER}`)).toBe(TOKEN);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("a visitor-sent token header on any other page is dropped; the team preview is noindex too", async () => {
    const page = await run("/about-us", { [SHARE_TOKEN_HEADER]: TOKEN });
    expect(page.headers.get(`x-middleware-request-${SHARE_TOKEN_HEADER}`)).toBeNull();
    expect(page.headers.get("x-robots-tag")).toBeNull();
    const preview = await run("/preview?k=x");
    expect(preview.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(preview.headers.get("referrer-policy")).toBeNull();
  });

  it("nobody may frame a shared link", () => {
    expect(frameAncestorsFor(`/preview/share/${TOKEN}`, { localMode: true })).toBe("'none'");
  });
});

describe("#2829 W10 links inside a shared link", () => {
  const origin = "https://young.sites.usemingla.com";
  it("the site's own pages stay inside the preview", () => {
    expect(sharedPreviewHref(`${origin}/about-us`, origin, TOKEN)).toBe(`/preview/share/${TOKEN}?path=about-us`);
    expect(sharedPreviewHref(`${origin}/`, origin, TOKEN)).toBe(`/preview/share/${TOKEN}`);
    expect(sharedPreviewHref(`${origin}/trips?where=bali#list`, origin, TOKEN)).toBe(`/preview/share/${TOKEN}?path=trips&where=bali#list`);
  });
  it("other sites, Mingla pages, media and runtime routes are left alone", () => {
    for (const href of ["https://host.usemingla.com/t/young/bali", `${origin}/media/x/1920.webp`, `${origin}/preview/share/${TOKEN}#main`, "mailto:a@b.c", `${origin}/api/forms/contact`]) {
      expect(sharedPreviewHref(href, origin, TOKEN), href).toBeNull();
    }
  });
});

describe("#2829 W10 outbound links", () => {
  it("only http(s) links to another origin are outbound", () => {
    const origin = "https://young.sites.usemingla.com";
    expect(outboundTarget("https://instagram.com/young", origin)).toBe("https://instagram.com");
    expect(outboundTarget("https://host.usemingla.com/t/young/bali", origin)).toBe("https://host.usemingla.com");
    expect(outboundTarget("/about-us", origin)).toBeNull();
    expect(outboundTarget("mailto:hello@young.com", origin)).toBeNull();
    expect(outboundTarget("tel:+15555550100", origin)).toBeNull();
  });
});

describe("#2829 W10 robots.txt per host", () => {
  it("a site's address names the sitemap on its main address", async () => {
    expect(await robots()).toEqual({ rules: { userAgent: "*", allow: "/" }, sitemap: "https://youngandstamped.com/sitemap.xml" });
  });
  it("an address with no site asks crawlers to stay away and names no sitemap", async () => {
    state.published = false;
    expect(await robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});
