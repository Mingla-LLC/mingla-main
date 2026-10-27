import type { Metadata } from "next";
import type { ArtifactV2, MediaRef } from "../contracts/generated/artifactV2.ts";
import { isSafeHref } from "../contracts/generated/safety.ts";
import { hrefForPage, type ArtifactPage } from "./pageRouting";
import type { CollectionEntry } from "./siteCollections";
import { isV2Artifact, siteDisplayName, siteSeo, siteShortDescription, type SiteArtifact } from "./siteArtifact";

/*
 * #2829 W10 — what a page tells search engines and link previews, built only
 * from the published artifact (owner's words, the brand's facts):
 *   - title: "{page title} – {site name}"; home "{site name} – {tagline}"
 *     (the tagline is the brand's short description). An SEO title the owner
 *     typed for a page (or the site's home) is used exactly as typed.
 *   - description: the page's SEO description → the destination's summary or
 *     the story's excerpt → the site's SEO description → the brand's short
 *     description.
 *   - canonical on the site's CURRENT main address (https), Open Graph and
 *     Twitter tags with the page's own picture (the story or destination
 *     picture, else the page's first hero picture, else the site's sharing
 *     picture, else the logo), served from the site's own media route.
 */
export const TITLE_SEPARATOR = " – ";
const DESCRIPTION_MAX = 300;

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length ? trimmed : undefined;
}

/** At most 300 characters, cut at a word boundary (never mid-word). */
export function shortDescription(value: string | undefined): string | undefined {
  if (!value || value.length <= DESCRIPTION_MAX) return value;
  const cut = value.slice(0, DESCRIPTION_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 200 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

export function pageTitle(artifact: SiteArtifact, page: ArtifactPage): string {
  const site = siteDisplayName(artifact);
  if (page.isHome) {
    const typed = clean(siteSeo(artifact).title);
    if (typed) return typed;
    const tagline = clean(siteShortDescription(artifact));
    return tagline ? `${site}${TITLE_SEPARATOR}${tagline}` : site;
  }
  const typed = clean(page.seo?.title);
  if (typed) return typed;
  return `${clean(page.title) ?? site}${TITLE_SEPARATOR}${site}`;
}

export function pageDescription(
  artifact: SiteArtifact,
  page: ArtifactPage,
  entry?: CollectionEntry,
): string | undefined {
  const entryText = entry
    ? entry.collection === "destinations"
      ? clean(entry.entry.summary) ?? clean(entry.entry.tagline)
      : clean(entry.entry.excerpt)
    : undefined;
  return shortDescription(
    clean(page.seo?.description) ?? entryText ?? clean(siteSeo(artifact).description) ??
      clean(siteShortDescription(artifact)),
  );
}

export type SocialImage = { url: string; width: number; height: number; alt: string };

function absolute(url: string, origin: string): string | null {
  if (!isSafeHref(url)) return null;
  try {
    const resolved = new URL(url, `${origin}/`);
    return resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.toString() : null;
  } catch {
    return null;
  }
}

function fromMedia(media: MediaRef | undefined, origin: string): SocialImage | undefined {
  if (!media) return undefined;
  const url = absolute(media.url, origin);
  return url ? { url, width: media.width, height: media.height, alt: media.alt ?? "" } : undefined;
}

/** The first hero picture on a page, as the artifact's media record. */
function heroMedia(artifact: ArtifactV2, page: ArtifactPage): MediaRef | undefined {
  for (const block of page.blocks as unknown as Array<{ type?: string; media_url?: unknown }>) {
    if ((block.type === "hero" || block.type === "page_header") && typeof block.media_url === "string") {
      const media = artifact.media.find((row) => row.url === block.media_url);
      if (media) return media;
    }
  }
  return undefined;
}

export function socialImage(
  artifact: SiteArtifact,
  page: ArtifactPage,
  origin: string,
  entry?: CollectionEntry,
): SocialImage | undefined {
  const seoImage = siteSeo(artifact).social_image;
  if (!isV2Artifact(artifact)) {
    return seoImage ? fromMedia({ ...seoImage, id: "", integrity: "", object_key: "" }, origin) : undefined;
  }
  return fromMedia(entry?.entry.featured_image, origin) ??
    fromMedia(heroMedia(artifact, page), origin) ??
    fromMedia(artifact.seo.social_image, origin) ??
    fromMedia(artifact.brand.logo, origin);
}

/** The page's canonical URL on the site's current main address ("/" for home). */
export function canonicalUrl(page: ArtifactPage, origin: string): string {
  return new URL(hrefForPage(page), `${origin}/`).toString();
}

export function buildPageMetadata(input: {
  artifact: SiteArtifact;
  page: ArtifactPage;
  entry?: CollectionEntry;
  /** `https://<current main address>` */
  origin: string;
  noindex: boolean;
}): Metadata {
  const { artifact, page, entry, origin, noindex } = input;
  const title = pageTitle(artifact, page);
  const description = pageDescription(artifact, page, entry);
  const canonical = canonicalUrl(page, origin);
  const image = socialImage(artifact, page, origin, entry);
  const images = image ? [{ url: image.url, width: image.width, height: image.height, alt: image.alt }] : [];
  const article = entry?.collection === "stories";
  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    openGraph: {
      type: article ? "article" : "website",
      siteName: siteDisplayName(artifact),
      title,
      ...(description ? { description } : {}),
      url: canonical,
      images,
      ...(article && entry?.collection === "stories" ? { publishedTime: entry.entry.published_at } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      ...(description ? { description } : {}),
      ...(image ? { images: [{ url: image.url, alt: image.alt }] } : {}),
    },
    robots: noindex ? { index: false, follow: true } : { index: true, follow: true },
  };
}
