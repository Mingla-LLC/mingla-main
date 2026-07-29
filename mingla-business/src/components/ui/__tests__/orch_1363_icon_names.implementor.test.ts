import fs from "node:fs";
import path from "node:path";

/**
 * Issue #1363 (device-UX) — the shared @mingla/location-input field passes
 * Ionicons-style icon names to the injected Icon. The consumer Icon (Ionicons)
 * has them; the BUSINESS Icon set (`components/ui/Icon.tsx`) lacked
 * `"location-outline"` and `"cloud-offline-outline"`, so on the Samsung build
 * they hit `FALLBACK_RENDERER` (a square) and spammed
 * `WARN [Icon] Unknown icon name "location-outline"`. On the new accent-orange
 * free-text pill this looked broken.
 *
 * This pins that EVERY name the shared field passes resolves to a real glyph in
 * the business set — i.e. it is a key in the `RENDERERS` map, so
 * `RENDERERS[name]` is defined and the `renderer ?? FALLBACK_RENDERER` +
 * `if (!renderer) console.warn(...)` fallback path is NEVER taken.
 *
 * Follows the established business CI pattern (ts-jest, testEnvironment: node,
 * source-structural assertion — see orch_1057_ari_composer_icons_emptystate /
 * metaOrch1002SubDBusinessGlass): Icon.tsx imports react-native-svg (a native
 * module) so it cannot mount under node; the RENDERERS keys are the truth.
 *
 * fails-on-revert: delete either RENDERERS entry ⇒ that name's key regex fails
 * ⇒ this test FAILS (and the app would fall back to the square again).
 */

const ICON_SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "Icon.tsx"),
  "utf8",
);

// The exact names the shared field (packages/location-input) hands to the
// injected IconComponent, PLUS the business wrapper's leadingIcon="location".
const SHARED_FIELD_ICON_NAMES = [
  "location",
  "location-outline",
  "cloud-offline-outline",
  "close",
  "search",
] as const;

// The two the eyeball caught missing (the regression this ORCH fixes).
const ADDED_NAMES = ["location-outline", "cloud-offline-outline"] as const;

/** A `"name":` renderer key in the RENDERERS map (quoted or bareword form). */
const hasRendererKey = (src: string, name: string): boolean =>
  new RegExp(`(?:"${name}"|\\b${name})\\s*:\\s*(?:\\(|\\w)`).test(src);

/** A `| "name"` member of the exported IconName union. */
const inIconNameUnion = (src: string, name: string): boolean =>
  new RegExp(`\\|\\s*"${name}"`).test(src);

describe("Issue #1363 — business Icon supports every name the shared location field passes", () => {
  it.each(SHARED_FIELD_ICON_NAMES)(
    "%s resolves to a real RENDERERS glyph (never the fallback square)",
    (name) => {
      expect(hasRendererKey(ICON_SRC, name)).toBe(true);
    },
  );

  it.each(ADDED_NAMES)("%s is a member of the IconName type union", (name) => {
    expect(inIconNameUnion(ICON_SRC, name)).toBe(true);
  });

  it("the two added names reuse an existing glyph (no new heavy icon import added)", () => {
    // location-outline reuses the `location` outline pin; cloud-offline-outline
    // reuses the `refund` circular retry arrow. The import surface is unchanged:
    // still only react-native-svg primitives.
    expect(ICON_SRC).toMatch(
      /import\s+Svg,\s*\{\s*Circle,\s*G,\s*Path,\s*Rect\s*\}\s*from\s*"react-native-svg"/,
    );
    // location-outline draws the same pin path as `location`.
    expect(ICON_SRC).toContain(
      '"location-outline": () => (',
    );
    // cloud-offline-outline draws the same arc path as `refund`.
    expect(ICON_SRC).toContain('"cloud-offline-outline": () => (');
  });
});
