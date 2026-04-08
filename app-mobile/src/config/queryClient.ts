import { QueryClient, QueryCache, MutationCache, focusManager, onlineManager } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Alert, AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { breadcrumbs } from '../utils/breadcrumbs';
import { logger } from '../utils/logger';

// Wire React Query's focusManager to React Native's AppState so that
// refetchOnWindowFocus works on app resume. Queries whose data is older
// than their staleTime will automatically refetch when the app returns
// to foreground. For long backgrounds (≥ 30s), useForegroundRefresh
// additionally handles auth refresh, WebSocket reconnection, and
// force-invalidation of all critical queries.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    handleFocus(state === 'active');
  });
  return () => subscription.remove();
});

// Wire React Query's online detection to NetInfo for React Native.
// Without this, refetchOnReconnect:'always' never fires — the default uses
// browser-only `window.addEventListener('online')` which doesn't exist in RN.
// Uses isInternetReachable (not just isConnected) to detect captive portals
// and dead routers where wifi is connected but there's no actual internet.
onlineManager.setEventListener(setOnline => {
  return NetInfo.addEventListener(state => {
    const online = state.isConnected === true && state.isInternetReachable !== false;
    setOnline(online);
  });
});

// ─── Centralized 401 Handler ─────────────────────────────────────────
// Tracks consecutive auth errors across ALL queries and mutations.
// After 3 consecutive 401s within a 30-second window, force sign-out
// to escape the "zombie authenticated" state where the app is locally
// authenticated but rejected by every server call.
let auth401Count = 0;
let auth401ResetTimer: ReturnType<typeof setTimeout> | null = null;
let auth401GracePeriod = false;
let auth401GraceTimer: ReturnType<typeof setTimeout> | null = null;

// Registered full sign-out handler. AppStateManager calls setSignOutHandler()
// on mount so the 401 handler can trigger a complete cleanup (SDK resets,
// AsyncStorage sweep, React Query clear) instead of raw supabase.auth.signOut().
let _registeredSignOutHandler: (() => Promise<void>) | null = null;

/**
 * Register the full sign-out handler from AppStateManager.
 * Breaks the circular dependency: queryClient can't import AppStateManager,
 * but AppStateManager can register its handleSignOut here at mount time.
 */
export function setSignOutHandler(handler: () => Promise<void>): void {
  _registeredSignOutHandler = handler;
}

/**
 * Get the registered sign-out handler. Used by useForegroundRefresh for
 * auth retry escalation (same handler as the 401 forced sign-out path).
 */
export function getSignOutHandler(): (() => Promise<void>) | null {
  return _registeredSignOutHandler;
}

/**
 * Reset the 401 counter. Called by useForegroundRefresh at the start of
 * every resume so that transient 401s from focusManager-triggered refetches
 * (which fire before auth is refreshed) don't accumulate into a forced
 * sign-out. The counter restarts cleanly after auth refresh completes.
 */
export function resetAuth401Counter(): void {
  auth401Count = 0;
  if (auth401ResetTimer) { clearTimeout(auth401ResetTimer); auth401ResetTimer = null; }
}

/**
 * Enter a grace period during which 401 errors are not counted toward
 * the forced sign-out threshold. Called BEFORE the debounce in
 * useForegroundRefresh so that burst 401s from focusManager-triggered
 * refetches (which fire immediately on resume with an expired JWT)
 * don't trigger a false sign-out.
 */
export function enterAuth401GracePeriod(durationMs: number): void {
  auth401GracePeriod = true;
  if (auth401GraceTimer) clearTimeout(auth401GraceTimer);
  auth401GraceTimer = setTimeout(() => {
    auth401GracePeriod = false;
    auth401GraceTimer = null;
  }, durationMs);
}

