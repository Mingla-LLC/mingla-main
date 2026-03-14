import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';

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
  // 12-second hard cap. Aligned with mobile industry standard (10-15s).
  // Previously 30s — caused 15s useUserPreferences wrapper to fire prematurely,
  // and stacked to 60s+ worst-case via retries. At 12s with retry:1, worst case
  // is 25s (12s + 1s delay + 12s) which is acceptable for mobile.
  const TIMEOUT_MS = 12000;
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
  }).then(
    (response) => {
      clearTimeout(timeoutId);
      return response;
    },
    (error) => {
      // Clear timeout on fetch rejection too (offline, DNS failure, abort).
      // Without this, the 12s timer leaks until it fires and rejects into the void.
      clearTimeout(timeoutId);
      throw error;
    },
  );

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

/**
 * Drop-in replacement for supabase.functions.invoke() that logs the full
 * request and response to Metro terminal in dev.
 */
export async function trackedInvoke<T = any>(
  functionName: string,
  options?: { body?: unknown; headers?: Record<string, string> }
): Promise<{ data: T | null; error: any }> {
  if (__DEV__) {
    logger.edge(`\u2192 ${functionName}`, { body: options?.body ?? '(none)' });
  }
  const start = Date.now();
  const result = await supabase.functions.invoke<T>(functionName, options as any);
  if (__DEV__) {
    const duration = Date.now() - start;
    if (result.error) {
      logger.edge(`\u2190 ${functionName} ERROR ${duration}ms`, {
        error: result.error?.message ?? String(result.error),
      });
    } else {
      logger.edge(`\u2190 ${functionName} OK ${duration}ms`, {
        data: JSON.stringify(result.data)?.slice(0, 500) ?? '(null)',
      });
    }
  }
  return result;
}
