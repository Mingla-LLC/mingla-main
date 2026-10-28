// MINGLA-INVARIANT: I-PROPOSED-2829-06 | issue #2829 | Site visitors' browsers never contact Google Fonts or any third-party script origin; fonts are first-party, content-addressed and digest-verified.
/*
 * #2829 W3 (T-W3) — the publish-time font pipeline: exact host allowlist,
 * no redirects, woff2 signature, size caps, cache hit, and the failure
 * fallback that keeps a publish alive with a warning. Plus the metric-matched
 * fallback faces.
 *
 * I-PROPOSED-2829-06 (DRAFT) Site visitors' browsers never contact Google
 * Fonts; fonts are first-party, content-addressed and digest-verified.
 * Enforced by R-9 (this suite pins the builder half; the runtime route and
 * the Playwright request log pin the browser half).
 */
import { describe, expect, it } from "vitest";
import {
  facesForSlot,
  fetchFontFile,
  fontRequestKey,
  fontWarningSentence,
  googleCssUrl,
  parseGoogleFontCss,
  resolveSiteFonts,
  type CachedFace,
  type FontPipelineDeps,
} from "./fontAssets";
import { fallbackFaceFor } from "./fontMetrics";
import { ATELIER } from "../contracts/generated/designs.ts";
import type { FontSlots } from "../contracts/generated/fontSlots.ts";

const seedOf = (text: string) => [...text].reduce((sum, ch, i) => sum + ch.charCodeAt(0) * (i + 1), 0) % 997 + 2;
const WOFF2 = (size: number, seed = 1) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x77, 0x4f, 0x46, 0x32]);
  for (let i = 4; i < size; i += 1) bytes[i] = (i * seed) % 251;
  return bytes;
};

function cssFor(family: string, weights: number[], host = "fonts.gstatic.com"): string {
  return weights.flatMap((weight) => ["cyrillic", "latin-ext", "latin"].map((subset) => `/* ${subset} */
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(https://${host}/s/${family.toLowerCase().replace(/ /g, "")}/v1/${subset}-${weight}.woff2) format('woff2');
  unicode-range: ${subset === "latin" ? "U+0000-00FF, U+0131" : "U+0100-02BA, U+02BD-02C5"};
}`)).join("\n");
}

type Call = { url: string; init?: RequestInit };

function harness(options: {
  css?: (url: string) => string | null;
  file?: (url: string) => Uint8Array | null;
  redirectedFor?: (url: string) => boolean;
  cache?: Map<string, CachedFace[]>;
} = {}) {
  const calls: Call[] = [];
  const stored = new Map<string, Uint8Array>();
  const cache = options.cache ?? new Map<string, CachedFace[]>();
  const deps: FontPipelineDeps = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const redirected = options.redirectedFor?.(url) ?? false;
      const make = (body: BodyInit | null, status = 200, headers: Record<string, string> = {}) => {
        const response = new Response(body, { status, headers });
        Object.defineProperty(response, "redirected", { value: redirected });
        return response;
      };
      if (url.startsWith("https://fonts.googleapis.com/css2?")) {
        const family = decodeURIComponent(/family=([^:&]+)/.exec(url)![1]!).replace(/\+/g, " ");
        const weights = /wght@([0-9;]+)/.exec(url)![1]!.split(";").map(Number);
        const css = options.css ? options.css(url) : cssFor(family, weights);
        return css === null ? make("nope", 400) : make(css);
      }
      const bytes = options.file ? options.file(url) : WOFF2(2048, seedOf(url));
      return bytes === null ? make(null, 404) : make(bytes as unknown as BodyInit, 200, { "content-length": String(bytes.byteLength) });
    }) as typeof fetch,
    storeFont: async (digest, bytes) => {
      stored.set(digest, bytes);
    },
    cachedFaces: async (key) => cache.get(key) ?? null,
    saveFaces: async (key, faces) => {
      cache.set(key, faces);
    },
  };
  return { deps, calls, stored, cache };
}

const fraunces = { family: "Fraunces", source: "google" as const, weights: [400, 600], italic: false };

