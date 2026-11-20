/**
 * #4226 phase 2B — PostHog app tag and screen views (Explorer app).
 *
 * Pure helpers with no imports so they can be tested on their own:
 *   - the `app: 'explorer'` super property, so every event says which app sent it
 *   - stable screen names from expo-router segments and the in-app page state
 *     (never ids, slugs, codes or any personal data)
 *   - a tracker that sends one screen view per change and honours opt-out
 */

export const APP_SUPER_PROPERTY = { app: 'explorer' } as const

type RegisterLike = { register: (props: Record<string, string>) => unknown }

/**
 * Register `app: 'explorer'` on every later event. Never throws; a rejected
 * promise from the client is swallowed (analytics never breaks the UI).
 */
export function registerAppSuperProperty(client: RegisterLike | null): boolean {
  if (client === null) return false
  try {
    const pending = client.register({ ...APP_SUPER_PROPERTY })
    if (pending != null && typeof (pending as { catch?: unknown }).catch === 'function') {
      void (pending as Promise<unknown>).catch(() => {})
    }
    return true
  } catch {
    return false
  }
}

const SAFE_NAME = /^[a-z0-9_]+$/

/** `[brandSlug]` -> `brandSlug` so a dynamic route keeps one stable name. */
function cleanSegment(segment: string): string | null {
  const bare = segment.replace(/^\[+\.{0,3}|\]+$/g, '')
  const snake = bare
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  if (snake.length === 0) return null
  // route groups like (tabs) carry no screen meaning
  if (/^\(.*\)$/.test(segment)) return null
  return SAFE_NAME.test(snake) ? snake : null
}

/**
 * Screen name for an expo-router route. Segments come from `useSegments()`, so
 * dynamic parts are the placeholder (`[slug]`), never the real id. The root
 * `index` route hosts the in-app pages and is named by `screenNameForPage`.
 */
export function screenNameForRoute(segments: readonly string[]): string | null {
  const parts = segments.map(cleanSegment).filter((p): p is string => p !== null)
  if (parts.length === 0) return null
  if (parts.length === 1 && parts[0] === 'index') return null
  return `route_${parts.join('_')}`
}

export type AppScreenState = {
  isLoadingAuth: boolean
  isAuthenticated: boolean
  inOnboarding: boolean
  showPreferences: boolean
  currentPage: string
}

/** Screen name for the in-app shell (app/index.tsx), from the same state the nav logger reads. */
export function screenNameForApp(state: AppScreenState): string | null {
  if (state.isLoadingAuth) return null
  if (!state.isAuthenticated) return 'welcome'
  if (state.inOnboarding) return 'onboarding'
  if (state.showPreferences) return 'preferences'
  const page = cleanSegment(state.currentPage)
  return page ? `page_${page}` : null
}

type ScreenClient = { screen: (name: string) => unknown }

/**
 * One `$screen` per change: the same name twice in a row is sent once.
 * `isOptedOut` is read on every call, so turning analytics off stops it at once.
 */
export function createScreenTracker(deps: {
  getClient: () => ScreenClient | null
  isOptedOut: () => boolean
}): { track: (name: string | null) => boolean; reset: () => void } {
  let last: string | null = null
  return {
    track(name) {
      if (!name || !SAFE_NAME.test(name)) return false
      if (name === last) return false
      try {
        if (deps.isOptedOut()) return false
        const client = deps.getClient()
        if (client === null) return false
        const pending = client.screen(name)
        if (pending != null && typeof (pending as { catch?: unknown }).catch === 'function') {
          void (pending as Promise<unknown>).catch(() => {})
        }
        last = name
        return true
      } catch {
        return false
      }
    },
    reset() {
      last = null
    },
  }
}
