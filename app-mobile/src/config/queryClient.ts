import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const key = Array.isArray(query.queryKey) ? query.queryKey.join('.') : String(query.queryKey);
      console.error(`[QUERY_ERROR] key="${key}" | ${error.name}: ${error.message}`, error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const key = mutation.options.mutationKey
        ? Array.isArray(mutation.options.mutationKey) ? mutation.options.mutationKey.join('.') : String(mutation.options.mutationKey)
        : '(unnamed)';
      console.error(`[MUTATION_ERROR] key="${key}" | ${error.name}: ${error.message}`, error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes - data is fresh for 5 minutes
      gcTime: 24 * 60 * 60 * 1000, // 24 hours - cache time (formerly cacheTime)
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
});

