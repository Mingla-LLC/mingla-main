import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';
import {
  betaFeedbackService,
  type SubmitFeedbackRequest,
} from '../services/betaFeedbackService';

// ── Query Keys ──────────────────────────────────────────────────────────────

export const feedbackKeys = {
  all: ['beta-feedback'] as const,
  history: (userId: string) => [...feedbackKeys.all, 'history', userId] as const,
};

// ── Beta Tester Check ───────────────────────────────────────────────────────

export function useIsBetaTester(): boolean {
  const profile = useAppStore((s) => s.profile);
  return (profile as Record<string, unknown>)?.is_beta_tester === true;
}

// ── Feedback History ────────────────────────────────────────────────────────

export function useFeedbackHistory() {
  const user = useAppStore((s) => s.user);
  const isBetaTester = useIsBetaTester();

  return useQuery({
    queryKey: feedbackKeys.history(user?.id ?? ''),
    queryFn: () => betaFeedbackService.getUserFeedbackHistory(user!.id),
    enabled: !!user?.id && isBetaTester,
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

// ── Submit Mutation ─────────────────────────────────────────────────────────

export function useSubmitFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['beta-feedback', 'submit'],
    mutationFn: (params: SubmitFeedbackRequest) =>
      betaFeedbackService.submitFeedback(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.all });
    },
    onError: (error) => {
      console.error('[useBetaFeedback] Submit failed:', error.message);
    },
  });
}
