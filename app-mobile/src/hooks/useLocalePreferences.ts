import { useAppStore } from '../store/appStore'

/**
 * Hook to access the user's locale preferences (currency + measurement system)
 * from the Zustand profile store. Use this in components that don't receive
 * accountPreferences as a prop.
 *
 * Returns the same shape as the accountPreferences prop used elsewhere,
 * ensuring consistency across the app.
 */
export function useLocalePreferences(): {
  currency: string
  measurementSystem: 'Metric' | 'Imperial'
} {
  const profile = useAppStore((state) => state.profile)
  return {
    currency: profile?.currency || 'USD',
    measurementSystem: profile?.measurement_system === 'metric' ? 'Metric' : 'Imperial',
  }
}
