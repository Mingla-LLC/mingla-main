/*
 * #2830 — a private preview, rendered through the real page routes on each
 * renderer (v1 RestaurantV1, v2 atelier and voyage): every same-site link stays
 * in the preview, every first-party media URL carries the key, the consent
 * banner is gone, the head script carries the nonce, and no page's link is a
 * framework link that would prefetch a public address. Public rendering of the
 * same artifacts carries no key at all.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const { headers, loadPreviewArtifact, sharedPreviewForRequest } = vi.hoisted(() => ({
  headers: vi.fn(),
  loadPreviewArtifact: vi.fn(),
  sharedPreviewForRequest: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({ usePathname: () => "/preview", notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ mode: "production", runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));
vi.mock("../../lib/publication", () => ({ requestHost: () => "brand.sites.usemingla.com", resolveHostSite: async () => ({ site_id: "s", brand_id: "b", hostname: "brand.sites.usemingla.com" }) }));
vi.mock("../../lib/previewArtifact", async (original) => ({ ...(await original<typeof import("../../lib/previewArtifact")>()), loadPreviewArtifact }));
vi.mock("../../lib/shareLinks", () => ({ SHARE_TOKEN: /^[A-Za-z0-9_-]{43}$/, sharedPreviewForRequest }));
vi.mock("../../lib/pageExtras", () => ({ loadPageExtras: async () => ({}) }));

import { PreviewLinkScope, SiteSearchForm } from "../../components/PreviewLinks";
import { SitePageView } from "../../components/SitePageView";
import { gogiV1Fixture } from "../../contracts/gogiV1.fixture";
import { upgradeV1ToV2 } from "../../contracts/generated/upgradeV1ToV2.ts";
import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { sitePages } from "../../lib/pageRouting";
import type { SiteArtifact } from "../../lib/siteArtifact";
import PreviewPage from "./page";
import SharedPreviewPage from "./share/[token]/page";

const SITE = "aaaaaaaa-1111-4111-8111-111111111111";
const PREVIEW_ID = `preview-${"c".repeat(32)}`;
const KEY = `publications/${SITE}/${PREVIEW_ID}/${"d".repeat(64)}.json`;
const ENCODED = encodeURIComponent(KEY);
const TOKEN = "T".repeat(43);
const NONCE = "bm9uY2U=";

const asPreview = (artifact: unknown) => ({ ...(artifact as Record<string, unknown>), site_id: SITE, publication_id: PREVIEW_ID }) as unknown as SiteArtifact;
const RENDERERS: Array<[string, () => SiteArtifact]> = [
  ["RestaurantV1", () => asPreview(gogiV1Fixture())],
  ["atelier", () => asPreview(upgradeV1ToV2(gogiV1Fixture()))],
  ["voyage", () => asPreview(voyageSyntheticArtifact())],
];

const anchors = (html: string) => [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
const sameSite = (hrefs: string[]) => hrefs.filter((href) => href.startsWith("/"));
const mediaUrls = (html: string) => [...html.matchAll(/\/media\/[0-9a-f-]{36}\/[a-z0-9.]+(\?k=[^"\s),&]*)?/gi)].map((match) => match[0]);

const team = async (artifact: SiteArtifact, path: string, extra: Record<string, string> = {}) => {
  loadPreviewArtifact.mockResolvedValue(artifact);
  return renderToStaticMarkup(await PreviewPage({ searchParams: Promise.resolve({ k: KEY, path, ...extra }) }) as ReactElement);
};
const shared = async (artifact: SiteArtifact, path: string) => {
  sharedPreviewForRequest.mockResolvedValue({ artifact, key: KEY, expiresAt: null });
  return renderToStaticMarkup(await SharedPreviewPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve({ path }) }) as ReactElement);
};

beforeEach(() => {
  vi.clearAllMocks();
  headers.mockResolvedValue(new Headers({ "x-nonce": NONCE }));
});

describe.each(RENDERERS)("#2830 private preview on %s", (_name, make) => {
  const paths = sitePages(make()).filter((page) => page.enabled).map((page) => page.path);

  it("has same-site links to test, on more than one page", () => {
    expect(paths.length).toBeGreaterThan(1);
  });

  it.each(paths)("team preview /%s: every same-site link stays on this artifact", async (path) => {
    const links = sameSite(anchors(await team(make(), path)));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      if (href.startsWith("/media/")) expect(href).toContain(`?k=${ENCODED}`);
      else expect(href, href).toMatch(new RegExp(`^/preview\\?k=${ENCODED.replace(/[%.]/g, "\\$&")}(&|#|$)`));
    }
  });

  it.each(paths)("shared preview /%s: every same-site link stays on this link", async (path) => {
    const links = sameSite(anchors(await shared(make(), path)));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      if (href.startsWith("/media/")) expect(href).toContain(`?k=${ENCODED}`);
      else expect(href, href).toMatch(new RegExp(`^/preview/share/${TOKEN}(\\?|#|$)`));
    }
  });

  it.each(paths)("/%s: every first-party media URL carries the key", async (path) => {
    for (const html of [await team(make(), path), await shared(make(), path)]) {
      for (const url of mediaUrls(html.replace(/&amp;/g, "&"))) expect(url, url).toContain(`?k=${ENCODED}`);
    }
  });

  it("shows no consent banner, on either preview", async () => {
    for (const html of [await team(make(), paths[0]!), await shared(make(), paths[0]!)]) {
      expect(html).not.toContain("Your choice");
      expect(html).not.toContain("Analytics choices");
    }
  });

  it("public rendering of the same draft carries no key and keeps its own links", () => {
    const artifact = make();
    const html = renderToStaticMarkup(<SitePageView artifact={artifact} page={sitePages(artifact).find((page) => page.enabled)} />);
    expect(html).not.toMatch(/[?&]k=/);
    expect(html).not.toContain("/preview");
    expect(sameSite(anchors(html)).length).toBeGreaterThan(0);
    for (const url of mediaUrls(html)) expect(url).not.toContain("?");
  });
});

describe("#2830 the published ask of the banner is untouched", () => {
  it("a real publication still asks", () => {
    const artifact = { ...(voyageSyntheticArtifact() as unknown as Record<string, unknown>), publication_id: "11111111-2222-4333-8444-555555555555" } as unknown as SiteArtifact;
    const html = renderToStaticMarkup(<SitePageView artifact={artifact} page={sitePages(artifact)[0]} />);
    expect(html).toContain("Your choice");
  });
});

describe("#2830 preview specifics", () => {
  it("voyage's head script carries the request's nonce on both previews (the CSP violation)", async () => {
    for (const html of [await team(asPreview(voyageSyntheticArtifact()), ""), await shared(asPreview(voyageSyntheticArtifact()), "")]) {
      expect(html).toContain(`<script nonce="${NONCE}">document.documentElement.classList.add`);
    }
  });

  it("a Business preview frame's own origin survives the next page; junk does not", async () => {
    const framed = await team(asPreview(voyageSyntheticArtifact()), "", { fa: "https://mingla-business-x.vercel.app" });
    expect(sameSite(anchors(framed)).some((href) => href.includes("fa=https%3A%2F%2Fmingla-business-x.vercel.app"))).toBe(true);
    const junk = await team(asPreview(voyageSyntheticArtifact()), "", { fa: "https://evil.example" });
    expect(junk).not.toContain("evil.example");
  });

  it("a search form stays in the preview, because a GET form drops the action's query", async () => {
    const scope = { target: { key: KEY }, path: "about", assetKey: KEY };
    expect(renderToStaticMarkup(<PreviewLinkScope scope={scope}><SiteSearchForm action="/trips" /></PreviewLinkScope>))
      .toBe(`<form action="/preview" method="get"><input type="hidden" name="k" value="${KEY}"/><input type="hidden" name="path" value="trips"/></form>`);
    expect(renderToStaticMarkup(<PreviewLinkScope scope={scope}><SiteSearchForm /></PreviewLinkScope>)).toContain('name="path" value="about"');
    expect(renderToStaticMarkup(<SiteSearchForm action="/trips" />)).toBe('<form action="/trips" method="get"></form>');
  });

  it("the current page is marked from the preview's path, not /preview", async () => {
    const artifact = asPreview(voyageSyntheticArtifact());
    const page = sitePages(artifact).find((row) => row.enabled && row.path !== "");
    const html = await team(artifact, page!.path);
    expect(html).toContain('aria-current="page"');
  });
});

describe("#2830 nothing can prefetch a public address from a preview", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) && !name.includes(".test.") ? [full] : [];
  });

  it("only SiteRouteLink may touch next/link", () => {
    const root = resolve(__dirname, "../..");
    const offenders = walk(root).filter((file) => /from "next\/link"/.test(readFileSync(file, "utf8")) && !file.endsWith("components/PreviewLinks.tsx"));
    expect(offenders).toEqual([]);
  });
});
