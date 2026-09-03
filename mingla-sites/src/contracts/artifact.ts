export const RENDERER_KEY = "restaurant-website-v1" as const;
export const ARTIFACT_SCHEMA_VERSION = 1 as const;

type JsonObject = Record<string, unknown>;

export type MediaReference = {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  integrity: string;
  object_key: string;
};

export type RestaurantBlock = {
  type: "hero" | "rich_text" | "media_feature" | "cta" | "offering_grid" |
    "venue_reservation" | "menu_link" | "menu_board" | "gallery" | "hours_location" |
    "testimonials" | "faq" | "contact_handoff" | "divider" | "spacer";
  [key: string]: unknown;
};

export type RestaurantArtifact = {
  schema_version: 1;
  site_id: string;
  brand_id: string;
  renderer_key: typeof RENDERER_KEY;
  renderer_version: number;
  publication_id: string;
  source_revision_id: string;
  source_digest: string;
  generated_at: string;
  pages: Array<{
    role: "home" | "about" | "menu" | "gallery" | "contact";
    slug: string;
    title: string;
    enabled: boolean;
    nav_label: string;
    nav_order: number;
    blocks: RestaurantBlock[];
    seo?: { title?: string; description?: string };
  }>;
  navigation: { page_roles: string[] };
  footer: { address?: string; hours_summary?: string; legal_text?: string; links?: Array<{ label: string; href: string }> };
  site_settings: {
    display_name: string;
    short_description?: string;
    logo?: MediaReference;
    colors?: { background?: string; foreground?: string; accent?: string };
    typography?: "modern-sans" | "editorial-serif";
    seo?: { title?: string; description?: string; canonical_url: string; social_image?: MediaReference };
  };
  media: MediaReference[];
  commercial_references: Array<{ kind: "offering" | "reservation" | "checkout"; id: string; url: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const SAFE_KEYS = new Set([
  "schema_version", "site_id", "brand_id", "renderer_key", "renderer_version",
  "publication_id", "source_revision_id", "source_digest", "generated_at",
  "pages", "navigation", "footer", "site_settings", "media", "commercial_references",
]);
const FORBIDDEN_TEXT =
  /<(?:script|style|iframe|svg)|\son[a-z]+\s*=|javascript:|data:|blob:|file:/i;

function hasOnlyKeys(value: JsonObject, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedText(
  value: unknown,
  max: number,
  required = false,
): boolean {
  return (
    (!required && value == null) ||
    (typeof value === "string" &&
      value.length <= max &&
      (!required || value.length > 0) &&
      !FORBIDDEN_TEXT.test(value))
  );
}

function exactRows(
  value: unknown,
  min: number,
  max: number,
  keys: readonly string[],
  validate: (row: JsonObject) => boolean,
): boolean {
  return Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every((row) =>
      plainObject(row) && hasOnlyKeys(row, keys) && validate(row)
    );
}

export function isSafeHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001F\u007F]/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\");
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === "https:" || url.protocol === "mailto:" || url.protocol === "tel:";
  } catch { return false; }
}

export function isCanonicalMinglaHref(value: unknown): value is string {
  if (!isSafeHref(value) || value.startsWith("/")) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "usemingla.com" || url.hostname.endsWith(".usemingla.com"));
  } catch {
    return false;
  }
}

function plainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertMediaReference(value: unknown, siteId: string): void {
  if (
    !plainObject(value) ||
    !hasOnlyKeys(value, [
      "id",
      "url",
      "alt",
      "width",
      "height",
      "integrity",
      "object_key",
    ]) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    typeof value.url !== "string" ||
    (!value.url.startsWith(`/media/${value.id}/`) &&
      !value.url.startsWith(
        `https://gogi.sites.usemingla.com/media/${value.id}/`,
      )) ||
    !boundedText(value.alt, 240) ||
    !Number.isInteger(value.width) ||
    Number(value.width) < 1 ||
    !Number.isInteger(value.height) ||
    Number(value.height) < 1 ||
    typeof value.integrity !== "string" ||
    !DIGEST.test(value.integrity) ||
    typeof value.object_key !== "string" ||
    !value.object_key.startsWith(`approved/${siteId}/${value.id}/`) ||
    !value.object_key.endsWith(".webp")
  ) throw new Error("ARTIFACT_MEDIA_MISMATCH");
}

