import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { lookupPhone, PhoneLookupResult } from '../services/phoneLookupService'

export const phoneLookupKeys = {
  all: ['phone-lookup'] as const,
  lookup: (phone: string) => [...phoneLookupKeys.all, phone] as const,
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

// Minimum E.164 length for a viable lookup (e.g. +1XXXXXXXXXX = 12 chars, +44XXXXXXXXXX = 13)
// We use 10 total chars after + to cover most countries while filtering out clearly-partial numbers
const MIN_E164_DIGITS = 10

function isViablePhoneNumber(phone: string): boolean {
  // Must be valid E.164 shape AND long enough to be a real number
  return /^\+[1-9]\d{6,14}$/.test(phone) && phone.length >= MIN_E164_DIGITS + 1
}

const PHONE_LOOKUP_TIMEOUT_MS = 10_000

export function usePhoneLookup(phoneE164: string, enabled: boolean) {
  const viable = isViablePhoneNumber(phoneE164)

  return useQuery<PhoneLookupResult>({
    queryKey: phoneLookupKeys.lookup(phoneE164),
    queryFn: ({ signal }) => {
      // Layer a timeout on top of React Query's built-in signal so the request
      // never hangs indefinitely (edge-function cold starts can exceed 15s).
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), PHONE_LOOKUP_TIMEOUT_MS)

      // Forward React Query's cancellation signal too
      if (signal) {
        signal.addEventListener('abort', () => controller.abort())
      }

      return lookupPhone(phoneE164, controller.signal).finally(() =>
        clearTimeout(timeoutId)
      )
    },
    enabled: enabled && viable,
    staleTime: 30 * 1000,
    retry: false,
    // Don't persist phone lookup queries — they're ephemeral, keystroke-driven lookups.
    // Persisting them causes "dehydrated as pending" cascading errors on app restart.
    gcTime: 0,
    meta: { persist: false },
  })
}
