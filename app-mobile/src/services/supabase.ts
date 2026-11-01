import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';
import { getNativeAppVersionHeaders } from './appVersionIdentity';
import { buildExplorerProfileAuthRestRequest } from '../utils/explorerProfileAuthRest';
import {
  reactivateExplorerProfileForExplicitSession,
  type DeletedExplorerProfile,
  type ExplorerProfileResolution,
} from '../utils/explorerReactivation';
import { trackNetworkRequest } from './reloadNetworkFence';
// #1594 [consumer-map-url] — the project URL now comes from the ONE owner that
// `app.config.js` can also read (`src/config/supabaseProject.js`), so the value
// this client uses and the value emitted into `Constants.expoConfig.extra` can
// never drift apart. This is a DIRECT import, not a config read: if the owner
// ever went missing the bundle fails loudly at build time rather than leaving
// the client silently unconfigured at runtime. Behaviour here is unchanged —
// same string, same client.
import { SUPABASE_URL } from '../config/supabaseProject';

export const supabaseUrl = SUPABASE_URL;
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

const fetchWithTimeoutUntracked = (url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
  // 20-second hard cap. Raised from 12s after ORCH-0366: discover-cards + curated
  // functions routinely take 11-13s due to complex pool queries + Deno cold starts.
  // At 12s, success depended on sub-second variance — a race condition, not a safety net.
  // With retry:1, worst case is 41s (20s + 1s + 20s), acceptable for initial load.
  const TIMEOUT_MS = 20000;
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

/**
 * #2107 (Sentry REACT-NATIVE-1C): every Supabase request is counted while it is
 * on the wire, and held — not sent, not rejected — while an in-app restart is in
 * progress, so nothing reaches RCTNetworking while the bridge tears down. The
 * hold wraps the timeout, so a held request's 20 s clock starts only when it is
 * actually sent.
 */
const fetchWithTimeout = (url: RequestInfo | URL, options?: RequestInit): Promise<Response> =>
  trackNetworkRequest(() => fetchWithTimeoutUntracked(url, options));

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
    headers: getNativeAppVersionHeaders(),
  },
});

export const getSupabaseFunctionHeaders = (
  bearer?: string | null,
): Record<string, string> => ({
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${bearer ?? supabaseAnonKey}`,
});

export interface ExplorerProfileAuthResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/**
 * #4202 — read or reactivate the signed-in user's Explorer profile with the
 * access token carried by the SIGNED_IN event itself. The shared client's
 * internal session can still be one event-loop turn behind that callback; in
 * production that made the first request run as anon and return SQLSTATE 42501.
 */
export async function requestOwnExplorerProfileForAuthEvent<T>(input: {
  accessToken: string;
  userId: string;
  reactivate: boolean;
}): Promise<ExplorerProfileAuthResult<T>> {
  const request = buildExplorerProfileAuthRestRequest({
    supabaseUrl,
    anonKey: supabaseAnonKey,
    accessToken: input.accessToken,
    userId: input.userId,
    reactivate: input.reactivate,
  });

  try {
    const response = await fetchWithTimeout(request.url, {
      ...request.init,
      headers: {
        ...getNativeAppVersionHeaders(),
        ...(request.init.headers as Record<string, string>),
      },
    });
    const payload = await response.json().catch(() => null) as
      | T[]
      | { message?: string; code?: string }
      | null;

    if (!response.ok) {
      const failure = !Array.isArray(payload) && payload !== null ? payload : null;
      return {
        data: null,
        error: {
          message: failure?.message ?? `Profile request failed (${response.status})`,
          ...(failure?.code ? { code: failure.code } : {}),
        },
      };
    }

    return {
      data: Array.isArray(payload) ? payload[0] ?? null : null,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : "Profile request failed",
      },
    };
  }
}

/**
 * #4202 — complete Explorer reactivation before an explicit sign-in returns.
 * Both requests use the verified session's bearer directly; neither waits for
 * the shared client's persisted-session state to catch up.
 */
export async function reactivateExplorerForVerifiedSession<
  T extends DeletedExplorerProfile,
>(input: {
  accessToken: string;
  userId: string;
}): Promise<ExplorerProfileResolution<T>> {
  return reactivateExplorerProfileForExplicitSession<T>(
    () => requestOwnExplorerProfileForAuthEvent<T>({
      accessToken: input.accessToken,
      userId: input.userId,
      reactivate: false,
    }),
    () => requestOwnExplorerProfileForAuthEvent<T>({
      accessToken: input.accessToken,
      userId: input.userId,
      reactivate: true,
    }),
  );
}

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