function assertRestaurantBlock(block: JsonObject, siteId: string): void {
  const type = String(block.type);
  const definitions: Record<string, readonly string[]> = {
    hero: ["type", "heading", "subheading", "media_url", "ctas"],
    rich_text: ["type", "heading", "paragraphs"],
    media_feature: [
      "type",
      "media_url",
      "alt",
      "heading",
      "caption",
      "alignment",
    ],
    cta: ["type", "heading", "body", "label", "href"],
    offering_grid: ["type", "heading", "offerings"],
    venue_reservation: ["type", "heading", "body", "url"],
    menu_link: ["type", "heading", "label", "href"],
    menu_board: ["type", "heading", "note", "venue_id", "sections"],
    gallery: ["type", "heading", "images"],
    hours_location: ["type", "heading", "address", "map_url", "hours"],
    testimonials: ["type", "heading", "items"],
    faq: ["type", "heading", "items"],
    contact_handoff: ["type", "heading", "body", "label", "href"],
    divider: ["type"],
    spacer: ["type", "size"],
  };
  if (!definitions[type] || !hasOnlyKeys(block, definitions[type])) {
    throw new Error("ARTIFACT_BLOCK_TYPE_MISMATCH");
  }
  const safeLink = (value: unknown) => value == null || isSafeHref(value);
  let valid = false;
  switch (type) {
    case "hero":
      valid = boundedText(block.heading, 120, true) &&
        boundedText(block.subheading, 300) &&
        isSafeHref(block.media_url) &&
        exactRows(block.ctas, 0, 2, ["label", "href"], (row) =>
          boundedText(row.label, 80, true) && isSafeHref(row.href));
      break;
    case "rich_text":
      valid = boundedText(block.heading, 120) &&
        exactRows(block.paragraphs, 1, 30, ["text"], (row) =>
          boundedText(row.text, 2_000, true));
      break;
    case "media_feature":
      valid = isSafeHref(block.media_url) &&
        boundedText(block.alt, 240, true) &&
        boundedText(block.heading, 120) &&
        boundedText(block.caption, 500) &&
        ["left", "right"].includes(String(block.alignment));
      break;
    case "cta":
      valid = boundedText(block.heading, 120, true) &&
        boundedText(block.body, 500) &&
        boundedText(block.label, 80, true) && isSafeHref(block.href);
      break;
    case "offering_grid":
      valid = boundedText(block.heading, 120) &&
        exactRows(
          block.offerings,
          1,
          12,
          ["id", "label", "summary", "url"],
          (row) =>
            typeof row.id === "string" && UUID.test(row.id) &&
            boundedText(row.label, 200, true) &&
            boundedText(row.summary, 500) && isCanonicalMinglaHref(row.url),
        );
      break;
    case "venue_reservation":
      valid = boundedText(block.heading, 120, true) &&
        boundedText(block.body, 500) && isCanonicalMinglaHref(block.url);
      break;
    case "menu_link":
      valid = boundedText(block.heading, 120) &&
        boundedText(block.label, 80, true) && isSafeHref(block.href);
      break;
    /*
     * #2830 — the real menu, owned by Mingla.
     *
     * `menu_link` only ever pointed at a PDF. This carries the actual items,
     * projected from Mingla's own `menus` / `menu_items` at publish time, so
     * the website and the app cannot disagree about what a restaurant sells.
     *
     * PRICE IS DELIBERATELY NULLABLE AND SEPARATE FROM CURRENCY. Mingla stores
     * price in MINOR units with NULL meaning "price on request"; a menu that
     * renders a missing price as 0, or guesses a currency, is fabricated data
     * (Constitution rule 9) and, for a restaurant, a live commercial lie. Both
     * must be present for a number to be shown, and the renderer enforces it.
     */
    case "menu_board":
      valid = boundedText(block.heading, 120) &&
        boundedText(block.note, 300) &&
        (block.venue_id == null || (typeof block.venue_id === "string" && UUID.test(block.venue_id))) &&
        exactRows(block.sections, 1, 20, ["name", "description", "items"], (section) =>
          boundedText(section.name, 120, true) &&
          boundedText(section.description, 500) &&
          exactRows(section.items, 1, 120, ["id", "name", "description", "price_minor", "currency"], (item) =>
            (typeof item.id === "string" && UUID.test(item.id)) &&
            boundedText(item.name, 160, true) &&
            boundedText(item.description, 600) &&
            (item.price_minor == null ||
              (typeof item.price_minor === "number" &&
                Number.isInteger(item.price_minor) &&
                item.price_minor >= 0 &&
                item.price_minor <= 100_000_000)) &&
            (item.currency == null ||
              (typeof item.currency === "string" &&
                /^[A-Z]{3}$/.test(item.currency)))));
      break;
    case "gallery":
      valid = boundedText(block.heading, 120) && Array.isArray(block.images) &&
        block.images.length >= 1 && block.images.length <= 12;
      if (valid) {
        for (const image of block.images as unknown[]) {
          assertMediaReference(image, siteId);
        }
      }
      break;
    case "hours_location":
      valid = boundedText(block.heading, 120) &&
        boundedText(block.address, 300, true) && safeLink(block.map_url) &&
        exactRows(block.hours, 1, 7, ["day", "value"], (row) =>
          boundedText(row.day, 20, true) && boundedText(row.value, 80, true));
      break;
    case "testimonials":
      valid = boundedText(block.heading, 120) &&
        exactRows(block.items, 1, 8, ["name", "quote"], (row) =>
          boundedText(row.name, 120, true) &&
          boundedText(row.quote, 500, true));
      break;
    case "faq":
      valid = boundedText(block.heading, 120) &&
        exactRows(block.items, 1, 12, ["question", "answer"], (row) =>
          boundedText(row.question, 240, true) &&
          boundedText(row.answer, 1_000, true));
      break;
    case "contact_handoff":
      valid = boundedText(block.heading, 120, true) &&
        boundedText(block.body, 500) &&
        boundedText(block.label, 80, true) && isSafeHref(block.href);
      break;
    case "divider":
      valid = true;
      break;
    case "spacer":
      valid = ["small", "medium", "large"].includes(String(block.size));
      break;
  }
  if (!valid) throw new Error("ARTIFACT_BLOCK_CONTENT_MISMATCH");
}

