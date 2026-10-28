/**
 * #2829 AD-1 — a v1 artifact (`restaurant-website-v1`, either the six-role
 * form or the W2 page-tree form) re-expressed as a v2 artifact under the
 * `atelier` design. Pure: no I/O, no clock.
 *
 * This is how "gögi rebuilt from tokens" is proven: the same content, drawn
 * by the v2 renderer and atelier's token stylesheet, must look like the v1
 * render. It is also the shape the v2 builder produces from Studio content.
 *
 *   - every block keeps its v1 fields and gains `variant: "atelier"`;
 *     `rich_text` paragraphs become the closed rich-text tree;
 *   - the brand's three v1 colours become exact token values (canvas, body
 *     text, accent 400) — nothing is regenerated or "improved";
 *   - the v1 font pairing becomes the font slots; font files are supplied by
 *     the caller (a pure function cannot download them);
 *   - absolute media URLs on the site's own origin become relative;
 *   - a six-role site's retired-role fallback (contact → reservations) becomes
 *     an explicit redirect rule.
 */
import type { ArtifactV2, MediaRef, NavLink, PageNode, SiteNavigation } from "./artifactV2.ts";
import { V2_RENDERER_KEY, V2_RENDERER_VERSION, V2_SCHEMA_VERSION } from "./artifactV2.ts";
import { isBlockType, type SiteBlock } from "./blocks.ts";
import { ATELIER } from "./designs.ts";
import type { FontAsset, FontFallback, FontSlots } from "./fontSlots.ts";
import { paragraphsToRichText } from "./richText.ts";
import { DEFAULT_SITE_ROUTES, type RedirectRule, type SiteRoutes } from "./routes.ts";
import { resolveTokens, type OwnerTokenOverrides } from "./tokens.ts";
import { isHex } from "./colorRamp.ts";

type Json = Record<string, unknown>;

