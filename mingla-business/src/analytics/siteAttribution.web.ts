const STORAGE_KEY = "mingla_site_attribution_v1";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_AGE_MS = 30 * 60_000;

function storedToken(raw: string | null, now: number): string | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as {
      token?: unknown;
      capturedAt?: unknown;
    };
    const age = now - Number(value.capturedAt);
    return typeof value.token === "string" &&
        TOKEN.test(value.token) &&
        typeof value.capturedAt === "number" &&
        age >= 0 &&
        age <= MAX_AGE_MS
      ? value.token
      : null;
  } catch {
    return null;
  }
}

/**
 * #2830 — first-touch browser attribution for a single tab. A still-valid
 * stored source always wins over later URLs. Storage is optional: blocked or
 * unavailable sessionStorage can never block checkout.
 */
export function getStoredSiteAttribution(): string | null {
  if (typeof window === "undefined") return null;
  const now = Date.now();
  let storageAvailable = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const firstTouch = storedToken(raw, now);
    if (firstTouch !== null) return firstTouch;
    if (raw !== null) window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    storageAvailable = false;
  }

  let fromUrl: string | null;
  try {
    fromUrl = new URL(window.location.href).searchParams.get(
      "site_attribution",
    );
  } catch {
    return null;
  }
  if (fromUrl === null || !TOKEN.test(fromUrl)) return null;
  if (storageAvailable) {
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ token: fromUrl, capturedAt: now }),
      );
    } catch {
      // Attribution is optional; return the valid handoff for this checkout.
    }
  }
  return fromUrl;
}

/** Optional checkout enrichment; missing/throwing bindings never block money. */
export async function siteAttributionPayload(
  read: (() => string | null) | null = getStoredSiteAttribution,
): Promise<{ site_attribution_token?: string }> {
  try {
    const token = read?.() ?? null;
    return token === null ? {} : { site_attribution_token: token };
  } catch {
    return {};
  }
}

export default siteAttributionPayload;
