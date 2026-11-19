/**
 * #4226 phase 2B — PostHog app tag and screen views (Host app).
 *
 * Pure helpers with no imports so they can be tested on their own:
 *   - the `app: 'host'` super property, so every event says which app sent it
 *   - stable screen names from expo-router segments (never ids, slugs, tokens
 *     or any personal data: dynamic segments keep their `[placeholder]` name)
 *   - a tracker that sends one screen view per change and honours opt-out
 */

export const APP_SUPER_PROPERTY = { app: "host" } as const;

type RegisterLike = { register: (props: Record<string, string>) => unknown };

/**
 * Register `app: 'host'` on every later event. Never throws; a rejected
 * promise from the client is swallowed (analytics never breaks the UI).
 */
export function registerAppSuperProperty(client: RegisterLike | null): boolean {
  if (client === null) return false;
  try {
    const pending = client.register({ ...APP_SUPER_PROPERTY });
    if (pending != null && typeof (pending as { catch?: unknown }).catch === "function") {
      void (pending as Promise<unknown>).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

const SAFE_NAME = /^[a-z0-9_]+$/;

/** `[brandId]` -> `brand_id`; route groups like `(tabs)` carry no screen meaning. */
function cleanSegment(segment: string): string | null {
  if (/^\(.*\)$/.test(segment)) return null;
  const bare = segment.replace(/^\[+\.{0,3}|\]+$/g, "");
  const snake = bare
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return snake.length > 0 && SAFE_NAME.test(snake) ? snake : null;
}

/** Screen name for an expo-router route, from `useSegments()` (placeholders, never real ids). */
export function screenNameForRoute(segments: readonly string[]): string | null {
  const parts = segments.map(cleanSegment).filter((p): p is string => p !== null);
  return parts.length === 0 ? null : `route_${parts.join("_")}`;
}

type ScreenClient = { screen: (name: string) => unknown };

/**
 * One `$screen` per change: the same name twice in a row is sent once.
 * `isOptedOut` is read on every call, so turning analytics off stops it at once.
 */
export function createScreenTracker(deps: {
  getClient: () => ScreenClient | null;
  isOptedOut: () => boolean;
}): { track: (name: string | null) => boolean; reset: () => void } {
  let last: string | null = null;
  return {
    track(name) {
      if (!name || !SAFE_NAME.test(name)) return false;
      if (name === last) return false;
      try {
        if (deps.isOptedOut()) return false;
        const client = deps.getClient();
        if (client === null) return false;
        const pending = client.screen(name);
        if (pending != null && typeof (pending as { catch?: unknown }).catch === "function") {
          void (pending as Promise<unknown>).catch(() => {});
        }
        last = name;
        return true;
      } catch {
        return false;
      }
    },
    reset() {
      last = null;
    },
  };
}
