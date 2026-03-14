import { QueryClient, QueryCache, MutationCache, focusManager, onlineManager } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import { breadcrumbs } from '../utils/breadcrumbs';
import { logger } from '../utils/logger';

// Disable React Query's automatic refetch-on-focus. useForegroundRefresh is the
// single authority for resume-triggered query work — it validates auth before
// invalidating queries, preventing expired-token failures after long backgrounds.
// Without this override, focusManager fires refetches BEFORE auth is validated.
focusManager.setEventListener(() => {
  // No-op listener: disables built-in focus detection.
  // Return a cleanup function (required by the API).
  return () => {};
});

// Wire React Query's online detection to expo-network for React Native.
// Without this, refetchOnReconnect:'always' never fires — the default uses
// browser-only `window.addEventListener('online')` which doesn't exist in RN.
// expo-network is a JS-only Expo module — no native rebuild required.
onlineManager.setEventListener(setOnline => {
  const sub = Network.addNetworkStateListener(state => {
    setOnline(state.isConnected ?? true);
  });
  return () => sub.remove();
});

// ─── Centralized 401 Handler ─────────────────────────────────────────
// Tracks consecutive auth errors across ALL queries and mutations.
// After 3 consecutive 401s within a 30-second window, force sign-out
// to escape the "zombie authenticated" state where the app is locally
// authenticated but rejected by every server call.
let auth401Count = 0;
let auth401ResetTimer: ReturnType<typeof setTimeout> | null = null;

function handlePotentialAuthError(error: Error): void {
  const msg = error.message ?? '';
  const is401 =
    msg.includes('401') ||
    msg.includes('JWT expired') ||
    msg.includes('Invalid JWT') ||
    msg.includes('invalid claim: missing sub claim');

  if (is401) {
    auth401Count++;
    // Reset counter after 30s of no 401s — prevents false positives from
    // a single transient 401 during normal token refresh.
    if (auth401ResetTimer) clearTimeout(auth401ResetTimer);
    auth401ResetTimer = setTimeout(() => { auth401Count = 0; }, 30_000);

    if (auth401Count >= 3) {
      auth401Count = 0;
      if (auth401ResetTimer) { clearTimeout(auth401ResetTimer); auth401ResetTimer = null; }
      console.warn('[AUTH] 3 consecutive 401s — forcing sign-out');
      // Lazy require to avoid circular dependency (queryClient ↔ supabase)
      const { supabase } = require('../services/supabase');
      supabase.auth.signOut();
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
      retry: 1,
      refetchOnReconnect: 'always',
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
});
