import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const supabaseUrl = 'https://gqnoajqerqhnvulmnyvv.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxbm9hanFlcnFobnZ1bG1ueXZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1MDUyNzIsImV4cCI6MjA3MzA4MTI3Mn0.p4yi9yD2RWfJ2HN4DD-dgrvXnyzhJi3g2YCouSK-hbo';

/**
 * Fetch wrapper with 30-second hard timeout via Promise.race.
 *
 * AbortController.abort() is unreliable on React Native Android (Hermes).
 * Promise.race guarantees the timeout fires even if abort() silently fails.
 * Both mechanisms are kept: AbortController for actual socket cleanup when it
 * works, Promise.race as the reliable rejection path.
 */
const createAbortError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

const fetchWithTimeout = (url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
  const TIMEOUT_MS = 30000;
  const controller = new AbortController();

  // If the caller already provided a signal, respect it
  const existingSignal = options?.signal;
  if (existingSignal?.aborted) {
    return Promise.reject(createAbortError('Aborted'));
  }

  let timeoutId: ReturnType<typeof setTimeout>;

  const fetchPromise = fetch(url, {
    ...options,
    signal: controller.signal,
  }).then((response) => {
    clearTimeout(timeoutId);
    return response;
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(createAbortError('Network request timed out'));
    }, TIMEOUT_MS);
  });

  return Promise.race([fetchPromise, timeoutPromise]);
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    debug: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  global: {
    fetch: fetchWithTimeout,
  },
});