/** The v1 pairings (mingla-sites/src/contracts/fontPairings.ts), as slots. */
export const V1_PAIRING_FONTS: Readonly<Record<string, { display: string; body: string; uppercase: boolean }>> = {
  "condensed-display": { display: "Oswald", body: "Plus Jakarta Sans", uppercase: true },
  "modern-sans": { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans", uppercase: false },
  "editorial-serif": { display: "Playfair Display", body: "Plus Jakarta Sans", uppercase: false },
};

/** Weights the v1 runtime self-hosted per family (public/fonts). */
const V1_FAMILY_WEIGHTS: Readonly<Record<string, number[]>> = {
  Oswald: [400, 600],
  "Plus Jakarta Sans": [400, 600, 800],
  "Playfair Display": [400, 700],
};

export type UpgradeOptions = {
  /** Font files already fetched for the resulting slots (from the CMS cache). */
  fontAssets?: FontAsset[];
  fontFallbacks?: FontFallback[];
};

function relativeMedia(url: unknown, origin: string | undefined): unknown {
  if (typeof url !== "string" || !origin) return url;
  return url.startsWith(`${origin}/media/`) ? url.slice(origin.length) : url;
}

function upgradeMediaRef(value: unknown, origin: string | undefined): MediaRef {
  const ref = { ...(value as Json) };
  ref.url = relativeMedia(ref.url, origin);
  return ref as MediaRef;
}

const URL_FIELDS = ["media_url", "poster_url", "video_url"];

function upgradeBlock(block: Json, origin: string | undefined): SiteBlock {
  if (!isBlockType(block.type)) throw new Error("UPGRADE_UNKNOWN_BLOCK");
  const out: Json = { type: block.type, variant: "atelier" };
  for (const [key, value] of Object.entries(block)) {
    if (key === "type") continue;
    if (block.type === "rich_text" && key === "paragraphs") {
      const texts = Array.isArray(value) ? value.map((row) => String((row as Json).text ?? "")) : [];
      out.body = paragraphsToRichText(texts);
      continue;
    }
    if (URL_FIELDS.includes(key)) out[key] = relativeMedia(value, origin);
    else if (key === "images" && Array.isArray(value)) out[key] = value.map((image) => upgradeMediaRef(image, origin));
    else if (key === "members" && Array.isArray(value)) {
      out[key] = value.map((member) => ({ ...(member as Json), media_url: relativeMedia((member as Json).media_url, origin) }));
    } else out[key] = value;
  }
  return out as SiteBlock;
}

function fontsFromPairing(pairing: unknown): { fonts: FontSlots; uppercase: boolean } {
  const choice = typeof pairing === "string" ? V1_PAIRING_FONTS[pairing] : undefined;
  if (!choice) return { fonts: structuredClone(ATELIER.fonts), uppercase: true };
  const slot = (family: string) => ({ family, source: "google" as const, weights: [...(V1_FAMILY_WEIGHTS[family] ?? [400])], italic: false });
  return { fonts: { display: slot(choice.display), body: slot(choice.body), accent: null }, uppercase: choice.uppercase };
}

/** v1 → v2 under atelier. Throws on a block type the catalogue does not know. */
export function upgradeV1ToV2(source: unknown, options: UpgradeOptions = {}): ArtifactV2 {
  const v1 = source as Json;
  if (v1?.schema_version !== 1 || v1.renderer_key !== "restaurant-website-v1") throw new Error("UPGRADE_NOT_V1");
  const settings = (v1.site_settings ?? {}) as Json;
  const seo = (settings.seo ?? {}) as Json;
  const origin = typeof seo.canonical_url === "string" ? seo.canonical_url : undefined;
  const tree = v1.site_routes !== undefined;
  const rawPages = (v1.pages as Json[]) ?? [];

  let pages: PageNode[];
  let navigation: SiteNavigation;
  let routes: SiteRoutes = { ...DEFAULT_SITE_ROUTES };
  let redirects: RedirectRule[] = [];
  let language = "en";
  let timezone: string | undefined;
  if (tree) {
    pages = rawPages.map((page) => ({
      path: String(page.path),
      title: String(page.title),
      enabled: page.enabled === true,
      kind: page.kind === "collection_index" ? "collection_index" : "standard",
      ...(page.collection ? { collection: page.collection as PageNode["collection"] } : {}),
      blocks: ((page.blocks as Json[]) ?? []).map((block) => upgradeBlock(block, origin)),
      ...(page.seo ? { seo: page.seo as PageNode["seo"] } : {}),
    }));
    navigation = structuredClone(v1.navigation) as SiteNavigation;
    const siteRoutes = v1.site_routes as Json;
    routes = siteRoutes.routes as SiteRoutes;
    redirects = (siteRoutes.redirects as RedirectRule[]) ?? [];
    language = String(siteRoutes.language ?? "en");
    timezone = typeof siteRoutes.timezone === "string" ? siteRoutes.timezone : undefined;
  } else {
    const routable = rawPages.filter((page) =>
      page.role === "home" || (typeof page.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug))
    );
    pages = routable.map((page) => ({
      path: page.role === "home" ? "" : String(page.slug),
      title: String(page.title),
      enabled: page.enabled === true,
      kind: "standard" as const,
      blocks: ((page.blocks as Json[]) ?? []).map((block) => upgradeBlock(block, origin)),
      ...(page.seo ? { seo: page.seo as PageNode["seo"] } : {}),
    }));
    const items: NavLink[] = routable
      .filter((page) => page.enabled === true)
      .sort((a, b) => Number(a.nav_order) - Number(b.nav_order))
      .map((page) => ({ label: String(page.nav_label ?? ""), href: page.role === "home" ? "/" : `/${String(page.slug)}` }));
    navigation = { items };
    // The six-role runtime sent a retired /contact to /reservations.
    const live = new Set(routable.filter((page) => page.enabled === true).map((page) => page.role));
    const reservations = routable.find((page) => page.role === "reservations" && page.enabled === true);
    if (!live.has("contact") && reservations && !rawPages.some((page) => page.slug === "contact")) {
      redirects = [{ from: "/contact", to: `/${String(reservations.slug)}`, status: 308 }];
    }
  }

  const colors = (settings.colors ?? {}) as Json;
  const overrides: OwnerTokenOverrides = { colors: {} };
  if (isHex(String(colors.background ?? "").toLowerCase())) overrides.colors!.canvas = String(colors.background).toLowerCase();
  if (isHex(String(colors.foreground ?? "").toLowerCase())) overrides.colors!.ink_body = String(colors.foreground).toLowerCase();
  if (isHex(String(colors.accent ?? "").toLowerCase())) {
    overrides.colors!.accent = { steps: { 400: String(colors.accent).toLowerCase() } };
  }
  const { fonts, uppercase } = fontsFromPairing(settings.typography);
  overrides.heading_case = uppercase ? "uppercase" : "none";
  const families = new Set([fonts.display.family, fonts.body.family]);

  const footer = structuredClone(v1.footer ?? {}) as ArtifactV2["footer"];
  const media = ((v1.media as unknown[]) ?? []).map((item) => upgradeMediaRef(item, origin));
  return {
    artifact_schema_version: V2_SCHEMA_VERSION,
    renderer_key: V2_RENDERER_KEY,
    renderer_version: V2_RENDERER_VERSION,
    site_id: String(v1.site_id),
    brand_id: String(v1.brand_id),
    publication_id: String(v1.publication_id),
    source_revision_id: String(v1.source_revision_id),
    source_digest: String(v1.source_digest),
    generated_at: String(v1.generated_at),
    brand: {
      display_name: String(settings.display_name ?? ""),
      ...(typeof settings.short_description === "string" ? { short_description: settings.short_description } : {}),
      ...(settings.logo ? { logo: upgradeMediaRef(settings.logo, origin) } : {}),
    },
    design: { key: ATELIER.key, version: ATELIER.version },
    tokens: resolveTokens(ATELIER.tokens, overrides),
    fonts,
    font_assets: (options.fontAssets ?? []).filter((asset) => families.has(asset.family)),
    font_fallbacks: (options.fontFallbacks ?? []).filter((face) => families.has(face.family)),
    routes,
    language,
    ...(timezone ? { timezone } : {}),
    pages,
    navigation,
    footer,
    redirects,
    collections: { destinations: [], stories: [], categories: [], testimonials: [] },
    offerings_snapshot: [],
    seo: {
      ...(typeof seo.title === "string" ? { title: seo.title } : {}),
      ...(typeof seo.description === "string" ? { description: seo.description } : {}),
      canonical_url: String(seo.canonical_url ?? ""),
      ...(seo.social_image ? { social_image: upgradeMediaRef(seo.social_image, origin) } : {}),
    },
    media,
    commercial: { references: structuredClone((v1.commercial_references as ArtifactV2["commercial"]["references"]) ?? []) },
  };
}