export function assertRestaurantArtifact(value: unknown): asserts value is RestaurantArtifact {
  if (!plainObject(value) || Object.keys(value).some((key) => !SAFE_KEYS.has(key))) throw new Error("ARTIFACT_SCHEMA_MISMATCH");
  if (value.schema_version !== 1 || value.renderer_key !== RENDERER_KEY || !Number.isInteger(value.renderer_version) || Number(value.renderer_version) < 1) throw new Error("ARTIFACT_RENDERER_MISMATCH");
  for (const id of [value.site_id, value.brand_id, value.publication_id]) if (typeof id !== "string" || !UUID.test(id)) throw new Error("ARTIFACT_ID_MISMATCH");
  if (
    typeof value.source_digest !== "string" ||
    !DIGEST.test(value.source_digest) ||
    !boundedText(value.source_revision_id, 200, true) ||
    !boundedText(value.generated_at, 40, true) ||
    !Number.isFinite(Date.parse(String(value.generated_at)))
  ) throw new Error("ARTIFACT_DIGEST_MISMATCH");
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 5) throw new Error("ARTIFACT_PAGES_MISMATCH");
  const roles = new Set<string>();
  for (const page of value.pages as JsonObject[]) {
    if (
      !plainObject(page) ||
      !hasOnlyKeys(page, [
        "role",
        "slug",
        "title",
        "enabled",
        "nav_label",
        "nav_order",
        "blocks",
        "seo",
      ]) ||
      !["home", "about", "menu", "gallery", "contact"].includes(
        String(page.role),
      ) ||
      roles.has(String(page.role)) ||
      !boundedText(page.slug, 20, true) ||
      !boundedText(page.title, 120, true) ||
      typeof page.enabled !== "boolean" ||
      !boundedText(page.nav_label, 40, true) ||
      !Number.isInteger(page.nav_order) ||
      Number(page.nav_order) < 0 || Number(page.nav_order) > 4
    ) throw new Error("ARTIFACT_PAGE_ROLE_MISMATCH");
    roles.add(String(page.role));
    if (!Array.isArray(page.blocks) || page.blocks.length > 40) throw new Error("ARTIFACT_BLOCKS_MISMATCH");
    for (const block of page.blocks as JsonObject[]) {
      if (!plainObject(block)) throw new Error("ARTIFACT_BLOCK_TYPE_MISMATCH");
      assertRestaurantBlock(block, String(value.site_id));
    }
    if (
      page.seo != null &&
      (!plainObject(page.seo) ||
        !hasOnlyKeys(page.seo, ["title", "description"]) ||
        !boundedText(page.seo.title, 70) ||
        !boundedText(page.seo.description, 170))
    ) {
      throw new Error("ARTIFACT_PAGE_SEO_MISMATCH");
    }
  }
  if (!roles.has("home")) throw new Error("ARTIFACT_HOME_MISSING");
  if (!Array.isArray(value.media) || value.media.length > 500) throw new Error("ARTIFACT_MEDIA_MISMATCH");
  const mediaIds = new Set<string>();
  for (const item of value.media as JsonObject[]) {
    assertMediaReference(item, String(value.site_id));
    if (mediaIds.has(String(item.id))) throw new Error("ARTIFACT_MEDIA_MISMATCH");
    mediaIds.add(String(item.id));
  }
  const mediaUrls = new Set(
    (value.media as JsonObject[]).map((item) => String(item.url)),
  );
  for (const page of value.pages as JsonObject[]) {
    for (const block of page.blocks as JsonObject[]) {
      if (
        ["hero", "media_feature"].includes(String(block.type)) &&
        !mediaUrls.has(String(block.media_url))
      ) throw new Error("ARTIFACT_MEDIA_MISMATCH");
      if (
        block.type === "gallery" &&
        (block.images as JsonObject[]).some((image) =>
          !mediaIds.has(String(image.id))
        )
      ) throw new Error("ARTIFACT_MEDIA_MISMATCH");
    }
  }
  if (
    !plainObject(value.site_settings) ||
    !hasOnlyKeys(value.site_settings, [
      "display_name",
      "short_description",
      "logo",
      "colors",
      "typography",
      "seo",
    ]) ||
    !boundedText(value.site_settings.display_name, 120, true) ||
    !boundedText(value.site_settings.short_description, 300)
  ) throw new Error("ARTIFACT_SETTINGS_MISMATCH");
  if (value.site_settings.logo != null) {
    assertMediaReference(value.site_settings.logo, String(value.site_id));
    if (!mediaIds.has(String((value.site_settings.logo as JsonObject).id))) {
      throw new Error("ARTIFACT_MEDIA_MISMATCH");
    }
  }
  if (
    value.site_settings.colors != null &&
    (!plainObject(value.site_settings.colors) ||
      !hasOnlyKeys(value.site_settings.colors, [
        "background",
        "foreground",
        "accent",
      ]) ||
      Object.values(value.site_settings.colors).some((color) =>
        color != null &&
        (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))
      ))
  ) throw new Error("ARTIFACT_SETTINGS_MISMATCH");
  if (
    value.site_settings.typography != null &&
    !["modern-sans", "editorial-serif"].includes(
      String(value.site_settings.typography),
    )
  ) throw new Error("ARTIFACT_SETTINGS_MISMATCH");
  if (
    !plainObject(value.site_settings.seo) ||
    !hasOnlyKeys(value.site_settings.seo, [
      "title",
      "description",
      "canonical_url",
      "social_image",
    ]) ||
    !boundedText(value.site_settings.seo.title, 70) ||
    !boundedText(value.site_settings.seo.description, 170) ||
    value.site_settings.seo.canonical_url !==
      "https://gogi.sites.usemingla.com"
  ) throw new Error("ARTIFACT_SETTINGS_MISMATCH");
  if (value.site_settings.seo.social_image != null) {
    assertMediaReference(
      value.site_settings.seo.social_image,
      String(value.site_id),
    );
    if (
      !mediaIds.has(
        String((value.site_settings.seo.social_image as JsonObject).id),
      )
    ) {
      throw new Error("ARTIFACT_MEDIA_MISMATCH");
    }
  }
  if (
    !plainObject(value.navigation) ||
    !hasOnlyKeys(value.navigation, ["page_roles"]) ||
    !Array.isArray(value.navigation.page_roles) ||
    value.navigation.page_roles.length > 5 ||
    value.navigation.page_roles.some((role) => !roles.has(String(role)))
  ) throw new Error("ARTIFACT_NAVIGATION_MISMATCH");
  if (
    !plainObject(value.footer) ||
    !hasOnlyKeys(value.footer, [
      "address",
      "hours_summary",
      "legal_text",
      "links",
    ]) ||
    !boundedText(value.footer.address, 300) ||
    !boundedText(value.footer.hours_summary, 500) ||
    !boundedText(value.footer.legal_text, 500)
  ) throw new Error("ARTIFACT_FOOTER_MISMATCH");
  for (const link of Array.isArray(value.footer.links) ? value.footer.links as JsonObject[] : []) {
    if (
      !plainObject(link) ||
      !hasOnlyKeys(link, ["label", "href"]) ||
      !boundedText(link.label, 80, true) ||
      !isSafeHref(link.href)
    ) throw new Error("ARTIFACT_LINK_MISMATCH");
  }
  if (
    value.footer.links != null &&
    (!Array.isArray(value.footer.links) || value.footer.links.length > 8)
  ) {
    throw new Error("ARTIFACT_FOOTER_MISMATCH");
  }
  if (!Array.isArray(value.commercial_references) || value.commercial_references.length > 100) throw new Error("ARTIFACT_COMMERCE_MISMATCH");
  for (const reference of value.commercial_references as JsonObject[]) {
    if (
      !plainObject(reference) ||
      !hasOnlyKeys(reference, ["kind", "id", "url"]) ||
      !["offering", "reservation", "checkout"].includes(
        String(reference.kind),
      ) ||
      typeof reference.id !== "string" ||
      !UUID.test(reference.id) ||
      !isCanonicalMinglaHref(reference.url)
    ) throw new Error("ARTIFACT_COMMERCE_MISMATCH");
  }
}