function handlePotentialAuthError(error: Error): void {
  const msg = error.message ?? '';
  const is401 =
    msg.includes('401') ||
    msg.includes('JWT expired') ||
    msg.includes('Invalid JWT') ||
    msg.includes('invalid claim: missing sub claim');

  if (is401) {
    // During grace period (resume burst), skip counting — auth refresh is in progress
    if (auth401GracePeriod) return;

    auth401Count++;
    // Reset counter after 30s of no 401s — prevents false positives from
    // a single transient 401 during normal token refresh.
    if (auth401ResetTimer) clearTimeout(auth401ResetTimer);
    auth401ResetTimer = setTimeout(() => { auth401Count = 0; }, 30_000);

    if (auth401Count >= 3) {
      auth401Count = 0;
      if (auth401ResetTimer) { clearTimeout(auth401ResetTimer); auth401ResetTimer = null; }
      console.warn('[AUTH] 3 consecutive 401s — forcing sign-out');

      // Show message BEFORE sign-out so user knows what happened
      Alert.alert("Session Expired", "Your session has expired. Please sign in again.");

      // Use the registered full sign-out handler (from AppStateManager) so that
      // SDK cleanup, AsyncStorage sweep, and React Query clear all execute.
      // Falls back to raw supabase.auth.signOut() only if handler not yet registered.
      setTimeout(() => {
        if (_registeredSignOutHandler) {
          _registeredSignOutHandler().catch((e) =>
            console.error('[AUTH] Full sign-out failed:', e)
          );
        } else {
          const { supabase } = require('../services/supabase');
          supabase.auth.signOut();
        }
      }, 1000);
    }
  } else {
    // Any non-auth error breaks the consecutive chain
    auth401Count = 0;
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onSuccess: (data, query) => {
      if (!__DEV__) return;
      const key = Array.isArray(query.queryKey) ? query.queryKey.join('.') : String(query.queryKey);
      logger.query(`success ${key}`, {
        dataType: Array.isArray(data) ? `Array(${(data as unknown[]).length})` : typeof data,
      });
    },
    onError: (error, query) => {
      const key = Array.isArray(query.queryKey) ? query.queryKey.join('.') : String(query.queryKey);
      // console.error for production log aggregators; logger.query for dev Metro output
      console.error(`[QUERY] ERROR ${key} | ${error.name}: ${error.message}`);
      if (__DEV__) logger.query(`ERROR ${key}`, { error: error.message });
      breadcrumbs.add('error', `Query failed: ${key} — ${error.message}`, { queryKey: key });
      breadcrumbs.dump(`QUERY_ERROR: ${key}`);
      handlePotentialAuthError(error);
    },
  }),
  mutationCache: new MutationCache({
    onMutate: (_variables, mutation) => {
      if (!__DEV__) return;
      const key = mutation.options.mutationKey
        ? Array.isArray(mutation.options.mutationKey) ? mutation.options.mutationKey.join('.') : String(mutation.options.mutationKey)
        : '(unnamed)';
      logger.mutation(`start ${key}`);
    },
    onError: (error, _variables, _context, mutation) => {
      const key = mutation.options.mutationKey
        ? Array.isArray(mutation.options.mutationKey) ? mutation.options.mutationKey.join('.') : String(mutation.options.mutationKey)
        : '(unnamed)';
      // console.error for production log aggregators; logger.mutation for dev Metro output
      console.error(`[MUTATION] ERROR ${key} | ${error.name}: ${error.message}`);
      if (__DEV__) logger.mutation(`ERROR ${key}`, { error: error.message });
      breadcrumbs.add('error', `Mutation failed: ${key} — ${error.message}`, { mutationKey: key });
      breadcrumbs.dump(`MUTATION_ERROR: ${key}`);
      handlePotentialAuthError(error);
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      if (!__DEV__) return;
      const key = mutation.options.mutationKey
        ? Array.isArray(mutation.options.mutationKey) ? mutation.options.mutationKey.join('.') : String(mutation.options.mutationKey)
        : '(unnamed)';
      logger.mutation(`success ${key}`);
      breadcrumbs.add('mutation', `Mutation succeeded: ${key}`, { mutationKey: key });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      // Auth errors (401/JWT expired): don't retry — the auth handler refreshes
      // the token, then invalidateQueries gives the query a fresh start. Retrying
      // with the same expired JWT is a guaranteed waste. ORCH-0338.
      retry: (failureCount: number, error: Error): boolean => {
        const msg = error?.message ?? '';
        const isAuthError =
          msg.includes('401') ||
          msg.includes('JWT expired') ||
          msg.includes('Invalid JWT') ||
          msg.includes('invalid claim: missing sub claim');
        if (isAuthError) return false;
        return failureCount < 1;
      },
      refetchOnReconnect: 'always',
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
});
