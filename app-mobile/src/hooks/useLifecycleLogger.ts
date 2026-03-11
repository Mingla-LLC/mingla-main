import { useEffect, useRef } from 'react'
import { AppState, AppStateStatus } from 'react-native'
import { breadcrumbs } from '../utils/breadcrumbs'

// Dynamic require to match existing codebase pattern (see networkMonitor.ts).
// NetInfo is not a guaranteed dependency — gracefully degrade if missing.
let NetInfo: any = null
try {
  NetInfo = require('@react-native-community/netinfo')
} catch {
  // NetInfo not available — network logging will be silently skipped
}

/**
 * Call once in the root app component (app/index.tsx).
 * Automatically logs:
 * - App state transitions (active <-> background <-> inactive)
 * - Network connectivity changes (connected <-> disconnected, type changes)
 */
export function useLifecycleLogger() {
  // --- App State ---
  const prevAppState = useRef<AppStateStatus>(AppState.currentState)

  useEffect(() => {
    if (!__DEV__) return

    const appSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = prevAppState.current
      if (prev !== next) {
        breadcrumbs.add('lifecycle', `${prev} → ${next}`, { from: prev, to: next })
        console.log(`[LIFECYCLE] ${prev} → ${next}`)
        prevAppState.current = next
      }
    })

    return () => appSub.remove()
  }, [])

  // --- Network ---
  const prevConnected = useRef<boolean | null>(null)

  useEffect(() => {
    if (!__DEV__) return
    if (!NetInfo) return

    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = NetInfo.addEventListener((state: any) => {
        const connected: boolean = state.isConnected ?? true
        if (prevConnected.current !== null && prevConnected.current !== connected) {
          breadcrumbs.add('network', `connected=${connected}`, {
            type: state.type,
            isInternetReachable: state.isInternetReachable,
          })
          console.log(
            `[NETWORK] connected=${String(prevConnected.current)} → connected=${String(connected)} | type=${state.type}`
          )
        }
        prevConnected.current = connected
      })
    } catch {
      // NetInfo subscription failed — skip silently
    }

    return () => unsubscribe?.()
  }, [])
}
