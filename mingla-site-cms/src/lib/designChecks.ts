/**
 * #2829 W9b (L4) — the six design checks, in plain English, over a site's
 * DRAFT: (1) words, (2) photos, (3) readability, (4) links, (5) truth and
 * (6) phone layout.
 *
 * Every result is a WARNING: nothing here blocks saving, previewing or
 * publishing (Seth decision 3; readability never auto-adjusts). What a
 * publish requires is only that the checks were RUN on the exact draft before
 * a site's first publish (the publications endpoint checks a stored run).
 * Pure: it reads the draft and returns words. It cannot change anything.
 */
import { BLOCK_CATALOG, isBlockType, type BlockType, type FieldSpec } from "../contracts/generated/blocks.ts";
import { designFor, DESIGNS } from "../contracts/generated/designs.ts";
import { readabilityWarnings, warningSentence } from "../contracts/generated/readability.ts";
import { resolveTokens } from "../contracts/generated/tokens.ts";
import { isSafeHref } from "../contracts/generated/safety.ts";
import { MAX_NAV_ITEMS } from "../contracts/generated/limits.ts";
import { buildClaimEvidence, claimSentence, unbackedClaims, type ClaimOffering } from "../contracts/generated/claims.ts";
import { lexicalText } from "./artifactBuilder";
import { isHomePage, tenantPagePaths, siteRouting } from "./pageTree";
import { ownerTokensOf } from "./siteLook";

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const DESIGN_CHECK_KEYS = ["words", "photos", "readability", "links", "truth", "phone"] as const;
export type DesignCheckKey = (typeof DESIGN_CHECK_KEYS)[number];

export type DesignCheckItem = {
  message: string;
  /** Where to fix it: a page address ("" is home), or a Website section. */
  page_path?: string | null;
  section?: "pages" | "design" | "destinations" | "stories" | "reviews" | "settings";
};

export type DesignCheckResult = {
  key: DesignCheckKey;
  label: string;
  status: "pass" | "warn";
  items: DesignCheckItem[];
};

export type DesignCheckInput = {
  pages: readonly AnyDoc[];
  settings: AnyDoc | null;
  navigation: AnyDoc | null;
  /** The tenant's READY media (width, alt). */
  media: readonly AnyDoc[];
  content: { destinations?: readonly AnyDoc[]; stories?: readonly AnyDoc[]; testimonials?: readonly AnyDoc[] };
  /** Core-signed evidence: the brand's live offerings and its own words. */
  evidence: { offerings: readonly ClaimOffering[]; brand_texts: readonly string[] };
  /** Words the owner said or pasted that a logged change cited. */
  owner_texts: readonly string[];
};

const LABELS: Record<DesignCheckKey, string> = {
  words: "Words",
  photos: "Photos",
  readability: "Readability",
  links: "Links and buttons",
  truth: "Truth",
  phone: "Phone layout",
};

/** Words that mean a block was left unfinished. */
const PLACEHOLDERS = [/lorem ipsum/i, /\bTBD\b/, /\bTODO\b/, /\[[^\]]*\]/, /your (?:text|heading|title) here/i, /\bplaceholder\b/i, /\bXXX+\b/i, /coming soon/i];
/** Phrases every travel site uses; worth a second look, never an error. */
export const CLICHES = [
  "hidden gem", "once in a lifetime", "once-in-a-lifetime", "bucket list", "wanderlust", "unforgettable experience",
  "like never before", "look no further", "something for everyone", "memories that last a lifetime",
  "off the beaten path", "best kept secret", "world is your oyster",
];
const UNFINISHED = /(?:\.\.\.|…|,|\b(?:and|or|the|a|an|to|of|with|for))\s*$/i;

/** The picture each block slot needs at least (CSS px × 2 for sharp screens). */
const SLOT_MIN_WIDTH: Record<string, number> = { hero: 1600, page_header: 1600, media_feature: 1000, video_feature: 1280, gallery: 800 };

/**
 * #2829 — the longest headline (characters) each design sets on a 390 px
 * phone in its hero without breaking into more than three lines.
 */
export const PHONE_HEADLINE_MAX: Readonly<Record<string, number>> = { atelier: 48, voyage: 42 };
const PHONE_BUTTON_LABEL_MAX = 28;

