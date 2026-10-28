import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import { isFontFamilyName, type FontAsset } from "../../contracts/generated/fontSlots.ts";

/*
 * #2829 AD-3 — the site's fonts, served by the site itself.
 *
 * One @font-face per downloaded file, pointing at `/fonts/<digest>` on the
 * same origin (the CSP's `font-src 'self'` stays), `font-display: swap`, plus
 * a metric-matched "<Family> Fallback" face over a local system font so the
 * page does not jump when the real face arrives. A visitor's browser never
 * contacts Google. The display and body faces a first screen needs (regular
 * and bold, latin) are preloaded.
 *
 * Inside a private preview the font URLs carry the preview key, so a draft's
 * new font can load before it is ever published (the route checks the key).
 */

const DIGEST = /^[0-9a-f]{64}$/;
const RANGE = /^(?:U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)(?:, ?U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)*$/i;
const PERCENT = /^\d{1,3}(?:\.\d{1,4})?%$/;

export function fontUrl(digest: string, previewKey?: string): string {
  return previewKey ? `/fonts/${digest}?k=${encodeURIComponent(previewKey)}` : `/fonts/${digest}`;
}

function safeAsset(asset: FontAsset): boolean {
  return isFontFamilyName(asset.family) && DIGEST.test(asset.digest) &&
    (asset.unicode_range === "" || RANGE.test(asset.unicode_range)) &&
    (asset.style === "normal" || asset.style === "italic") &&
    Number.isInteger(asset.weight);
}

export function fontFacesCss(artifact: ArtifactV2, previewKey?: string): string {
  const rules: string[] = [];
  for (const asset of artifact.font_assets) {
    if (!safeAsset(asset)) continue;
    rules.push(
      `@font-face{font-family:"${asset.family}";font-style:${asset.style};font-weight:${asset.weight};font-display:swap;` +
        `src:url("${fontUrl(asset.digest, previewKey)}") format("woff2")` +
        `${asset.unicode_range ? `;unicode-range:${asset.unicode_range}` : ""}}`,
    );
  }
  for (const face of artifact.font_fallbacks) {
    if (
      !isFontFamilyName(face.family) || (face.local !== "Arial" && face.local !== "Times New Roman") ||
      ![face.size_adjust, face.ascent_override, face.descent_override, face.line_gap_override].every((value) => PERCENT.test(value))
    ) continue;
    rules.push(
      `@font-face{font-family:"${face.family} Fallback";src:local("${face.local}");size-adjust:${face.size_adjust};` +
        `ascent-override:${face.ascent_override};descent-override:${face.descent_override};line-gap-override:${face.line_gap_override}}`,
    );
  }
  return rules.join("\n");
}

/** The files worth preloading: display and body, regular and bold, latin. */
export function preloadDigests(artifact: ArtifactV2): string[] {
  const out = new Set<string>();
  for (const slot of [artifact.fonts.display, artifact.fonts.body]) {
    if (slot.source !== "google") continue;
    for (const wanted of [400, 700]) {
      const faces = artifact.font_assets.filter((asset) =>
        asset.family === slot.family && asset.style === "normal" && asset.unicode_range.startsWith("U+0000")
      );
      if (!faces.length) continue;
      const nearest = faces.reduce((best, face) =>
        Math.abs(face.weight - wanted) < Math.abs(best.weight - wanted) ? face : best
      );
      if (DIGEST.test(nearest.digest)) out.add(nearest.digest);
    }
  }
  return [...out];
}

export function FontFaces({ artifact, previewKey }: { artifact: ArtifactV2; previewKey?: string }) {
  const css = fontFacesCss(artifact, previewKey);
  return (
    <>
      {preloadDigests(artifact).map((digest) => (
        <link key={digest} rel="preload" as="font" type="font/woff2" crossOrigin="anonymous" href={fontUrl(digest, previewKey)} />
      ))}
      {css ? <style data-site-fonts="1">{css}</style> : null}
    </>
  );
}
