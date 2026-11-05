import type { LiveOfferings } from "./offeringCards";
import { loadPreviewArtifact, parsePreviewArtifactKey } from "./previewArtifact";
import { resolveHostSite } from "./publication";
import type { SiteArtifact } from "./siteArtifact";

/*
 * #2830 — a private preview's own pictures, videos and map squares.
 *
 * The media routes answer from the host's active publication, so a draft's
 * media (all of it, on a site that has never published) was a 404. As the font
 * route already does, a preview's URLs carry its key: `?k=` is the capability,
 * re-checked on every route against the host the request arrived on by
 * `loadPreviewArtifact` (exact shape, `preview-` marker, this host's site, the
 * bytes' digest). A preview-keyed response is private: never in a shared cache,
 * and it sends no referrer.
 */
export const PREVIEW_ASSET_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
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

const MEDIA_URL = /^\/media\/[0-9a-f-]{36}\/[^/?#\s]+$/i;
const OM_URL = /\/om\/[A-Za-z0-9_-]{43}\/[a-z0-9]+/g;

function keyed(url: string, key: string): string {
  return `${url}?k=${encodeURIComponent(key)}`;
}

function keyedMedia<T>(value: T, key: string): T {
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
export function withPreviewMediaKey<T extends SiteArtifact>(artifact: T, key: string): T {
  return keyedMedia(artifact, key);
}

/** The same for the offering cards a preview draws (`src` and `srcset`). */
export function withPreviewOfferingKey(live: LiveOfferings | undefined, key: string): LiveOfferings | undefined {
  if (!live) return live;
  const stamp = (value: string) => value.replace(OM_URL, (url) => keyed(url, key));
  const cards = new Map([...live.cards].map(([id, card]) => [id, {
    ...card,
    coverUrl: card.coverUrl ? stamp(card.coverUrl) : card.coverUrl,
    coverSrcSet: card.coverSrcSet ? stamp(card.coverSrcSet) : card.coverSrcSet,
  }]));
  return { ...live, cards };
}