const RESERVED_FIRST_SEGMENTS = new Set(["om", "media", "fonts", "map", "api"]);

type TextHit = { text: string; page_path: string | null; where: string };

function relationId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "object" ? String((value as AnyDoc).id ?? "") || null : String(value);
}

/** Every visitor-facing piece of text on the draft's pages, with where it sits. */
function pageTexts(pages: readonly AnyDoc[], paths: Map<string, string>): TextHit[] {
  const hits: TextHit[] = [];
  for (const page of pages) {
    if (page.enabled === false && !isHomePage(page)) continue;
    const page_path = paths.get(String(page.id)) ?? null;
    if (typeof page.title === "string") hits.push({ text: page.title, page_path, where: "page title" });
    for (const [index, block] of (Array.isArray(page.blocks) ? page.blocks : []).entries()) {
      const type = String(block?.blockType ?? "");
      const where = `${isBlockType(type) ? BLOCK_CATALOG[type].label : type} block ${index + 1}`;
      const visit = (value: unknown, key: string) => {
        if (typeof value === "string" && value.trim() && !/(?:href|url|_id|variant|blockType|id)$/i.test(key)) hits.push({ text: value, page_path, where });
        else if (Array.isArray(value)) value.forEach((row) => visit(row, key));
        else if (value && typeof value === "object") {
          if ((value as AnyDoc).root) {
            const text = lexicalText(value).join("");
            if (text) hits.push({ text, page_path, where });
          } else for (const [child, inner] of Object.entries(value)) visit(inner, child);
        }
      };
      for (const [key, value] of Object.entries(block ?? {})) {
        if (["blockType", "variant", "id", "blockName", "media", "video", "poster"].includes(key)) continue;
        visit(value, key);
      }
    }
  }
  return hits;
}

function contentTexts(content: DesignCheckInput["content"]): TextHit[] {
  const hits: TextHit[] = [];
  for (const doc of content.destinations ?? []) {
    if (doc.enabled === false) continue;
    for (const key of ["title", "tagline", "summary", "story_heading"]) if (typeof doc[key] === "string") hits.push({ text: doc[key], page_path: null, where: `destination “${doc.title ?? ""}”` });
    const body = lexicalText(doc.body).join("");
    if (body) hits.push({ text: body, page_path: null, where: `destination “${doc.title ?? ""}”` });
  }
  for (const doc of content.stories ?? []) {
    if (doc.enabled === false) continue;
    for (const key of ["title", "excerpt"]) if (typeof doc[key] === "string") hits.push({ text: doc[key], page_path: null, where: `story “${doc.title ?? ""}”` });
    const body = lexicalText(doc.content).join("");
    if (body) hits.push({ text: body, page_path: null, where: `story “${doc.title ?? ""}”` });
  }
  return hits;
}

function placeLabel(hit: { page_path: string | null; where: string }): string {
  if (hit.page_path === null) return hit.where;
  return `${hit.page_path === "" ? "Home" : `/${hit.page_path}`}, ${hit.where}`;
}

/** Every link on the draft's pages (block fields and rich text). */
function pageLinks(pages: readonly AnyDoc[], paths: Map<string, string>): Array<{ href: string; page_path: string | null; where: string }> {
  const links: Array<{ href: string; page_path: string | null; where: string }> = [];
  for (const page of pages) {
    if (page.enabled === false && !isHomePage(page)) continue;
    const page_path = paths.get(String(page.id)) ?? null;
    for (const [index, block] of (Array.isArray(page.blocks) ? page.blocks : []).entries()) {
      const type = String(block?.blockType ?? "");
      const where = `${isBlockType(type) ? BLOCK_CATALOG[type].label : type} block ${index + 1}`;
      const visit = (value: unknown, key: string) => {
        if (typeof value === "string" && /(?:^href$|_href$|^url$|directions_url|map_url)/.test(key) && value.trim()) links.push({ href: value.trim(), page_path, where });
        else if (Array.isArray(value)) value.forEach((row) => visit(row, key));
        else if (value && typeof value === "object") {
          const node = value as AnyDoc;
          if (node.type === "link" && typeof node.fields?.url === "string") links.push({ href: node.fields.url, page_path, where });
          for (const [child, inner] of Object.entries(node)) visit(inner, child);
        }
      };
      for (const [key, value] of Object.entries(block ?? {})) visit(value, key);
    }
  }
  return links;
}

