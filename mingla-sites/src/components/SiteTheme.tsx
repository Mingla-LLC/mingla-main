import type { RestaurantArtifact } from "../contracts/artifact";
import { FONT_PAIRINGS, isFontPairing } from "../contracts/fontPairings";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * #2830 — the brand's own palette, per site.
 *
 * The runtime stylesheet HARDCODED gogi's charcoal and gold at `:root`, so
 * every brand published through Mingla Sites would have rendered in gogi's
 * colours. That is not a cosmetic issue: it makes the template expansion in
 * #2832 impossible, because there is only one look and it belongs to the pilot
 * customer.
 *
 * The artifact has always carried `site_settings.colors`. Nothing read them.
 * Now they drive the page, and the stylesheet's values become defaults rather
 * than law.
 *
 * SAFETY. These values originate in Payload, which a brand can edit, and they
 * are interpolated into a <style> element — so unvalidated they would be a CSS
 * injection. `assertRestaurantArtifact` already pins each to `#rrggbb`; this
 * re-checks at the point of emission anyway, because the cost is a regex and
 * the failure mode is arbitrary CSS on a customer's website.
 */
export function siteThemeCss(artifact: RestaurantArtifact): string | null {
  const colors = artifact.site_settings.colors;
  const typography = artifact.site_settings.typography;
  const declarations: string[] = [];

  const set = (name: string, value: unknown) => {
    if (typeof value === "string" && HEX.test(value)) {
      declarations.push(`${name}:${value}`);
    }
  };
  set("--ink", colors?.background);
  set("--ivory", colors?.foreground);
  set("--gold", colors?.accent);

  /*
   * The brand's type choice. Only a pairing from the shared list can apply —
   * these values are interpolated into a <style> element like the colours, so
   * an unknown or hand-written string must never reach it.
   */
  if (isFontPairing(typography)) {
    const pairing = FONT_PAIRINGS[typography];
    declarations.push(`--display:${pairing.display}`);
    declarations.push(`--body:${pairing.body}`);
    declarations.push(
      `--display-case:${pairing.uppercaseHeadings ? "uppercase" : "none"}`,
    );
  }
  if (declarations.length === 0) return null;
  return `:root{${declarations.join(";")}}`;
}

export function SiteTheme({ artifact }: { artifact: RestaurantArtifact }) {
  const css = siteThemeCss(artifact);
  if (!css) return null;
  // The content is a fixed set of custom properties whose values are validated
  // hex or literal var() references — never customer prose.
  return <style data-site-theme="1">{css}</style>;
}
