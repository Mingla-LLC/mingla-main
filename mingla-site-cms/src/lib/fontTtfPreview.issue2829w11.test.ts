/*
 * #2829 W11 (A17) — TrueType specimens for the Business app on iPhone and
 * Android: the same exact hosts, redirects refused, the TrueType/OpenType
 * signature and size checked, stored by digest, cached per family + weight.
 */
import { describe, expect, it } from "vitest";
import { isTrueTypeSignature, parseGoogleTtfCss, TTF_USER_AGENT, ttfPreviewFace, type TtfPipelineDeps } from "./fontAssets";

const CSS = `@font-face {
  font-family: 'Just Another Hand';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/justanotherhand/v21/a.ttf) format('truetype');
}`;
const TTF = new Uint8Array([0x00, 0x01, 0x00, 0x00, 9, 9, 9]);

function deps(files: Record<string, Response>, saved: unknown[] = [], stored: string[] = []): TtfPipelineDeps & { seen: Array<{ url: string; ua: string | undefined }> } {
  const seen: Array<{ url: string; ua: string | undefined }> = [];
  return {
    seen,
    fetch: (async (input: string, init?: RequestInit) => {
      seen.push({ url: String(input), ua: (init?.headers as Record<string, string> | undefined)?.["user-agent"] });
      expect(init?.redirect).toBe("error");
      const hit = Object.entries(files).find(([prefix]) => String(input).startsWith(prefix));
      return hit ? hit[1].clone() : new Response("", { status: 404 });
    }) as typeof fetch,
    cachedFaces: async () => null,
    saveFaces: async (key, faces) => { saved.push({ key, faces }); },
    storeTtf: async (digest) => { stored.push(digest); },
  };
}

describe("#2829 W11 TrueType specimens", () => {
  it("reads the one TrueType face Google lists for the family and weight", () => {
    expect(parseGoogleTtfCss(CSS, "Just Another Hand", 400)).toBe("https://fonts.gstatic.com/s/justanotherhand/v21/a.ttf");
    expect(parseGoogleTtfCss(CSS, "Just Another Hand", 700)).toBeNull();
    expect(parseGoogleTtfCss(CSS.replace("truetype", "woff"), "Just Another Hand", 400)).toBeNull();
  });

  it("knows a TrueType or OpenType file by its first bytes", () => {
    expect(isTrueTypeSignature(TTF)).toBe(true);
    expect(isTrueTypeSignature(new TextEncoder().encode("OTTO...."))).toBe(true);
    expect(isTrueTypeSignature(new TextEncoder().encode("wOF2...."))).toBe(false);
    expect(isTrueTypeSignature(new TextEncoder().encode("<html>"))).toBe(false);
  });

  it("asks Google as an older browser, stores the file by digest and caches the face", async () => {
    const saved: unknown[] = [];
    const stored: string[] = [];
    const d = deps({
      "https://fonts.googleapis.com/css2?family=Just+Another+Hand:wght@400": new Response(CSS),
      "https://fonts.gstatic.com/s/justanotherhand/v21/a.ttf": new Response(TTF),
    }, saved, stored);
    const face = await ttfPreviewFace(d, "Just Another Hand", 400);
    expect(face).toMatchObject({ family: "Just Another Hand", weight: 400, style: "normal", bytes: TTF.byteLength });
    expect(stored).toEqual([face.digest]);
    expect(saved).toEqual([{ key: "Just Another Hand|400||ttf|v1", faces: [face] }]);
    expect(d.seen.every((call) => call.ua === TTF_USER_AGENT)).toBe(true);
  });

  it("refuses a file from another host, a non-font answer and an oversize file; stores nothing", async () => {
    const stored: string[] = [];
    const elsewhere = CSS.replace("https://fonts.gstatic.com/", "https://evil.example/");
    await expect(ttfPreviewFace(deps({ "https://fonts.googleapis.com/": new Response(elsewhere) }, [], stored), "Just Another Hand", 400)).rejects.toThrow("FONT_HOST_REFUSED");
    await expect(ttfPreviewFace(deps({
      "https://fonts.googleapis.com/": new Response(CSS),
      "https://fonts.gstatic.com/": new Response("<html>not a font</html>"),
    }, [], stored), "Just Another Hand", 400)).rejects.toThrow("FONT_SIGNATURE_INVALID");
    await expect(ttfPreviewFace(deps({
      "https://fonts.googleapis.com/": new Response(CSS),
      "https://fonts.gstatic.com/": new Response(TTF, { headers: { "content-length": String(50 * 1024 * 1024) } }),
    }, [], stored), "Just Another Hand", 400)).rejects.toThrow("FONT_TOO_LARGE");
    expect(stored).toEqual([]);
  });

  it("a cached face is reused without contacting Google", async () => {
    const cachedFace = { family: "X", weight: 400, style: "normal" as const, unicode_range: "", digest: "d".repeat(64), bytes: 3 };
    const d = deps({});
    d.cachedFaces = async () => [cachedFace];
    expect(await ttfPreviewFace(d, "X", 400)).toBe(cachedFace);
    expect(d.seen).toEqual([]);
  });
});
