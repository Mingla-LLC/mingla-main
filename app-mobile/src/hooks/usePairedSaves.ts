import { useQuery } from '@tanstack/react-query';
import { fetchPairedSaves } from '../services/pairedSavesService';
import { savedCardKeys } from './queryKeys';

export function usePairedSaves(
  pairedUserId: string | undefined,
  category?: string
) {
  return useQuery({
    queryKey: savedCardKeys.paired(pairedUserId || '', category),
    queryFn: () => fetchPairedSaves({
      pairedUserId: pairedUserId!,
      category,
    }),
    enabled: !!pairedUserId,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
