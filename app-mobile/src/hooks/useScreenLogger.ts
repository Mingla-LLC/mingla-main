import { useEffect, useRef } from 'react'
import { breadcrumbs } from '../utils/breadcrumbs'

/**
 * Call at the top of every screen component.
 * Logs screen entry and returns the screen name for passing to TrackedTouchableOpacity.
 *
 * Usage:
 *   const logScreen = useScreenLogger('home')
 *   <TrackedTouchableOpacity logScreen={logScreen} ... />
 */
export function useScreenLogger(screenName: string): string {
  const prevScreen = useRef<string | null>(null)

  useEffect(() => {
    if (__DEV__) {
      const from = prevScreen.current ?? '(init)'
      breadcrumbs.add('nav', `${from} → ${screenName}`, { from, to: screenName })
      console.log(`[NAV] ${from} → ${screenName}`)
      prevScreen.current = screenName
    }
  }, [screenName])

  return screenName
}
