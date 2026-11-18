/*
 * #4453 §3.2 — the `label` font slot: a design's label face is downloaded at
 * publish like the other slots (self-hosted, never from Google at visit
 * time), it is the design's alone (owners and Ari cannot override it), and
 * artifacts published before #4453 (three slots) still validate.
 */
import { describe, expect, it } from "vitest";
import { resolveSiteFonts, type CachedFace, type FontPipelineDeps } from "./fontAssets";
import { VOYAGE } from "../contracts/generated/designs.ts";
import {
  assertFontAssets, assertFontSlots, assertOwnerFontOverrides, labelSlot, OWNER_FONT_SLOT_KEYS, resolveFontSlots,
} from "../contracts/generated/fontSlots.ts";
import { fontChoicesSchema } from "../contracts/generated/ariToolSchemas.ts";

const WOFF2 = (seed: number) => {
  const bytes = new Uint8Array(2048);
  bytes.set([0x77, 0x4f, 0x46, 0x32]);
  for (let i = 4; i < bytes.length; i += 1) bytes[i] = (i * seed) % 251;
  return bytes;
};

function deps(): { deps: FontPipelineDeps; urls: string[] } {
  const urls: string[] = [];
  const cache = new Map<string, CachedFace[]>();
  return {
    urls,
    deps: {
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.startsWith("https://fonts.googleapis.com/css2?")) {
          const family = decodeURIComponent(/family=([^:&]+)/.exec(url)![1]!).replace(/\+/g, " ");
          const weights = /wght@([0-9;]+)/.exec(url)![1]!.split(";").map(Number);
          const slug = family.toLowerCase().replace(/ /g, "");
          return new Response(weights.map((weight) => `/* latin */
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/${slug}/v1/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}`).join("\n"));
        }
        const bytes = WOFF2(url.length);
        const response = new Response(bytes as unknown as BodyInit, { headers: { "content-length": String(bytes.byteLength) } });
        Object.defineProperty(response, "redirected", { value: false });
        return response;
      }) as typeof fetch,
      storeFont: async () => {},
      cachedFaces: async (key) => cache.get(key) ?? null,
      saveFaces: async (key, faces) => {
        cache.set(key, faces);
      },
    },
  };
}

describe("#4453 the label font slot", () => {
  it("voyage's label face (JetBrains Mono) is resolved, downloaded at publish and validated", async () => {
    const slots = resolveFontSlots(VOYAGE.fonts, null, () => [100, 200, 300, 400, 500, 600, 700, 800]);
    expect(slots.label?.family).toBe("JetBrains Mono");
    const { deps: d, urls } = deps();
    const fonts = await resolveSiteFonts(d, { slots, designFonts: VOYAGE.fonts });
    expect(fonts.warnings).toEqual([]);
    expect(fonts.slots.label?.family).toBe("JetBrains Mono");
    expect(new Set(fonts.assets.map((asset) => asset.family))).toEqual(new Set(["Bricolage Grotesque", "DM Sans", "JetBrains Mono"]));
    // Variable fonts: one latin file per family, however many weights.
    expect(new Set(fonts.assets.map((asset) => asset.digest)).size).toBe(3);
    expect(urls.some((url) => url.includes("JetBrains+Mono"))).toBe(true);
    assertFontSlots(fonts.slots);
    assertFontAssets(fonts.assets, fonts.slots);
  });

  it("a design without a label face sets labels in the body face; old three-slot artifacts still validate", () => {
    const old = { display: VOYAGE.fonts.display, body: VOYAGE.fonts.body, accent: null };
    expect(() => assertFontSlots(old)).not.toThrow();
    expect(labelSlot(old)).toBe(old.body);
    expect(() => assertFontSlots({ ...old, extra: null })).toThrow("ARTIFACT_FONTS_MISMATCH");
  });

  it("owners and Ari cannot choose a label family", () => {
    expect(() => assertOwnerFontOverrides({ label: { family: "Inter", source: "google" } })).toThrow("FONTS_INVALID:label");
    expect(OWNER_FONT_SLOT_KEYS).not.toContain("label");
    expect(Object.keys(fontChoicesSchema().properties ?? {})).toEqual(["display", "body", "accent"]);
  });
});