function internalPathResolves(href: string, pagePaths: ReadonlySet<string>, input: DesignCheckInput): boolean {
  const path = href.split(/[?#]/)[0]!.replace(/^\/+|\/+$/g, "");
  if (pagePaths.has(path)) return true;
  const [first, second] = path.split("/");
  if (first && RESERVED_FIRST_SEGMENTS.has(first)) return true;
  const { routes } = siteRouting(input.settings);
  const slugs = (docs: readonly AnyDoc[] | undefined) => new Set((docs ?? []).filter((doc) => doc.enabled !== false).map((doc) => String(doc.slug ?? "")));
  const destinations = slugs(input.content.destinations);
  const stories = slugs(input.content.stories);
  if (first === routes.destinations && second && destinations.has(second)) return true;
  if (routes.stories === "" ? (path && !path.includes("/") && stories.has(path)) : first === routes.stories && second && stories.has(second)) return true;
  return false;
}

export function runDesignChecks(input: DesignCheckInput): DesignCheckResult[] {
  const paths = tenantPagePaths(input.pages as never);
  const pagePaths = new Set(input.pages.filter((page) => page.enabled !== false || isHomePage(page)).map((page) => paths.get(String(page.id)) ?? ""));
  const texts = [...pageTexts(input.pages, paths), ...contentTexts(input.content)];
  const designKey = typeof input.settings?.design === "string" && designFor(input.settings.design) ? String(input.settings.design) : "atelier";
  const design = designFor(designKey) ?? DESIGNS.atelier;
  const mediaById = new Map(input.media.map((doc) => [String(doc.id), doc]));

  // (1) Words
  const words: DesignCheckItem[] = [];
  for (const hit of texts) {
    if (PLACEHOLDERS.some((re) => re.test(hit.text))) words.push({ message: `${placeLabel(hit)} still has placeholder text: “${hit.text.slice(0, 60)}”`, page_path: hit.page_path, section: "pages" });
    else if (hit.text.length > 24 && UNFINISHED.test(hit.text)) words.push({ message: `${placeLabel(hit)} looks unfinished: “…${hit.text.slice(-40)}”`, page_path: hit.page_path, section: "pages" });
    for (const cliche of CLICHES) {
      if (hit.text.toLowerCase().includes(cliche)) words.push({ message: `${placeLabel(hit)} says “${cliche}”, which most travel sites say. Your own words are stronger.`, page_path: hit.page_path, section: "pages" });
    }
  }
  for (const page of input.pages) {
    if (page.enabled === false && !isHomePage(page)) continue;
    for (const [index, block] of (Array.isArray(page.blocks) ? page.blocks : []).entries()) {
      const type = String(block?.blockType ?? "");
      if (!isBlockType(type)) continue;
      const headingSpec = (BLOCK_CATALOG[type].fields as Record<string, FieldSpec>).heading;
      if (headingSpec && "required" in headingSpec && headingSpec.required && !(typeof block.heading === "string" && block.heading.trim())) {
        words.push({ message: `${placeLabel({ page_path: paths.get(String(page.id)) ?? null, where: `${BLOCK_CATALOG[type].label} block ${index + 1}` })} has an empty heading`, page_path: paths.get(String(page.id)) ?? null, section: "pages" });
      }
    }
  }

  // (2) Photos
  const photos: DesignCheckItem[] = [];
  const checkPicture = (id: string | null, page_path: string | null, where: string, slot: string, needsAlt: boolean, alt: unknown) => {
    if (!id) {
      photos.push({ message: `${placeLabel({ page_path, where })} has no picture yet`, page_path, section: "pages" });
      return;
    }
    const media = mediaById.get(id);
    if (!media) {
      photos.push({ message: `${placeLabel({ page_path, where })} uses a picture that is no longer in your library`, page_path, section: "pages" });
      return;
    }
    const need = SLOT_MIN_WIDTH[slot];
    if (need && typeof media.width === "number" && media.width < need && String(media.detected_mime ?? "").startsWith("image/")) {
      photos.push({ message: `${placeLabel({ page_path, where })}: the picture is ${media.width} px wide; this spot looks sharp from ${need} px`, page_path, section: "pages" });
    }
    if (needsAlt && !(typeof alt === "string" && alt.trim())) {
      photos.push({ message: `${placeLabel({ page_path, where })}: the picture has no description for people who can't see it`, page_path, section: "pages" });
    }
  };
  for (const page of input.pages) {
    if (page.enabled === false && !isHomePage(page)) continue;
    const page_path = paths.get(String(page.id)) ?? null;
    for (const [index, block] of (Array.isArray(page.blocks) ? page.blocks : []).entries()) {
      const type = String(block?.blockType ?? "") as BlockType;
      const where = `${isBlockType(type) ? BLOCK_CATALOG[type].label : type} block ${index + 1}`;
      if (type === "hero") checkPicture(relationId(block.media), page_path, where, "hero", false, null);
      if (type === "media_feature") checkPicture(relationId(block.media), page_path, where, "media_feature", true, block.alt);
      if (type === "video_feature") checkPicture(relationId(block.poster), page_path, where, "video_feature", false, null);
      if (type === "page_header" && relationId(block.media)) checkPicture(relationId(block.media), page_path, where, "page_header", false, null);
      if (type === "gallery") {
        const images = Array.isArray(block.images) ? block.images : [];
        if (!images.length) photos.push({ message: `${placeLabel({ page_path, where })} has no photos yet`, page_path, section: "pages" });
        for (const image of images) checkPicture(relationId(image?.media), page_path, where, "gallery", true, image?.alt);
      }
    }
  }
  for (const doc of input.content.destinations ?? []) {
    if (doc.enabled === false) continue;
    const missing = (Array.isArray(doc.gallery) ? doc.gallery : []).filter((row: AnyDoc) => !(typeof row?.alt === "string" && row.alt.trim())).length;
    if (missing) photos.push({ message: `Destination “${doc.title ?? ""}”: ${missing} ${missing === 1 ? "photo has" : "photos have"} no description`, section: "destinations" });
    if (!relationId(doc.featured_image)) photos.push({ message: `Destination “${doc.title ?? ""}” has no main picture`, section: "destinations" });
  }
  // #2829 W11 (R1 E11/E14) — a logo is not a photo. When it is the only
  // image, the owner still gets the explicit three-photo to-do; when it is too
  // small for a header, Ari offers the truthful text wordmark until a sharper
  // file is ready. These remain warnings: the owner can publish either way.
  const logoId = relationId(input.settings?.logo);
  const logo = logoId ? mediaById.get(logoId) : null;
  if (logoId && !logo) {
    photos.push({ message: "Your logo is no longer in the media library. Use the text logo until you upload it again.", section: "design" });
  } else if (logo) {
    const width = typeof logo.width === "number" ? logo.width : null;
    const height = typeof logo.height === "number" ? logo.height : null;
    if ((width !== null && width < 320) || (height !== null && height < 96)) {
      const size = width !== null && height !== null ? `${width} × ${height} px` : `${width ?? height} px`;
      photos.push({
        message: `Your logo is only ${size}. Preview it small on both light and dark backgrounds; use the text logo until a sharper file is ready.`,
        section: "design",
      });
    }
  }
  const hasPhoto = input.media.some((doc) =>
    String(doc.id) !== logoId && String(doc.detected_mime ?? "").startsWith("image/"));
  if (!hasPhoto) {
    photos.push({
      message: "No photos yet. The colour hero stays intentional; add 3 photos when you are ready.",
      section: "pages",
    });
  }

  // (3) Readability (the W3 warnings, never changed for the owner)
  const readability: DesignCheckItem[] = readabilityWarnings(resolveTokens(design.tokens, ownerTokensOf(input.settings)))
    .map((warning) => ({ message: warningSentence(warning), section: "design" as const }));

  // (4) Links
  const links: DesignCheckItem[] = [];
  for (const link of pageLinks(input.pages, paths)) {
    const at = placeLabel(link);
    if (link.href.startsWith("/")) {
      if (!internalPathResolves(link.href, pagePaths, input)) links.push({ message: `${at}: “${link.href}” doesn't go to a page on your website`, page_path: link.page_path, section: "pages" });
    } else if (/^mailto:/i.test(link.href)) {
      if (!/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(link.href.split("?")[0]!)) links.push({ message: `${at}: “${link.href}” isn't a complete email address`, page_path: link.page_path, section: "pages" });
    } else if (/^tel:/i.test(link.href)) {
      if (!/^tel:\+?[\d\s().-]{6,20}$/i.test(link.href)) links.push({ message: `${at}: “${link.href}” isn't a phone number`, page_path: link.page_path, section: "pages" });
    } else if (!isSafeHref(link.href) || !/^https:\/\//i.test(link.href)) {
      links.push({ message: `${at}: “${link.href}” must be a secure (https) link`, page_path: link.page_path, section: "pages" });
    }
  }

  // (5) Truth
  const evidence = buildClaimEvidence({ offerings: input.evidence.offerings, brandTexts: input.evidence.brand_texts, ownerTexts: input.owner_texts });
  const truth: DesignCheckItem[] = [];
  for (const hit of texts) {
    for (const claim of unbackedClaims(hit.text, evidence)) truth.push({ message: `${claimSentence(claim)} (${placeLabel(hit)})`, page_path: hit.page_path, section: hit.page_path === null ? undefined : "pages" });
  }

  // (6) Phone layout
  const phone: DesignCheckItem[] = [];
  const headlineMax = PHONE_HEADLINE_MAX[designKey] ?? 42;
  for (const page of input.pages) {
    if (page.enabled === false && !isHomePage(page)) continue;
    const page_path = paths.get(String(page.id)) ?? null;
    for (const [index, block] of (Array.isArray(page.blocks) ? page.blocks : []).entries()) {
      if (block?.blockType !== "hero") continue;
      const where = `Hero block ${index + 1}`;
      const lines = (Array.isArray(block.heading_lines) ? block.heading_lines : []).map((row: AnyDoc) => String(row?.text ?? "")).filter(Boolean);
      const headline = lines.length ? lines.join(" ") : String(block.heading ?? "");
      if (headline.length > headlineMax) phone.push({ message: `${placeLabel({ page_path, where })}: the headline is ${headline.length} characters; on a phone this design fits about ${headlineMax}`, page_path, section: "pages" });
      const ctas = Array.isArray(block.ctas) ? block.ctas : [];
      if (ctas.length > 2) phone.push({ message: `${placeLabel({ page_path, where })} has ${ctas.length} buttons; phones show two comfortably`, page_path, section: "pages" });
      for (const cta of ctas) {
        if (typeof cta?.label === "string" && cta.label.length > PHONE_BUTTON_LABEL_MAX) phone.push({ message: `${placeLabel({ page_path, where })}: the button “${cta.label}” is too long to tap easily on a phone`, page_path, section: "pages" });
      }
    }
    for (const [index, block] of (Array.isArray(page.blocks) ? page.blocks : []).entries()) {
      const label = typeof block?.cta_label === "string" ? block.cta_label : typeof block?.label === "string" && /(?:cta|menu_link|contact_handoff)/.test(String(block?.blockType)) ? block.label : null;
      if (label && label.length > PHONE_BUTTON_LABEL_MAX) phone.push({ message: `${placeLabel({ page_path, where: `${String(block.blockType)} block ${index + 1}` })}: the button “${label}” is too long to tap easily on a phone`, page_path, section: "pages" });
    }
  }
  const menuItems = Array.isArray(input.navigation?.items) ? input.navigation!.items.length : 0;
  if (menuItems > MAX_NAV_ITEMS) phone.push({ message: `Your menu has ${menuItems} items; phones list ${MAX_NAV_ITEMS} comfortably`, section: "pages" });

  const results: Record<DesignCheckKey, DesignCheckItem[]> = { words, photos, readability, links, truth, phone };
  return DESIGN_CHECK_KEYS.map((key) => ({ key, label: LABELS[key], status: results[key].length ? "warn" : "pass", items: results[key].slice(0, 50) }));
}

/** Total warnings across the six checks. */
export function designCheckWarningCount(results: readonly DesignCheckResult[]): number {
  return results.reduce((total, result) => total + result.items.length, 0);
}
