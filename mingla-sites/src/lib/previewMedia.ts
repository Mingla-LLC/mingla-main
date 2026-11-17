import type { OfferingDetailView } from "./offeringDetail";
import type { LiveOfferings } from "./offeringCards";
import { assetQuery, type AssetCredential } from "./assetCredential";
import { loadPreviewArtifact, parsePreviewArtifactKey } from "./previewArtifact";
import { resolveHostSite } from "./publication";
import { loadSharedPreview, SHARE_TOKEN } from "./shareLinks";
import { withSharedView } from "./sharedView";
import type { SiteArtifact } from "./siteArtifact";

/*
 * #2830 — a private preview's own pictures, videos and map squares.
 *
 * The media routes answer from the host's active publication, so a draft's
 * media (all of it, on a site that has never published) was a 404. As the font
 * route already does, a preview's URLs carry its key: `?k=` is the capability,
 * re-checked on every route against the host the request arrived on by
 * `loadPreviewArtifact` (exact shape, `preview-` marker, this host's site, the
 * bytes' digest). A preview-keyed response is private: never in a shared cache.
 * Its no-referrer policy is set in proxy.ts, because next.config's site-wide
 * Referrer-Policy overrides one a route handler sets (seen on a real build).
 */
export const PREVIEW_ASSET_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
});

/*
 * One page asks for dozens of files and a video for many ranges; each would be
 * a Core call and a read of the whole artifact. The answer is held for the same
 * 30 s a public host resolution is, per host and key, so a revoked site's
 * preview stops within the window the runtime already promises. A failure is
 * never held.
 */
const HOLD_MS = 30_000;
const MAX_HELD = 32;
const held = new Map<string, { value: Promise<SiteArtifact>; expires: number }>();

/** Test hook: forget every held answer. */
export function clearPreviewAssetCache(): void {
  held.clear();
}

/** The preview artifact a `?k=` opens on this host. Throws for anything else; there is no fallback. */
export async function previewArtifactForAsset(rawKey: string, host: string, now = Date.now()): Promise<SiteArtifact> {
  const parsed = parsePreviewArtifactKey(rawKey);
  if (!parsed) throw new Error("NOT_FOUND");
  const id = `${host}|${parsed.key}`;
  const entry = held.get(id);
  if (entry && entry.expires > now) return entry.value;
  const value = resolveHostSite(host).then((site) => loadPreviewArtifact(parsed, site));
  for (const [name, row] of held) if (row.expires <= now) held.delete(name);
  if (held.size >= MAX_HELD) held.clear();
  held.set(id, { value, expires: now + HOLD_MS });
  value.catch(() => {
    if (held.get(id)?.value === value) held.delete(id);
  });
  return value;
}

/*
 * #4453 milestone 11 — a share link's own assets (`?s=<share token>`).
 *
 * The share token, never the preview key, opens them. The artifact answered is
 * the SHARE VIEW of the site's newest preview (`withSharedView`: no hidden or
 * Draft-by-Ari page, no link to one), and its media list is narrowed to the
 * files that view itself names (by URL or id), so a picture only a hidden or Draft page uses
 * is a 404 too. Core is asked again after the same 30 s hold, and the link's
 * own expiry is checked on every request, so an expired link's media die with
 * it. A token of another site, or none Core answers for, is a 404.
 */
const sharedHeld = new Map<string, { value: Promise<{ artifact: SiteArtifact; expiresAt: string | null }>; expires: number }>();

/** Test hook: forget every held share answer. */
export function clearSharedAssetCache(): void {
  sharedHeld.clear();
}

/** The share view with `media` cut to what the view's own pages, settings and blocks name. */
export function shareScopedArtifact<T extends SiteArtifact>(artifact: T): T {
  const view = withSharedView(artifact);
  const { media, ...rest } = view as T & { media?: unknown };
  if (!Array.isArray(media)) return view;
  // A block names a picture by its URL (`/media/<id>/…`) or by its id; either names the id.
  const named = JSON.stringify(rest).toLowerCase();
  const kept = media.filter((item: { id?: unknown }) => typeof item?.id === "string" && named.includes(item.id.toLowerCase()));
  return { ...view, media: kept } as T;
}

