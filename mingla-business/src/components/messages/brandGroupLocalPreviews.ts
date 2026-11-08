/**
 * #4304 — media speed (B, D). What the sender's own phone already has for a
 * file it is sending: the local photo uri, and for a video a first-frame
 * poster made on the device. The pending bubble draws from it while the file
 * uploads, and MediaThumb keeps drawing it under the server thumbnail after
 * the real message arrives, so the swap never flashes an empty placeholder
 * and a just-sent video is never a blank "preparing" tile.
 *
 * Only this phone's own uploads are registered; other people's media keeps
 * the server thumbnail and its pending fallback. In memory only, and cleared
 * on sign-out. Pure: no expo import.
 */
import { useSyncExternalStore } from "react";

import { registerSignOutCleanup } from "../../utils/signOutCleanups";

export interface BrandGroupLocalPreview {
  kind: "image" | "video" | "file";
  /** The local file uri (photo) — or the video file, for reference only. */
  uri: string;
  /** Native only: a decoded first-frame poster for a video (expo-video thumbnail). */
  poster: object | null;
}

const previews = new Map<string, BrandGroupLocalPreview>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setBrandGroupLocalPreview(fileId: string, preview: BrandGroupLocalPreview): void {
  previews.set(fileId, preview);
  emit();
}

export function setBrandGroupLocalPoster(fileId: string, poster: object): void {
  const existing = previews.get(fileId);
  if (!existing) return;
  previews.set(fileId, { ...existing, poster });
  emit();
}

export function getBrandGroupLocalPreview(fileId: string | null | undefined): BrandGroupLocalPreview | null {
  return fileId ? previews.get(fileId) ?? null : null;
}

export function clearBrandGroupLocalPreviews(): void {
  if (previews.size === 0) return;
  previews.clear();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBrandGroupLocalPreview(fileId: string | null | undefined): BrandGroupLocalPreview | null {
  return useSyncExternalStore(subscribe, () => getBrandGroupLocalPreview(fileId), () => null);
}

registerSignOutCleanup(clearBrandGroupLocalPreviews);
