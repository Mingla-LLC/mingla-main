import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recordVisit, fetchMyVisits, fetchPairedUserVisits, hasVisited, removeVisit, RecordVisitParams } from '../services/visitService';
import { savedCardKeys } from './queryKeys';

export const visitKeys = {
  all: (userId: string) => ['visits', userId] as const,
  my: (userId: string) => ['visits', 'my', userId] as const,
  paired: (userId: string, pairedUserId: string) => ['visits', 'paired', userId, pairedUserId] as const,
  check: (userId: string, experienceId: string) => ['visits', 'check', userId, experienceId] as const,
};

export function useMyVisits(userId: string | undefined) {
  return useQuery({
    queryKey: visitKeys.my(userId || ''),
    queryFn: fetchMyVisits,
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function usePairedUserVisits(userId: string | undefined, pairedUserId: string | undefined) {
  return useQuery({
    queryKey: visitKeys.paired(userId || '', pairedUserId || ''),
    queryFn: () => fetchPairedUserVisits(pairedUserId!),
    enabled: !!userId && !!pairedUserId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useHasVisited(userId: string | undefined, experienceId: string | undefined) {
  return useQuery({
    queryKey: visitKeys.check(userId || '', experienceId || ''),
    queryFn: () => hasVisited(experienceId!),
    enabled: !!userId && !!experienceId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useRecordVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: RecordVisitParams) => recordVisit(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
    },
    onError: (error) => {
      console.error('[useVisits] Record visit failed:', error);
    },
  });
}

export function useRemoveVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (experienceId: string) => removeVisit(experienceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
    },
    onError: (error) => {
      console.error('[useVisits] Remove visit failed:', error);
    },
  });
}
