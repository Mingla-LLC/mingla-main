import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { breadcrumbs } from '../utils/breadcrumbs';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const key = Array.isArray(query.queryKey) ? query.queryKey.join('.') : String(query.queryKey);
      const msg = `key="${key}" | ${error.name}: ${error.message}`;
      console.error(`[QUERY_ERROR] ${msg}`, error);
      breadcrumbs.add('error', `Query failed: ${key} — ${error.message}`, { queryKey: key });
      breadcrumbs.dump(`QUERY_ERROR: ${key}`);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const key = mutation.options.mutationKey
        ? Array.isArray(mutation.options.mutationKey) ? mutation.options.mutationKey.join('.') : String(mutation.options.mutationKey)
        : '(unnamed)';
      const msg = `key="${key}" | ${error.name}: ${error.message}`;
      console.error(`[MUTATION_ERROR] ${msg}`, error);
      breadcrumbs.add('error', `Mutation failed: ${key} — ${error.message}`, { mutationKey: key });
      breadcrumbs.dump(`MUTATION_ERROR: ${key}`);
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      if (!__DEV__) return;
      const key = mutation.options.mutationKey
        ? Array.isArray(mutation.options.mutationKey) ? mutation.options.mutationKey.join('.') : String(mutation.options.mutationKey)
        : '(unnamed)';
      breadcrumbs.add('mutation', `Mutation succeeded: ${key}`, { mutationKey: key });
      console.log(`[MUTATION_OK] key="${key}"`);
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
