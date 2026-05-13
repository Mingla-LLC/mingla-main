/**
 * ORCH-0821 — useConversationList
 * Sidebar drawer list of Ari conversations for the current user.
 */

import { useQuery } from "@tanstack/react-query";

import { AgentConversation, fetchConversations } from "../services/agentChatService";
import { agentQueryKeys } from "./useAgentChat";

export function useConversationList(): {
  conversations: AgentConversation[];
  isLoading: boolean;
  refetch: () => void;
} {
  const q = useQuery({
    queryKey: agentQueryKeys.conversations(),
    queryFn: fetchConversations,
    staleTime: 10_000,
  });

  return {
    conversations: q.data ?? [],
    isLoading: q.isLoading,
    refetch: q.refetch,
  };
}
