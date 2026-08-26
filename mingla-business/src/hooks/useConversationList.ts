/**
 * ORCH-0821 — useConversationList
 * Sidebar drawer list of Ari conversations for the current user.
 */

import { useQuery } from "@tanstack/react-query";

import { AgentConversation, fetchConversations } from "../services/agentChatService";
import { agentQueryKeys } from "./agentQueryKeys";
import { useAuth } from "../context/AuthContext";

const DISABLED_KEY = ["ari-conversations-disabled"] as const;

export function useConversationList(selectedBrandId: string | null): {
  conversations: AgentConversation[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady;

  const q = useQuery({
    queryKey: enabled ? agentQueryKeys.conversations(selectedBrandId) : DISABLED_KEY,
    queryFn: fetchConversations,
    enabled,
    staleTime: 10_000,
  });

  return {
    // Bound conversations from another brand are not resumable here. Legacy
    // null-brand threads remain visible for history, but the composer is read-only.
    conversations: (q.data ?? []).filter((conversation) =>
      conversation.brand_id === null || conversation.brand_id === selectedBrandId
    ),
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  };
}
