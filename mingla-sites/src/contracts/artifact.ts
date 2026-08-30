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
    "venue_reservation" | "menu_link" | "gallery" | "hours_location" |
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

export function assertRestaurantArtifact(value: unknown): asserts value is RestaurantArtifact {
  if (!plainObject(value) || Object.keys(value).some((key) => !SAFE_KEYS.has(key))) throw new Error("ARTIFACT_SCHEMA_MISMATCH");
  if (value.schema_version !== 1 || value.renderer_key !== RENDERER_KEY || !Number.isInteger(value.renderer_version) || Number(value.renderer_version) < 1) throw new Error("ARTIFACT_RENDERER_MISMATCH");
  for (const id of [value.site_id, value.brand_id, value.publication_id]) if (typeof id !== "string" || !UUID.test(id)) throw new Error("ARTIFACT_ID_MISMATCH");
  if (typeof value.source_digest !== "string" || !DIGEST.test(value.source_digest)) throw new Error("ARTIFACT_DIGEST_MISMATCH");
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 5) throw new Error("ARTIFACT_PAGES_MISMATCH");
  const roles = new Set<string>();
  for (const page of value.pages as JsonObject[]) {
    if (!plainObject(page) || !["home", "about", "menu", "gallery", "contact"].includes(String(page.role)) || roles.has(String(page.role))) throw new Error("ARTIFACT_PAGE_ROLE_MISMATCH");
    roles.add(String(page.role));
    if (!Array.isArray(page.blocks) || page.blocks.length > 40) throw new Error("ARTIFACT_BLOCKS_MISMATCH");
    for (const block of page.blocks as JsonObject[]) {
      if (!plainObject(block) || !["hero", "rich_text", "media_feature", "cta", "offering_grid", "venue_reservation", "menu_link", "gallery", "hours_location", "testimonials", "faq", "contact_handoff", "divider", "spacer"].includes(String(block.type))) throw new Error("ARTIFACT_BLOCK_TYPE_MISMATCH");
      for (const [key, field] of Object.entries(block)) {
        if ((key === "href" || key === "url" || key.endsWith("_url")) && field != null && !isSafeHref(field)) throw new Error("ARTIFACT_LINK_MISMATCH");
        if (typeof field === "string" && /<(script|style|iframe|svg)|\son[a-z]+\s*=|javascript:/i.test(field)) throw new Error("ARTIFACT_UNSAFE_CONTENT");
      }
    }
  }
  if (!roles.has("home")) throw new Error("ARTIFACT_HOME_MISSING");
  if (!Array.isArray(value.media) || value.media.length > 500) throw new Error("ARTIFACT_MEDIA_MISMATCH");
  const mediaIds = new Set<string>();
  for (const item of value.media as JsonObject[]) {
    if (
      !plainObject(item) ||
      typeof item.id !== "string" ||
      !UUID.test(item.id) ||
      mediaIds.has(item.id) ||
      typeof item.url !== "string" ||
      !item.url.startsWith(`/media/${item.id}/`) && !item.url.startsWith(`https://gogi.sites.usemingla.com/media/${item.id}/`) ||
      typeof item.alt !== "string" ||
      item.alt.length > 240 ||
      !Number.isInteger(item.width) || Number(item.width) < 1 ||
      !Number.isInteger(item.height) || Number(item.height) < 1 ||
      typeof item.integrity !== "string" ||
      !DIGEST.test(item.integrity) ||
      typeof item.object_key !== "string" ||
      !item.object_key.startsWith(`approved/${String(value.site_id)}/${item.id}/`) ||
      !item.object_key.endsWith(".webp")
    ) throw new Error("ARTIFACT_MEDIA_MISMATCH");
    mediaIds.add(item.id);
  }
  if (!plainObject(value.site_settings) || typeof value.site_settings.display_name !== "string") throw new Error("ARTIFACT_SETTINGS_MISMATCH");
  if (!plainObject(value.navigation) || !Array.isArray(value.navigation.page_roles)) throw new Error("ARTIFACT_NAVIGATION_MISMATCH");
  if (!plainObject(value.footer)) throw new Error("ARTIFACT_FOOTER_MISMATCH");
  for (const link of Array.isArray(value.footer.links) ? value.footer.links as JsonObject[] : []) {
    if (!plainObject(link) || typeof link.label !== "string" || !isSafeHref(link.href)) throw new Error("ARTIFACT_LINK_MISMATCH");
  }
  if (!Array.isArray(value.commercial_references) || value.commercial_references.length > 100) throw new Error("ARTIFACT_COMMERCE_MISMATCH");
  for (const reference of value.commercial_references as JsonObject[]) {
    if (!plainObject(reference) || !["offering", "reservation", "checkout"].includes(String(reference.kind)) || typeof reference.id !== "string" || !UUID.test(reference.id) || !isCanonicalMinglaHref(reference.url)) throw new Error("ARTIFACT_COMMERCE_MISMATCH");
  }
}
