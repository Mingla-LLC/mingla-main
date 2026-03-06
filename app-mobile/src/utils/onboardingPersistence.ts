import AsyncStorage from '@react-native-async-storage/async-storage'
import { OnboardingData } from '../types/onboarding'

const STORAGE_KEY = 'mingla_onboarding_data'

/**
 * Save onboarding data to AsyncStorage so it survives app close.
 * Dates are serialized as ISO strings; restored with rehydrateData().
 */
export async function saveOnboardingData(data: OnboardingData): Promise<void> {
  try {
    const serializable = {
      ...data,
      userBirthday: data.userBirthday?.toISOString() ?? null,
      personBirthday: data.personBirthday?.toISOString() ?? null,
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serializable))
  } catch {
    // Non-critical — onboarding still works, just won't survive restart
  }
}

/**
 * Load onboarding data from AsyncStorage. Returns null if nothing saved.
 */
export async function loadOnboardingData(): Promise<Partial<OnboardingData> | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)

    // Rehydrate Date fields from ISO strings
    if (parsed.userBirthday && typeof parsed.userBirthday === 'string') {
      parsed.userBirthday = new Date(parsed.userBirthday)
    }
    if (parsed.personBirthday && typeof parsed.personBirthday === 'string') {
      parsed.personBirthday = new Date(parsed.personBirthday)
    }

    return parsed as Partial<OnboardingData>
  } catch {
    return null
  }
}

/**
 * Clear persisted onboarding data (call when onboarding completes).
 */
export async function clearOnboardingData(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY)
  } catch {
    // Non-critical
  }
}
