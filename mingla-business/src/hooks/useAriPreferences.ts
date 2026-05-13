/**
 * ORCH-0821 — useAriPreferences
 * Per-user Ari profile (display name, timezone, AI disclosure consent, etc.).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  acknowledgeDisclosure,
  AgentUserProfileRow,
  deleteAllAriData,
  fetchProfile,
  upsertProfile,
} from "../services/agentChatService";
import { agentQueryKeys } from "./useAgentChat";

export function useAriPreferences(): {
  profile: AgentUserProfileRow | null;
  isLoading: boolean;
  update: (patch: Partial<Omit<AgentUserProfileRow, "user_id">>) => Promise<AgentUserProfileRow>;
  acknowledge: () => Promise<void>;
  deleteAll: () => Promise<void>;
} {
  const qc = useQueryClient();

  const profileQuery = useQuery({
    queryKey: agentQueryKeys.profile(),
    queryFn: fetchProfile,
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: upsertProfile,
    onSuccess: () => qc.invalidateQueries({ queryKey: agentQueryKeys.profile() }),
  });

  const ackMutation = useMutation({
    mutationFn: acknowledgeDisclosure,
    onSuccess: () => qc.invalidateQueries({ queryKey: agentQueryKeys.profile() }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAllAriData,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ari"] });
    },
  });

  return {
    profile: profileQuery.data ?? null,
    isLoading: profileQuery.isLoading,
    update: (patch) => updateMutation.mutateAsync(patch),
    acknowledge: () => ackMutation.mutateAsync(),
    deleteAll: () => deleteMutation.mutateAsync(),
  };
}