describe("#2829 Google css2 request and parsing", () => {
  it("asks for exactly the design's weights of the chosen family", () => {
    expect(googleCssUrl(fraunces)).toBe("https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&display=swap");
    expect(googleCssUrl({ family: "Plus Jakarta Sans", weights: [800, 400], italic: false }))
      .toBe("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;800&display=swap");
    expect(() => googleCssUrl({ family: "Evil'); x", weights: [400], italic: false })).toThrow("FONT_FAMILY_INVALID");
  });

  it("parses each subset's @font-face", () => {
    const faces = parseGoogleFontCss(cssFor("Fraunces", [400]));
    expect(faces.map((face) => face.subset)).toEqual(["cyrillic", "latin-ext", "latin"]);
    expect(faces[2]).toEqual({
      subset: "latin",
      family: "Fraunces",
      style: "normal",
      weight: 400,
      url: "https://fonts.gstatic.com/s/fraunces/v1/latin-400.woff2",
      unicodeRange: "U+0000-00FF, U+0131",
    });
  });
});

describe("#2829 font file validation (S-5)", () => {
  it("stores a valid woff2 under its own digest", async () => {
    const { deps, stored } = harness();
    const file = await fetchFontFile(deps, "https://fonts.gstatic.com/s/x/v1/a.woff2");
    expect(file.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.has(file.digest)).toBe(true);
  });

  it("refuses any other host, http, credentials or ports", async () => {
    const { deps, calls } = harness();
    for (const url of [
      "https://evil.example/s/x.woff2",
      "http://fonts.gstatic.com/s/x.woff2",
      "https://user:pw@fonts.gstatic.com/s/x.woff2",
      "https://fonts.gstatic.com:8443/s/x.woff2",
      "https://fonts.gstatic.com.evil.example/s/x.woff2",
    ]) {
      await expect(fetchFontFile(deps, url)).rejects.toThrow("FONT_HOST_REFUSED");
    }
    expect(calls).toEqual([]);
  });

  it("never follows a redirect", async () => {
    const { deps, calls } = harness({ redirectedFor: () => true });
    await expect(fetchFontFile(deps, "https://fonts.gstatic.com/s/x/v1/a.woff2")).rejects.toThrow("FONT_REDIRECT_REFUSED");
    expect(calls[0]!.init?.redirect).toBe("error");
  });

  it("refuses a file without the woff2 signature", async () => {
    const { deps } = harness({ file: () => new TextEncoder().encode("<html>not a font</html>") });
    await expect(fetchFontFile(deps, "https://fonts.gstatic.com/s/x/v1/a.woff2")).rejects.toThrow("FONT_SIGNATURE_INVALID");
  });

  it("refuses a file over 1.5 MiB", async () => {
    const { deps } = harness({ file: () => WOFF2(1.5 * 1024 * 1024 + 1) });
    await expect(fetchFontFile(deps, "https://fonts.gstatic.com/s/x/v1/a.woff2")).rejects.toThrow("FONT_TOO_LARGE");
  });
});

