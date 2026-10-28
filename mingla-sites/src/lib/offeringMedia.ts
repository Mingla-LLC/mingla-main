import { timingSafeEqual } from "node:crypto";
import type { SiteOffering } from "../contracts/generated/offerings.ts";
import type { OfferingCoverMedia } from "../contracts/generated/artifactV2.ts";
import { hmacBase64 } from "./crypto";
import { runtimeConfig } from "./config";

/*
 * #2829 AD-6 — offering pictures (Mingla trip / event / experience covers) on
 * a site are served through `/om/<token>/<variant>`.
 *
 * The URL carries NO path: the token is HMAC-SHA256(media key, site_id|path),
 * so the route can only serve a cover that this site's own feed names, and a
 * token minted for one brand's site means nothing on another's host. The
 * route is therefore not an open proxy onto Mingla's storage.
 *
 * The media key is derived from the runtime's existing signing key (a
 * separate HMAC label), so no new secret has to be provisioned.
 */
export const OM_VARIANTS = ["original", "thumb", "c400", "c768", "w1600"] as const;
export type OmVariant = (typeof OM_VARIANTS)[number];
/** #2829 W7c — the renditions the CMS made at publish (served from Sites storage, not Mingla's). */
export const OM_RENDITIONS = ["c400", "c768", "w1600"] as const;
export type OmRendition = (typeof OM_RENDITIONS)[number];
export function isOmRendition(variant: string): variant is OmRendition {
  return (OM_RENDITIONS as readonly string[]).includes(variant);
}
export const OM_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MEDIA_KEY_LABEL = "mingla-sites/om/v1";

let derivedKey: { source: string; key: string } | undefined;

async function mediaKey(): Promise<string> {
  const source = runtimeConfig().runtimeHmac;
  if (derivedKey?.source === source) return derivedKey.key;
  const key = await hmacBase64(source, MEDIA_KEY_LABEL);
  derivedKey = { source, key };
  return key;
}

function base64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The token for one cover path on one site. */
export async function offeringMediaToken(siteId: string, path: string): Promise<string> {
  return base64Url(await hmacBase64(await mediaKey(), `${siteId}|${path}`));
}

/** The site-relative URL a card uses for an offering's cover, or null. */
export async function offeringCoverUrl(siteId: string, offering: Pick<SiteOffering, "cover">, variant: OmVariant = "original"): Promise<string | null> {
  if (!offering.cover) return null;
  return `/om/${await offeringMediaToken(siteId, offering.cover.path)}/${variant}`;
}

/**
 * #2829 W7c (A13.1) — a card's picture: with the cover's publish-time
 * renditions, the 768 crop as `src` and a `srcset` of the 400 and 768 crops
 * and the 1600-wide picture (plus the stored cover at its own width when it
 * is larger, as the brand's own pipeline does); without them (a cover new
 * since the last publish) the stored cover alone, until the next publish.
 */
export async function offeringCoverSources(
  siteId: string,
  offering: Pick<SiteOffering, "cover">,
  offeringMedia: readonly OfferingCoverMedia[] | undefined,
): Promise<{ src: string; srcSet: string | null } | null> {
  if (!offering.cover) return null;
  const base = `/om/${await offeringMediaToken(siteId, offering.cover.path)}`;
  const entry = offeringMedia?.find((row) => row.path === offering.cover!.path);
  if (!entry) return { src: `${base}/original`, srcSet: null };
  const seen = new Set<number>();
  const candidates: string[] = [];
  for (const name of OM_RENDITIONS) {
    const variant = entry.variants.find((row) => row.name === name);
    if (!variant || seen.has(variant.width)) continue;
    seen.add(variant.width);
    candidates.push(`${base}/${name} ${variant.width}w`);
  }
  if (!seen.has(entry.source_width) && entry.source_width > Math.max(0, ...seen)) {
    candidates.push(`${base}/original ${entry.source_width}w`);
  }
  const src = entry.variants.some((row) => row.name === "c768") ? `${base}/c768` : `${base}/original`;
  return { src, srcSet: candidates.length > 1 ? candidates.join(", ") : null };
}

/**
 * Which of this site's cover paths a token stands for, or null. Compared in
 * constant time; only paths in the site's own feed are candidates.
 */
export async function pathForToken(siteId: string, token: string, offerings: readonly Pick<SiteOffering, "cover">[]): Promise<string | null> {
  if (!OM_TOKEN_RE.test(token)) return null;
  const wanted = Buffer.from(token);
  for (const offering of offerings) {
    if (!offering.cover) continue;
    const candidate = Buffer.from(await offeringMediaToken(siteId, offering.cover.path));
    if (candidate.length === wanted.length && timingSafeEqual(candidate, wanted)) return offering.cover.path;
  }
  return null;
}

/** `event_covers/a/b.jpg` + thumb → `event_covers/a/b_thumb.jpg` (the stored thumbnail). */
export function variantPath(path: string, variant: "original" | "thumb"): string {
  if (variant === "original") return path;
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return dot > slash ? `${path.slice(0, dot)}_thumb${path.slice(dot)}` : `${path}_thumb`;
}
