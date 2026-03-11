// Ring buffer that stores the last 30 user actions with timestamps.
// Every logger domain writes into this buffer. On error, the trail is dumped to console.
// All operations are __DEV__-only — zero overhead in production builds.

// --- Types ---

export type BreadcrumbCategory =
  | 'tap'        // button/touchable presses
  | 'nav'        // screen transitions
  | 'query'      // React Query fetch lifecycle
  | 'mutation'   // React Query mutation lifecycle
  | 'auth'       // auth state changes
  | 'network'    // connectivity changes
  | 'lifecycle'  // app foreground/background
  | 'error'      // errors (also triggers dump)
  | 'action'     // custom user actions (swipe, dismiss, toggle, etc.)

export interface Breadcrumb {
  timestamp: number       // Date.now()
  category: BreadcrumbCategory
  message: string         // human-readable summary, e.g. "Tapped 'Save' on BoardCard"
  data?: Record<string, unknown>  // optional structured metadata
}

// --- Ring Buffer ---

const MAX_CRUMBS = 30
const buffer: Breadcrumb[] = []

export const breadcrumbs = {
  /** Add a breadcrumb to the ring buffer. Called by logger domains — not directly by components. */
  add(category: BreadcrumbCategory, message: string, data?: Record<string, unknown>) {
    if (!__DEV__) return
    const crumb: Breadcrumb = { timestamp: Date.now(), category, message, data }
    if (buffer.length >= MAX_CRUMBS) {
      buffer.shift()
    }
    buffer.push(crumb)
  },

  /** Dump all breadcrumbs to console. Called automatically on errors. */
  dump(triggerMessage: string) {
    if (!__DEV__) return
    if (buffer.length === 0) {
      console.log('[BREADCRUMBS] (empty — no actions recorded before error)')
      return
    }
    const lines = buffer.map((crumb, i) => {
      const time = new Date(crumb.timestamp).toISOString().slice(11, 23) // HH:mm:ss.SSS
      const elapsed = i > 0 ? `+${crumb.timestamp - buffer[i - 1].timestamp}ms` : '+0ms'
      const dataStr = crumb.data
        ? ' | ' + Object.entries(crumb.data).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
        : ''
      return `  #${String(i + 1).padStart(2, '0')} [${time}] (${elapsed.padStart(7)}) [${crumb.category.toUpperCase()}] ${crumb.message}${dataStr}`
    })
    console.log(
      `\n${'='.repeat(80)}\n` +
      `[BREADCRUMBS] Error trigger: ${triggerMessage}\n` +
      `Last ${buffer.length} actions:\n` +
      lines.join('\n') +
      `\n${'='.repeat(80)}\n`
    )
  },

  /** Get raw buffer (for testing or debug UI). */
  getAll(): readonly Breadcrumb[] {
    return [...buffer]
  },

  /** Clear buffer (for testing). */
  clear() {
    buffer.length = 0
  },
}
