/*
 * #4453 milestone 11 (spec v2.1 N10) — a share view never carries the owner's
 * preview key, and nothing it carries opens /preview, a Draft page from Ari or
 * a hidden page. The owner's own preview still opens the Draft page.
 *
 * Everything a share page sends is taken: its HTML, and every prop the page
 * hands to the components it renders (a superset of the RSC payload, which is
 * built from those props). Every URL and credential found there is tried
 * against the REAL /preview route (real key parser; the loader opens only the
 * true key) and against the share route itself.
 *
 * MINGLA-INVARIANT: I-SITES-SHARE-NO-PREVIEW-KEY | issue #4453 | a share view's HTML and props never contain the preview artifact key; no credential in it opens /preview or a draft_by_ari / hidden page.
 */
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
vi.mock("../../lib/publication", () => ({ requestHost: () => "brand.sites.usemingla.com", resolveHostSite: async () => ({ site_id: SITE, brand_id: "b", hostname: "brand.sites.usemingla.com" }) }));
vi.mock("../../lib/previewArtifact", async (original) => ({ ...(await original<typeof import("../../lib/previewArtifact")>()), loadPreviewArtifact }));
vi.mock("../../lib/shareLinks", () => ({ SHARE_TOKEN: /^[A-Za-z0-9_-]{43}$/, sharedPreviewForRequest }));
vi.mock("../../lib/pageExtras", () => ({ loadPageExtras: async () => ({}) }));

import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import type { SiteArtifact } from "../../lib/siteArtifact";
import PreviewPage from "./page";
import SharedPreviewPage from "./share/[token]/page";

const SITE = "aaaaaaaa-1111-4111-8111-111111111111";
const HEX = "c".repeat(32);
const DIGEST = "7e".repeat(32);
const PREVIEW_ID = `preview-${HEX}`;
const KEY = `publications/${SITE}/${PREVIEW_ID}/${DIGEST}.json`;
const TOKEN = "T".repeat(20) + "_-" + "q".repeat(21);
const DRAFT_TITLE = "Private hire from Ari";
const HIDDEN_TITLE = "Secret supper club";

/** The owner's newest preview: voyage plus a Draft page from Ari and a disabled page. */
function preview(): SiteArtifact {
  const artifact = structuredClone({ ...voyageSyntheticArtifact(), site_id: SITE, publication_id: PREVIEW_ID }) as ArtifactV2;
  const about = artifact.pages.find((row) => row.path === "about-us")!;
  artifact.pages = [
    ...artifact.pages,
    { ...structuredClone(about), key: "private-hire", path: "private-hire", title: DRAFT_TITLE, enabled: false, draft_by_ari: true as const },
    { ...structuredClone(about), key: "secret", path: "secret", title: HIDDEN_TITLE, enabled: false },
  ];
  return artifact as unknown as SiteArtifact;
}

/** Every prop the page's element tree hands down, as text (Maps, Sets and elements included). */
function propsText(element: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(element, (name, value: unknown) => {
    if (name === "_owner" || name === "_store" || name === "_debugStack" || name === "_debugTask") return undefined;
    if (value instanceof Map) return [...value.entries()];
    if (value instanceof Set) return [...value];
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  });
}

async function sharePage(path: string): Promise<{ html: string; props: string }> {
  const element = await SharedPreviewPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve({ path }) }) as ReactElement;
  return { html: renderToStaticMarkup(element).replace(/&amp;/g, "&"), props: propsText(element) };
}

const openPreview = async (search: Record<string, string>) =>
  renderToStaticMarkup(await PreviewPage({ searchParams: Promise.resolve(search) }) as ReactElement);

/** Every credential-looking value and same-site address in the text. */
function harvest(text: string): { credentials: Set<string>; paths: Set<string> } {
  const credentials = new Set<string>([TOKEN]);
  for (const match of text.matchAll(/[?&]([a-z]{1,2})=([^"&\s\\<>)]+)/gi)) credentials.add(decodeURIComponent(match[2]!));
  for (const match of text.matchAll(/publications\/[^"\s\\]+/g)) credentials.add(match[0]);
  const paths = new Set<string>();
  for (const match of text.matchAll(/[?&]path=([^"&\s\\<>]+)/g)) paths.add(decodeURIComponent(match[1]!));
  for (const match of text.matchAll(/"(?:href|_href|[a-z_]*_href)":"(\/[^"]*)"/g)) paths.add(match[1]!.replace(/^\/+/, "").split(/[?#]/)[0]!);
  return { credentials, paths };
}

beforeEach(() => {
  vi.clearAllMocks();
  headers.mockResolvedValue(new Headers({ "x-nonce": "bm9uY2U=" }));
  sharedPreviewForRequest.mockResolvedValue({ artifact: preview(), key: KEY, expiresAt: null });
  // The preview loader opens the true key only (the real parser runs first).
  loadPreviewArtifact.mockImplementation(async (parsed: { key: string }) => {
    if (parsed.key !== KEY) throw new Error("NOT_FOUND");
    return preview();
  });
});

describe("#4453 M11 a share view carries no preview key", () => {
  const pages = ["", "about-us"];

  it.each(pages)("share /%s: neither the HTML nor the props contain the key or its digest", async (path) => {
    const { html, props } = await sharePage(path);
    for (const text of [html, props, encodeURIComponent(html)]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(encodeURIComponent(KEY));
      expect(text).not.toContain(DIGEST);
      expect(text).not.toMatch(/[?&]k=/);
    }
    expect(html).toMatch(new RegExp(`/media/[0-9a-f-]{36}/[a-z0-9.]+\\?s=${TOKEN}`));
  });

  it.each(pages)("share /%s: no credential or address found there opens /preview, the Draft page or a hidden page", async (path) => {
    const { html, props } = await sharePage(path);
    const { credentials, paths } = harvest(`${html}\n${props}`);
    expect(credentials.has(TOKEN)).toBe(true);
    for (const credential of credentials) {
      for (const target of ["private-hire", "secret", ""]) {
        await expect(openPreview({ k: credential, path: target }), `${credential} -> ${target}`).rejects.toThrow("NOT_FOUND");
        await expect(openPreview({ s: credential, path: target })).rejects.toThrow("NOT_FOUND");
      }
    }
    for (const found of paths) expect(["private-hire", "secret"]).not.toContain(found);
    for (const text of [html, props]) {
      for (const hidden of [DRAFT_TITLE, HIDDEN_TITLE, '"private-hire"', '"secret"']) expect(text).not.toContain(hidden);
    }
  });

  it("the share route itself never opens the Draft page or a hidden page", async () => {
    await expect(sharePage("private-hire")).rejects.toThrow("NOT_FOUND");
    await expect(sharePage("secret")).rejects.toThrow("NOT_FOUND");
  });

  it("the owner's private preview still opens the Draft page from Ari", async () => {
    const html = await openPreview({ k: KEY, path: "private-hire" });
    expect(html).toContain('data-page="private-hire"');
    expect(html).toContain(`k=${encodeURIComponent(KEY)}`);
  });
});
