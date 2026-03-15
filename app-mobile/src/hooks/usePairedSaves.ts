import { useQuery } from '@tanstack/react-query';
import { fetchPairedSaves } from '../services/pairedSavesService';

export const pairedSavesKeys = {
  all: (pairedUserId: string) => ['pairedSaves', pairedUserId] as const,
  filtered: (pairedUserId: string, category?: string) =>
    ['pairedSaves', pairedUserId, category || 'all'] as const,
};

export function usePairedSaves(
  pairedUserId: string | undefined,
  category?: string
) {
  return useQuery({
    queryKey: pairedSavesKeys.filtered(pairedUserId || '', category),
    queryFn: () => fetchPairedSaves({
      pairedUserId: pairedUserId!,
      category,
    }),
    enabled: !!pairedUserId,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
