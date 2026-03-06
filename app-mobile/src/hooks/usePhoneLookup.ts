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

export function usePhoneLookup(phoneE164: string, enabled: boolean) {
  return useQuery<PhoneLookupResult>({
    queryKey: phoneLookupKeys.lookup(phoneE164),
    queryFn: () => lookupPhone(phoneE164),
    enabled: enabled && /^\+[1-9]\d{6,14}$/.test(phoneE164),
    staleTime: 30 * 1000,
    retry: 1,
  })
}