/** The share view a `?s=` opens on this host. Throws for anything else; there is no fallback. */
export async function sharedArtifactForAsset(
  rawToken: string,
  host: string,
  now = Date.now(),
  load: typeof loadSharedPreview = loadSharedPreview,
): Promise<SiteArtifact> {
  if (!SHARE_TOKEN.test(rawToken)) throw new Error("NOT_FOUND");
  const id = `${host}|${rawToken}`;
  const entry = sharedHeld.get(id);
  const value = entry && entry.expires > now
    ? entry.value
    : (() => {
      const loaded = load(host, rawToken).then(({ artifact, expiresAt }) => ({ artifact: shareScopedArtifact(artifact), expiresAt }));
      for (const [name, row] of sharedHeld) if (row.expires <= now) sharedHeld.delete(name);
      if (sharedHeld.size >= MAX_HELD) sharedHeld.clear();
      sharedHeld.set(id, { value: loaded, expires: now + HOLD_MS });
      loaded.catch(() => {
        if (sharedHeld.get(id)?.value === loaded) sharedHeld.delete(id);
      });
      return loaded;
    })();
  const { artifact, expiresAt } = await value;
  if (expiresAt !== null && !(Date.parse(expiresAt) > now)) throw new Error("NOT_FOUND");
  return artifact;
}

/** True when an asset request carries any private credential (never shared-cached). */
export function hasPrivateAssetCredential(search: URLSearchParams): boolean {
  return search.has("k") || search.has("s");
}

const MEDIA_URL = /^\/media\/[0-9a-f-]{36}\/[^/?#\s]+$/i;
const OM_URL = /\/om\/[A-Za-z0-9_-]{43}\/[a-z0-9]+/g;

function keyed(url: string, key: AssetCredential): string {
  return `${url}?${assetQuery(key)}`;
}

function keyedMedia<T>(value: T, key: AssetCredential): T {
  if (typeof value === "string") return (MEDIA_URL.test(value) ? keyed(value, key) : value) as T;
  if (Array.isArray(value)) return value.map((item) => keyedMedia(item, key)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, keyedMedia(item, key)])) as T;
  }
  return value;
}

/**
 * The artifact a preview draws: every first-party media URL in it carries the
 * key, wherever a block, a variant or a setting names one. A new object; the
 * routes keep reading the stored bytes, and only a same-origin URL is touched,
 * so the key never goes to another host.
 */
export function withPreviewMediaKey<T extends SiteArtifact>(artifact: T, key: AssetCredential): T {
  return keyedMedia(artifact, key);
}

/** The same for the offering cards a preview draws (`src` and `srcset`). */
export function withPreviewOfferingKey(live: LiveOfferings | undefined, key: AssetCredential): LiveOfferings | undefined {
  if (!live) return live;
  const stamp = (value: string) => value.replace(OM_URL, (url) => keyed(url, key));
  const cards = new Map([...live.cards].map(([id, card]) => [id, {
    ...card,
    coverUrl: card.coverUrl ? stamp(card.coverUrl) : card.coverUrl,
    coverSrcSet: card.coverSrcSet ? stamp(card.coverSrcSet) : card.coverSrcSet,
  }]));
  return { ...live, cards };
}

/**
 * #4453 milestone 9 — a detail page in a preview: its cover, its "other"
 * cards and its own photos (which already carry `?d=`) all carry the key.
 */
export function withPreviewDetailKey(detail: OfferingDetailView, key: AssetCredential): OfferingDetailView {
  const stamp = (value: string) => value.replace(OM_URL, (url) => keyed(url, key));
  const card = <C extends OfferingDetailView["card"]>(row: C): C => ({
    ...row,
    coverUrl: row.coverUrl ? stamp(row.coverUrl) : row.coverUrl,
    coverSrcSet: row.coverSrcSet ? stamp(row.coverSrcSet) : row.coverSrcSet,
  });
  return {
    ...detail,
    card: card(detail.card),
    others: detail.others.map(card),
    photos: detail.photos.map((photo) => ({ ...photo, src: `${photo.src}&${assetQuery(key)}` })),
  };
}
