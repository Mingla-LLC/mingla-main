/**
 * #4238 D4 — one Host ads setup read per brand for a short while.
 *
 * host_setup is not free: it lists every page and asks each ad app whether
 * it is ready for sales. Remounts, step changes and a resumed plan must reuse
 * the same answer instead of asking again. Concurrent callers share one
 * request; a failed request is never cached; `force` refreshes (after the
 * Host adds a video, cancels a plan or taps Retry).
 */

export const HOST_AD_SETUP_TTL_MS = 30_000;

type Entry<T> = { at: number; promise: Promise<T> };

const entries = new Map<string, Entry<unknown>>();

export function cachedHostAdSetup<T>(
  brandId: string,
  loader: (brandId: string) => Promise<T>,
  options: { force?: boolean; now?: number; ttlMs?: number } = {},
): Promise<T> {
  const now = options.now ?? Date.now();
  const ttl = options.ttlMs ?? HOST_AD_SETUP_TTL_MS;
  const hit = entries.get(brandId) as Entry<T> | undefined;
  if (!options.force && hit && now - hit.at < ttl) return hit.promise;
  const promise = loader(brandId);
  const entry: Entry<T> = { at: now, promise };
  entries.set(brandId, entry);
  promise.catch(() => {
    if (entries.get(brandId) === entry) entries.delete(brandId);
  });
  return promise;
}

export function clearHostAdSetupCache(): void {
  entries.clear();
}
