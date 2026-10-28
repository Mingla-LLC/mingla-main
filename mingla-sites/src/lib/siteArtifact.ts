import { assertRestaurantArtifact, type RestaurantArtifact } from "../contracts/artifact";
import { assertArtifactV2, type ArtifactV2 } from "../contracts/generated/artifactV2.ts";

/**
 * #2829 AD-1 — the two artifact generations the runtime serves.
 *
 * v2 (`sites-v2`) is what every new publish produces. v1
 * (`restaurant-website-v1`) is kept ONLY so a rollback to one of gögi's
 * earlier publications still renders (TEMPORARY(#2829): remove once every site
 * has a v2 last-good publication).
 */
export type SiteArtifact = RestaurantArtifact | ArtifactV2;

export function isV2Artifact(artifact: SiteArtifact): artifact is ArtifactV2 {
  return (artifact as ArtifactV2).artifact_schema_version === 2;
}

/** Validates bytes already parsed, for the generation the caller expects. */
export function assertSiteArtifact(
  value: unknown,
  schemaVersion: number,
  serializedBytes?: number,
): asserts value is SiteArtifact {
  if (schemaVersion === 2) {
    assertArtifactV2(value, serializedBytes);
    return;
  }
  if (schemaVersion === 1) {
    assertRestaurantArtifact(value);
    return;
  }
  throw new Error("ARTIFACT_RENDERER_MISMATCH");
}

/** The schema an artifact declares (1 or 2), or null. */
export function declaredSchema(value: unknown): 1 | 2 | null {
  const record = value as Record<string, unknown> | null;
  if (record?.artifact_schema_version === 2 && record.renderer_key === "sites-v2") return 2;
  if (record?.schema_version === 1 && record.renderer_key === "restaurant-website-v1") return 1;
  return null;
}

export function siteDisplayName(artifact: SiteArtifact): string {
  return isV2Artifact(artifact) ? artifact.brand.display_name : artifact.site_settings.display_name;
}

export function siteShortDescription(artifact: SiteArtifact): string | undefined {
  return isV2Artifact(artifact) ? artifact.brand.short_description : artifact.site_settings.short_description;
}

export function siteSeo(artifact: SiteArtifact): {
  title?: string;
  description?: string;
  canonical_url?: string;
  social_image?: { url: string; width: number; height: number; alt: string };
} {
  return (isV2Artifact(artifact) ? artifact.seo : artifact.site_settings.seo) ?? {};
}

export function siteCanonicalUrl(artifact: SiteArtifact): string | undefined {
  return siteSeo(artifact).canonical_url;
}

const LANG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

export function siteLanguageOf(artifact: SiteArtifact): string {
  const lang = isV2Artifact(artifact)
    ? artifact.language
    : artifact.site_routes?.language ?? (artifact.site_settings as { lang?: unknown }).lang;
  return typeof lang === "string" && LANG.test(lang) ? lang : "en";
}