describe("#2829 faces, cache and fallbacks", () => {
  it("keeps only latin and latin-ext faces and caches them", async () => {
    const { deps, calls, cache } = harness();
    const faces = await facesForSlot(deps, fraunces);
    expect(faces.map((face) => `${face.weight}:${face.unicode_range.slice(0, 11)}`)).toEqual([
      "400:U+0100-02BA",
      "400:U+0000-00FF",
      "600:U+0100-02BA",
      "600:U+0000-00FF",
    ]);
    expect(cache.has(fontRequestKey(fraunces, ["latin", "latin-ext"]))).toBe(true);
    const before = calls.length;
    await facesForSlot(deps, fraunces);
    expect(calls.length).toBe(before);
  });

  it("a cache hit makes no request at all", async () => {
    const cache = new Map<string, CachedFace[]>([[fontRequestKey(fraunces, ["latin", "latin-ext"]), [{
      family: "Fraunces", weight: 400, style: "normal", unicode_range: "U+0000-00FF", digest: "a".repeat(64), bytes: 10,
    }]]]);
    const { deps, calls } = harness({ cache });
    expect((await facesForSlot(deps, fraunces))[0]!.digest).toBe("a".repeat(64));
    expect(calls).toEqual([]);
  });

  it("a family that will not load falls back to the design's family, with a warning, and the publish continues", async () => {
    const { deps } = harness({ css: (url) => url.includes("Fraunces") ? null : cssFor(url.includes("Oswald") ? "Oswald" : "Plus Jakarta Sans", url.includes("Oswald") ? [400, 600] : [400, 600, 800]) });
    const slots: FontSlots = { display: fraunces, body: ATELIER.fonts.body, accent: null };
    const result = await resolveSiteFonts(deps, { slots, designFonts: ATELIER.fonts });
    expect(result.slots.display.family).toBe("Oswald");
    expect(result.warnings).toEqual([{ slot: "display", requested: "Fraunces", used: "Oswald", code: "FONT_FETCH_FAILED" }]);
    expect(fontWarningSentence(result.warnings[0]!)).toBe("Your heading font couldn't be loaded, we used Oswald for now.");
    expect(new Set(result.assets.map((asset) => asset.family))).toEqual(new Set(["Oswald", "Plus Jakarta Sans"]));
  });

  it("a file from a foreign host inside Google's CSS fails the family (fallback), never the publish", async () => {
    const { deps, calls } = harness({ css: (url) => cssFor(url.includes("Fraunces") ? "Fraunces" : "Plus Jakarta Sans", [400, 600, 800], url.includes("Fraunces") ? "evil.example" : "fonts.gstatic.com") });
    const result = await resolveSiteFonts(deps, {
      slots: { display: fraunces, body: ATELIER.fonts.body, accent: null },
      designFonts: { ...ATELIER.fonts, display: { family: "Georgia", source: "system", weights: [400], italic: false } },
    });
    expect(result.slots.display).toEqual({ family: "Georgia", source: "system", weights: [400], italic: false });
    expect(result.warnings[0]!.code).toBe("FONT_FETCH_FAILED");
    expect(calls.some((call) => call.url.includes("evil.example"))).toBe(false);
  });

  it("over 6 MiB per site, the slot that would exceed it falls back (FONT_TOO_LARGE)", async () => {
    const { deps } = harness({ file: (url) => WOFF2(url.includes("fraunces") ? 1.4 * 1024 * 1024 : 4096, seedOf(url)) });
    const result = await resolveSiteFonts(deps, {
      slots: { display: { ...fraunces, weights: [100, 200, 300, 400, 500] }, body: ATELIER.fonts.body, accent: null },
      designFonts: { ...ATELIER.fonts, display: { family: "Georgia", source: "system", weights: [400], italic: false } },
    });
    expect(result.warnings).toEqual([{ slot: "display", requested: "Fraunces", used: "Georgia", code: "FONT_TOO_LARGE" }]);
  });

  it("Fraunces + Inter: files listed, fallback faces emitted, no warnings", async () => {
    const { deps } = harness();
    const result = await resolveSiteFonts(deps, {
      slots: { display: fraunces, body: { family: "Inter", source: "google", weights: [400, 600, 800], italic: false }, accent: null },
      designFonts: ATELIER.fonts,
    });
    expect(result.warnings).toEqual([]);
    expect(new Set(result.assets.map((asset) => asset.family))).toEqual(new Set(["Fraunces", "Inter"]));
    expect(result.fallbacks.map((face) => `${face.family}>${face.local}`)).toEqual(["Fraunces>Times New Roman", "Inter>Arial"]);
  });
});

describe("#2829 metric-matched fallback faces", () => {
  it("matches next/font's arithmetic for Oswald over Arial", () => {
    // Oswald: xWidthAvg 363/1000, ascent 1193, descent -289, gap 0.
    // Arial: xWidthAvg 913/2048. size-adjust = 0.363 / 0.44580078 = 81.43%.
    expect(fallbackFaceFor("Oswald")).toEqual({
      family: "Oswald",
      local: "Arial",
      size_adjust: "81.43%",
      ascent_override: "146.51%",
      descent_override: "35.49%",
      line_gap_override: "0.00%",
    });
  });

  it("uses Times New Roman under serif families and nothing for unknown ones", () => {
    expect(fallbackFaceFor("Fraunces")?.local).toBe("Times New Roman");
    expect(fallbackFaceFor("Not A Real Family")).toBeNull();
  });
});
