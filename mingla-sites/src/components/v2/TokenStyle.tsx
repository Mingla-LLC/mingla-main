import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import { fontStack, type FontSlot } from "../../contracts/generated/fontSlots.ts";
import { tokenCssDeclarations } from "../../contracts/generated/tokens.ts";

/*
 * #2829 AD-2 — the site's resolved tokens as CSS custom properties.
 *
 * Replaces SiteTheme for v2: every colour the design stylesheet uses is a
 * `--c-*` property set here from the artifact's explicit values, and the type
 * families are `--font-display` / `--font-body` / `--font-accent`. Nothing is
 * derived at request time and nothing is "corrected": the owner's values are
 * emitted exactly. Values are re-validated at emission (tokens.ts) because
 * this is interpolated into a style element.
 */

function categoryOf(artifact: ArtifactV2, slot: FontSlot): string {
  if (slot.source === "system") return slot.family === "Georgia" || slot.family === "Times New Roman" ? "serif" : "sans-serif";
  const fallback = artifact.font_fallbacks.find((face) => face.family === slot.family);
  return fallback?.local === "Times New Roman" ? "serif" : "sans-serif";
}

export function tokenStyleCss(artifact: ArtifactV2): string {
  const declarations = tokenCssDeclarations(artifact.tokens);
  declarations.push(`--font-display:${fontStack(artifact.fonts.display, categoryOf(artifact, artifact.fonts.display))}`);
  declarations.push(`--font-body:${fontStack(artifact.fonts.body, categoryOf(artifact, artifact.fonts.body))}`);
  if (artifact.fonts.accent) {
    declarations.push(`--font-accent:${fontStack(artifact.fonts.accent, categoryOf(artifact, artifact.fonts.accent))}`);
  }
  return `:root{${declarations.join(";")}}`;
}

export function TokenStyle({ artifact }: { artifact: ArtifactV2 }) {
  return <style data-site-tokens="1">{tokenStyleCss(artifact)}</style>;
}
