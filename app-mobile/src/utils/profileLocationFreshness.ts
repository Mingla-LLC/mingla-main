/**
 * Issue #1638 — staleness gate for the Profile tab's location refresh.
 *
 * BEFORE: `ProfilePage.tsx` ran `useEffect(() => { updateLocation(); }, [])` with no cache
 * check and no staleness guard. Because Wave 2.8 Path B (`I-ONLY-ACTIVE-TAB-MOUNTED`) fully
 * unmounts a tab on every switch away, `[]` meant EVERY SINGLE TAP on the Profile tab paid
 * for: a foreground-permission request → a real `Location.getCurrentPositionAsync({})` fused
 * fix (1-5s on mid-range Android) → a reverse geocode → an AsyncStorage write → a Supabase
 * `profiles` UPDATE. A GPS fix and a database write, on a tab tap.
 *
 * WHY A NEW TIMESTAMP KEY RATHER THAN REUSING AN EXISTING CACHE.
 * Two location caches already exist and BOTH were rejected as the freshness clock:
 *   - `useUserLocation.ts` maintains `@mingla/lastLocation` = `{ lat, lng, ts }` plus a
 *     module-level `cachedLocationSync`. It holds COORDINATES and is written by a DIFFERENT
 *     producer (the deck's location query, which resolves on Home/Discover). Its `ts` can be
 *     minutes old while the Profile's human-readable place STRING is hours old — a user who
 *     travels to Paris, opens Home (coords + `ts` refresh to Paris) and then opens Profile
 *     would be told they are still in London, forever. Coupling to it is a correctness bug.
 *   - `mingla_user_location` is ProfilePage's own cache (read/written NOWHERE else — verified
 *     by grep across `app/` and `src/`) but stores a bare string with no timestamp.
 * So this module adds a TIMESTAMP SIDECAR for the existing string — not a third location
 * cache. The string key and its shape are unchanged, so installs that predate #1638 keep
 * working: they have no `_ts`, which reads as "absent" → NOT fresh → refresh once, then the
 * value is stamped.
 *
 * WRITE ORDER MATTERS: the place string is written FIRST and the timestamp SECOND. A process
 * kill between the two writes leaves an OLD timestamp against a NEW string, so the next mount
 * refreshes. Every failure mode of this gate falls toward "refresh", never toward "show a
 * stale city forever".
 */

/** ProfilePage's existing human-readable place cache. Shape unchanged (bare string). */
export const PROFILE_LOCATION_PLACE_KEY = 'mingla_user_location';

/** Epoch-ms stamp for {@link PROFILE_LOCATION_PLACE_KEY}. Written AFTER the place string. */
export const PROFILE_LOCATION_TS_KEY = 'mingla_user_location_ts';

/**
 * How long a cached Profile place string is considered fresh: **30 minutes**.
 *
 * Justification:
 *   - The value is a COARSE label — `city, region, country`. It only changes when the user
 *     physically travels between cities, which does not happen twice in half an hour.
 *   - It is display copy plus a `profiles.location` column. It is not proximity-critical, so
 *     it is deliberately LONGER than `useUserLocation`'s 5-minute GPS `staleTime`, which
 *     feeds the deck and genuinely must track the user's neighbourhood.
 *   - It bounds the worst case honestly: a user who taps Profile twenty times in a session
 *     pays for at most one GPS fix + geocode + Supabase UPDATE per 30 minutes instead of
 *     twenty, and a genuine city change still lands within 30 minutes of app use.
 *   - The user always has an immediate override: the location row on the Profile hero has a
 *     tap-to-refresh control (`ProfileHeroSection` → `onLocationRefresh`) wired straight to
 *     the unconditional `updateLocation`, so freshness is never more than one tap away.
 */
export const PROFILE_LOCATION_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Should the Profile skip the expensive GPS + geocode + Supabase-UPDATE chain?
 *
 * `true` ⇒ a usable place string is cached AND its stamp is inside the freshness window.
 * `false` ⇒ refresh (the ONLY safe default — every ambiguous input returns `false`).
 *
 * @param place      the cached place string, as read from `PROFILE_LOCATION_PLACE_KEY`
 * @param cachedAtMs the cached epoch-ms stamp, as read from `PROFILE_LOCATION_TS_KEY`
 * @param nowMs      the current epoch ms (injected so this is a pure, testable function)
 */
export function isProfileLocationFresh(
  place: string | null | undefined,
  cachedAtMs: number | null | undefined,
  nowMs: number,
): boolean {
  // No usable label — an empty or whitespace-only string is ABSENT, not a value.
  // (Guards the sentinel-poisoning class: `''` was previously written verbatim by
  // `AsyncStorage.setItem(key, placeString || '')` whenever the geocode produced nothing.)
  if (typeof place !== 'string' || place.trim().length === 0) return false;

  // No usable stamp. Rejects null/undefined, NaN (what `Number(null_string)` yields on a
  // pre-#1638 install), Infinity, and non-positive epochs.
  if (typeof cachedAtMs !== 'number' || !Number.isFinite(cachedAtMs) || cachedAtMs <= 0) {
    return false;
  }

  // Likewise reject an unusable clock rather than trusting arithmetic on it.
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return false;

  const ageMs = nowMs - cachedAtMs;

  // A stamp in the FUTURE means a clock change, a timezone/DST roll, or a corrupt write.
  // Fail toward refresh — never let a bad stamp pin a stale city in place indefinitely.
  if (ageMs < 0) return false;

  return ageMs <= PROFILE_LOCATION_MAX_AGE_MS;
}

/**
 * Parse the raw AsyncStorage string for {@link PROFILE_LOCATION_TS_KEY} into an epoch ms.
 * Anything unparseable becomes `0`, which {@link isProfileLocationFresh} treats as absent.
 */
export function parseProfileLocationTimestamp(raw: string | null | undefined): number {
  if (typeof raw !== 'string' || raw.trim().length === 0) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
