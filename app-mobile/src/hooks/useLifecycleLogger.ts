import { useEffect, useRef } from 'react'
import { AppState, Keyboard, Platform } from 'react-native'
import type { AppStateStatus, KeyboardEvent } from 'react-native'
import { logger } from '../utils/logger'

// Dynamic require to match existing codebase pattern (see networkMonitor.ts).
// NetInfo is not a guaranteed dependency — gracefully degrade if missing.
let NetInfo: any = null
try {
  NetInfo = require('@react-native-community/netinfo')
} catch {
  // NetInfo not available — network logging will be silently skipped
}

/**
 * Logs all app lifecycle events to Metro terminal.
 * Call once at the app root level (e.g., inside AppStateManager or app/index.tsx).
 *
 * Tracks:
 * - App state transitions (active <-> background <-> inactive)
 * - Keyboard show/hide with height
 * - Memory warnings (iOS only)
 * - Network connectivity changes (if @react-native-community/netinfo is available)
 */
export function useLifecycleLogger(): void {
  // --- App State ---
  const prevAppState = useRef<AppStateStatus>(AppState.currentState)

  useEffect(() => {
    if (!__DEV__) return

    const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      logger.lifecycle(`appState: ${prevAppState.current} \u2192 ${nextState}`)
      prevAppState.current = nextState
    })

    // --- Keyboard events ---
    const keyboardShowEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const keyboardHideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const kbShowSub = Keyboard.addListener(keyboardShowEvent, (e: KeyboardEvent) => {
      logger.lifecycle('keyboard: show', { height: e.endCoordinates.height })
    })
    const kbHideSub = Keyboard.addListener(keyboardHideEvent, () => {
      logger.lifecycle('keyboard: hide')
    })

    // --- Memory warning (iOS only) ---
    const memorySub = Platform.OS === 'ios'
      ? AppState.addEventListener('memoryWarning', () => {
          logger.lifecycle('\u26a0 MEMORY WARNING')
        })
      : null

    logger.lifecycle('useLifecycleLogger mounted \u2014 tracking appState, keyboard, memory')

    return () => {
      appStateSub.remove()
      kbShowSub.remove()
      kbHideSub.remove()
      memorySub?.remove()
    }
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
          logger.network(`connected=${String(prevConnected.current)} \u2192 connected=${String(connected)}`, {
            type: state.type,
            isInternetReachable: state.isInternetReachable,
          })
        }
        prevConnected.current = connected
      })
    } catch {
      // NetInfo subscription failed — skip silently
    }

    return () => unsubscribe?.()
  }, [])
}
