/*
 * #4453 M8 — the share page hands the renderer the SHARED view of the preview
 * (no Draft-only hints, no unreviewed pages) and a strip naming the brand and
 * the expiry date; an unavailable link is the plain not-found.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rendered: null as null | { publication_id: string; pages: Array<{ path: string; enabled: boolean }> }, fail: false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "young.example.com" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("../../../components/SitePageView", () => ({
  SitePageView: (props: { artifact: { publication_id: string; pages: Array<{ path: string; enabled: boolean }> } }) => {
    state.rendered = props.artifact;
    return null;
  },
}));
vi.mock("../../../components/PreviewLinks", () => ({ PreviewLinkScope: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../../../lib/pageExtras", () => ({ loadPageExtras: async () => ({ live: undefined, forms: undefined }) }));
vi.mock("../../../lib/publication", () => ({ requestHost: () => "young.example.com" }));
vi.mock("../../../lib/shareLinks", async () => ({
  SHARE_TOKEN: /^[A-Za-z0-9_-]{43}$/,
  sharedPreviewForRequest: async () => {
    if (state.fail) throw new Error("NOT_FOUND");
    const { voyageSyntheticArtifact } = await import("../../../contracts/voyageSynthetic.fixture");
    const base = voyageSyntheticArtifact();
    return {
      artifact: { ...base, publication_id: `preview-${"c".repeat(32)}`, pages: [...base.pages, { ...base.pages[1]!, path: "private-hire", enabled: false }] },
      key: `publications/x/preview-${"c".repeat(32)}/${"d".repeat(64)}.json`,
      expiresAt: "2026-11-20T10:00:00Z",
    };
  },
}));

import SharedPreviewPage from "./[token]/page";

const TOKEN = "A".repeat(43);
beforeEach(() => { state.rendered = null; state.fail = false; });

describe("#4453 M8 shared preview page", () => {
  it("renders the shared view and the strip with the brand and expiry", async () => {
    const element = await SharedPreviewPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Private preview · Fixture &amp; Friends · expires 20 Nov 2026");
    expect(html).toContain("data-shared-preview=\"1\"");
    expect(state.rendered?.publication_id.startsWith("preview-shared-")).toBe(true);
    expect(state.rendered?.pages.some((page) => page.path === "private-hire")).toBe(false);
  });

  it("an expired or revoked link (the server answers nothing) is not found", async () => {
    state.fail = true;
    await expect(SharedPreviewPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
