import { QueryClient, QueryCache, MutationCache, focusManager } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
