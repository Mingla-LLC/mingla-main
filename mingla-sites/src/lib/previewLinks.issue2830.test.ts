/*
 * #2830 — where a link goes inside a private preview, and which media URLs in a
 * draft carry the key. Pure functions; the rendered proof is in
 * app/preview/previewPage.issue2830.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { previewFormTarget, previewHref, previewRenderHref } from "./sharedPreviewHref";
import { withPreviewMediaKey, withPreviewOfferingKey } from "./previewMedia";
import type { LiveOfferings } from "./offeringCards";
import type { SiteArtifact } from "./siteArtifact";

const ORIGIN = "https://young.sites.usemingla.com";
const KEY = `publications/aaaaaaaa-1111-4111-8111-111111111111/preview-${"c".repeat(32)}/${"d".repeat(64)}.json`;
const ENCODED = encodeURIComponent(KEY);
const team = { key: KEY };
const MEDIA = "11111111-2222-4333-8444-555555555555";

describe("#2830 previewHref", () => {
  it("keeps every same-site page on the same artifact", () => {
    expect(previewHref(`${ORIGIN}/about`, ORIGIN, team)).toBe(`/preview?k=${ENCODED}&path=about`);
    expect(previewHref(`${ORIGIN}/`, ORIGIN, team)).toBe(`/preview?k=${ENCODED}`);
    expect(previewHref(`${ORIGIN}/trips/bali?where=x#list`, ORIGIN, team)).toBe(`/preview?k=${ENCODED}&path=trips%2Fbali&where=x#list`);
  });

  it("a Business preview frame's origin survives the next page", () => {
    expect(previewHref(`${ORIGIN}/about`, ORIGIN, { key: KEY, frameAncestor: "https://mingla-business-x.vercel.app" }))
      .toBe(`/preview?k=${ENCODED}&fa=https%3A%2F%2Fmingla-business-x.vercel.app&path=about`);
  });

  it("a link can never change which preview it opens", () => {
    expect(previewHref(`${ORIGIN}/about?k=other&fa=https://evil.example&path=x`, ORIGIN, team)).toBe(`/preview?k=${ENCODED}&path=about`);
  });

  it("leaves other sites, runtime routes and in-page anchors alone", () => {
    for (const href of ["https://other.example/about", "mailto:a@example.com", "tel:+1", "#main", `${ORIGIN}/media/x/1.webp`, `${ORIGIN}/om/x/c400`, `${ORIGIN}/api/events`, `${ORIGIN}/preview?k=x`, `${ORIGIN}/robots.txt`]) {
      expect(previewHref(href, ORIGIN, team), href).toBeNull();
    }
  });

  it("while rendering, a relative page is rewritten and anything else stays as written", () => {
    expect(previewRenderHref("/about", team)).toBe(`/preview?k=${ENCODED}&path=about`);
    expect(previewRenderHref("https://host.usemingla.com/t/a", team)).toBe("https://host.usemingla.com/t/a");
    expect(previewRenderHref("#main", team)).toBe("#main");
    expect(previewRenderHref("/media/x/1.webp", team)).toBe("/media/x/1.webp");
  });

  it("a search form names the preview in fields, because GET replaces the action's query", () => {
    expect(previewFormTarget("/trips", team)).toEqual({ action: "/preview", fields: [["k", KEY], ["path", "trips"]] });
    expect(previewFormTarget("", { token: "T" })).toEqual({ action: "/preview/share/T", fields: [] });
  });
});

describe("#2830 withPreviewMediaKey", () => {
  const url = `/media/${MEDIA}/1440.webp`;
  const artifact = {
    site_id: "s",
    media: [{ id: MEDIA, url, object_key: `approved/s/${MEDIA}/d/1440.webp`, variants: [{ name: "c400", url: `/media/${MEDIA}/c400.webp`, object_key: "k" }] }],
    pages: [{ blocks: [{ media_url: url, href: "/about", other: "https://cdn.example/media/x.webp", text: `see /media/${MEDIA}/1440.webp` }] }],
    design: { key: "voyage" },
  } as unknown as SiteArtifact;

  it("stamps every first-party media URL and nothing else, on a copy", () => {
    const before = JSON.stringify(artifact);
    const out = withPreviewMediaKey(artifact, KEY) as unknown as typeof artifact & { media: Array<Record<string, unknown> & { variants: Array<Record<string, unknown>> }>; pages: Array<{ blocks: Array<Record<string, string>> }> };
    const stamped = `${url}?k=${ENCODED}`;
    expect(out.media[0]!.url).toBe(stamped);
    expect(out.media[0]!.variants[0]!.url).toBe(`/media/${MEDIA}/c400.webp?k=${ENCODED}`);
    expect(out.pages[0]!.blocks[0]!.media_url).toBe(stamped);
    expect(out.media[0]!.object_key).toBe(`approved/s/${MEDIA}/d/1440.webp`);
    expect(out.pages[0]!.blocks[0]!.href).toBe("/about");
    expect(out.pages[0]!.blocks[0]!.other).toBe("https://cdn.example/media/x.webp");
    expect(out.pages[0]!.blocks[0]!.text).toBe(`see /media/${MEDIA}/1440.webp`);
    expect(JSON.stringify(artifact)).toBe(before);
  });

  it("stamps an offering card's src and every srcset candidate", () => {
    const token = "A".repeat(43);
    const live = { cards: new Map([["o", { coverUrl: `/om/${token}/c768`, coverSrcSet: `/om/${token}/c400 400w, /om/${token}/c768 768w` }]]) } as unknown as LiveOfferings;
    const card = withPreviewOfferingKey(live, KEY)!.cards.get("o")!;
    expect(card.coverUrl).toBe(`/om/${token}/c768?k=${ENCODED}`);
    expect(card.coverSrcSet).toBe(`/om/${token}/c400?k=${ENCODED} 400w, /om/${token}/c768?k=${ENCODED} 768w`);
  });
});
