// MINGLA-INVARIANT: I-SITES-FONT-AXES | issue #4453 | a design slot's variable-font axes (wdth, opsz, SOFT, WONK) are fetched from Google in css2 order (ranges or pinned values), cached under their own key, and a wdth range is recorded on every face as font-stretch; a slot without axes is fetched and keyed exactly as before.
/*
 * #4453 6b — the publish pipeline self-hosts a family's variable axes, so a
 * design's compressed (62%) and wide (125%) Archivo (Nocturne), Fraunces'
 * high-contrast optical size (Journal) and its soft, "wonky" instance (Terra)
 * render as designed. Visitors still never contact Google: only the
 * publish-time request changes.
 */
import { describe, expect, it } from "vitest";
import { facesForSlot, fontRequestKey, googleCssUrl, resolveSiteFonts, type CachedFace, type FontPipelineDeps } from "./fontAssets";
import { JOURNAL, NOCTURNE, TERRA } from "../contracts/generated/designs.ts";
import { assertFontAssets, assertFontSlots, resolveFontSlots, type FontSlot } from "../contracts/generated/fontSlots.ts";

const archivo: FontSlot = { family: "Archivo", source: "google", weights: [400, 600, 800], italic: false, axes: { wdth: [62, 125] } };
const WOFF2 = () => {
  const bytes = new Uint8Array(4096);
  bytes.set([0x77, 0x4f, 0x46, 0x32]);
  for (let i = 4; i < bytes.length; i += 1) bytes[i] = (i * 7) % 251;
  return bytes;
};

/** Google's answer to a width-axis request: one variable file per subset, shared by every weight, font-stretch a range. */
function widthCss(weights: number[]): string {
  return weights.flatMap((weight) => ["latin-ext", "latin"].map((subset) => `/* ${subset} */
@font-face {
  font-family: 'Archivo';
  font-style: normal;
  font-weight: ${weight};
  font-stretch: 62% 125%;
  font-display: swap;
  src: url(https://fonts.gstatic.com/l/font?kit=archivo-${subset}&skey=1&v=v25) format('woff2');
  unicode-range: ${subset === "latin" ? "U+0000-00FF, U+0131" : "U+0100-02BA, U+02BD-02C5"};
}`)).join("\n");
}

function harness() {
  const urls: string[] = [];
  const cache = new Map<string, CachedFace[]>();
  const saved: CachedFace[][] = [];
  const deps: FontPipelineDeps = {
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith("https://fonts.googleapis.com/css2?")) return new Response(widthCss([400, 600, 800]));
      const bytes = WOFF2();
      return new Response(bytes as unknown as BodyInit, { headers: { "content-length": String(bytes.byteLength) } });
    }) as typeof fetch,
    storeFont: async () => {},
    cachedFaces: async (key) => cache.get(key) ?? null,
    saveFaces: async (key, faces) => {
      cache.set(key, faces);
      saved.push(faces);
    },
  };
  return { deps, urls, cache, saved };
}

describe("#4453 6b the font pipeline self-hosts a family's variable axes", () => {
  it("asks css2 for Fraunces' optical size (Journal) and its pinned soft, wonky instance (Terra) in css2 axis order", () => {
    expect(googleCssUrl(JOURNAL.fonts.display)).toBe("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700;9..144,800&display=swap");
    expect(googleCssUrl(JOURNAL.fonts.accent!)).toBe("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300;1,9..144,400&display=swap");
    expect(googleCssUrl(TERRA.fonts.display)).toBe("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,400,100,1;0,9..144,500,100,1;1,9..144,400,100,1;1,9..144,500,100,1&display=swap");
    expect(fontRequestKey(TERRA.fonts.display, ["latin", "latin-ext"])).toBe("Fraunces|400,500|i|latin,latin-ext|v1|opsz9-144,SOFT100,WONK1");
  });

  it("asks css2 for the wdth axis range on every weight (axis tags in css2 order), italic included", () => {
    expect(googleCssUrl(archivo)).toBe("https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400;62..125,600;62..125,800&display=swap");
    expect(googleCssUrl({ ...archivo, weights: [400], italic: true }))
      .toBe("https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,400;1,62..125,400&display=swap");
    // Without a width the request is exactly the pre-#4453 one.
    expect(googleCssUrl({ family: "Archivo", weights: [800, 400], italic: false })).toBe("https://fonts.googleapis.com/css2?family=Archivo:wght@400;800&display=swap");
  });

  it("keys the cache by the width range, leaving every older key unchanged", () => {
    const plain = { family: "Archivo", weights: [400, 600, 800], italic: false };
    expect(fontRequestKey(plain, ["latin", "latin-ext"])).toBe("Archivo|400,600,800||latin,latin-ext|v1");
    expect(fontRequestKey(archivo, ["latin", "latin-ext"])).toBe("Archivo|400,600,800||latin,latin-ext|v1|wdth62-125");
  });

  it("records font-stretch on every face, fetched or cached, and stores the cache rows without it (the store has no such column)", async () => {
    const { deps, urls, saved } = harness();
    const faces = await facesForSlot(deps, archivo);
    expect(faces).toHaveLength(6);
    expect(new Set(faces.map((face) => face.stretch))).toEqual(new Set(["62% 125%"]));
    // One variable file per subset, downloaded once though three weights name it.
    expect(urls.filter((url) => url.startsWith("https://fonts.gstatic.com/"))).toHaveLength(2);
    expect(saved[0]!.every((face) => !("stretch" in face))).toBe(true);
    const before = urls.length;
    const again = await facesForSlot(deps, archivo);
    expect(urls.length).toBe(before);
    expect(again.every((face) => face.stretch === "62% 125%")).toBe(true);
  });

  it("Nocturne publishes slots and faces the artifact contract accepts; an owner's own body family drops the width", async () => {
    const { deps } = harness();
    const resolved = await resolveSiteFonts(deps, { slots: { ...NOCTURNE.fonts, display: { family: "Georgia", source: "system", weights: [400], italic: false }, accent: null }, designFonts: NOCTURNE.fonts });
    expect(resolved.warnings).toEqual([]);
    expect(resolved.slots.body).toMatchObject({ family: "Archivo", axes: { wdth: [62, 125] } });
    assertFontSlots(resolved.slots);
    assertFontAssets(resolved.assets, resolved.slots);
    expect(resolved.assets.filter((asset) => asset.family === "Archivo").every((asset) => asset.stretch === "62% 125%")).toBe(true);
    // An owner who keeps Archivo keeps its width; one who picks another family never inherits it.
    const kept = resolveFontSlots(NOCTURNE.fonts, { body: { family: "Archivo", source: "google" } }, () => [400, 600, 800]);
    expect(kept.body.axes).toEqual({ wdth: [62, 125] });
    const own = resolveFontSlots(NOCTURNE.fonts, { body: { family: "Inter", source: "google" } }, () => [400, 600, 800]);
    expect(own.body).toEqual({ family: "Inter", source: "google", weights: [400, 600, 800], italic: false });
  });
});
