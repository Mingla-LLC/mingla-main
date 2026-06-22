/**
 * ORCH-0821 — useConversationList
 * Sidebar drawer list of Ari conversations for the current user.
 */

import { useQuery } from "@tanstack/react-query";

import { AgentConversation, fetchConversations } from "../services/agentChatService";
import { agentQueryKeys } from "./useAgentChat";
import { useAuth } from "../context/AuthContext";

const DISABLED_KEY = ["ari-conversations-disabled"] as const;

export function useConversationList(): {
  conversations: AgentConversation[];
  isLoading: boolean;
  refetch: () => void;
} {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady;

  const q = useQuery({
    queryKey: enabled ? agentQueryKeys.conversations() : DISABLED_KEY,
    queryFn: fetchConversations,
    enabled,
    staleTime: 10_000,
  });

  return {
    conversations: q.data ?? [],
    isLoading: q.isLoading,
    refetch: q.refetch,
  };
}
