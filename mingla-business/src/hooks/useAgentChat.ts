/**
 * ORCH-0821 — useAgentChat
 * Manages chat state for one conversation: message history (React Query),
 * sendMessage mutation, pending-action tracking.
 */

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import {
  AgentChatResponse,
  AgentMessage,
  fetchMessages,
  sendAgentMessage,
} from "../services/agentChatService";

export const agentQueryKeys = {
  conversations: () => ["ari", "conversations"] as const,
  messages: (conversationId: string | null) =>
    ["ari", "messages", conversationId ?? "new"] as const,
  profile: () => ["ari", "profile"] as const,
};

export interface PendingActionView {
  pending_action_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
}

export interface UseAgentChatResult {
  messages: AgentMessage[];
  isLoadingMessages: boolean;
  sendMessage: (text: string) => Promise<AgentChatResponse>;
  isSending: boolean;
  pendingAction: PendingActionView | null;
  clearPendingAction: () => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  brandId: string | null;
  errorMessage: string | null;
  clearErrorMessage: () => void;
}

export function useAgentChat(
  initialConversationId: string | null = null,
  brandId: string | null = null,
): UseAgentChatResult {
  const qc = useQueryClient();
  // ORCH-1004 — agent conversation messages are RLS auth.uid()-scoped; gate on
  // auth readiness so a pre-auth fire can't cache an empty thread as success.
  const { isAuthReady } = useAuth();
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [pendingAction, setPendingAction] = useState<PendingActionView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesQuery = useQuery({
    queryKey: agentQueryKeys.messages(conversationId),
    queryFn: () => (conversationId ? fetchMessages(conversationId) : Promise.resolve([])),
    enabled: isAuthReady && !!conversationId,
    staleTime: 0,
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      sendAgentMessage({
        conversation_id: conversationId,
        message: text,
        brand_id: brandId,
      }),
    onSuccess: (response) => {
      setErrorMessage(null);
      if (response.kind === "error") {
        setErrorMessage(response.message);
        return;
      }
      // Adopt the conversation id if the server created one
      if (response.conversation_id !== conversationId) {
        setConversationId(response.conversation_id);
        qc.invalidateQueries({ queryKey: agentQueryKeys.conversations() });
      }
      qc.invalidateQueries({ queryKey: agentQueryKeys.messages(response.conversation_id) });
      if (response.kind === "pending_action") {
        setPendingAction({
          pending_action_id: response.pending_action_id,
          tool_name: response.tool_name,
          tool_args: response.tool_args,
        });
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Couldn't send — try again";
      setErrorMessage(message);
    },
  });

  const sendMessage = useCallback(
    async (text: string): Promise<AgentChatResponse> => {
      return sendMutation.mutateAsync(text);
    },
    [sendMutation],
  );

  const clearPendingAction = useCallback((): void => {
    setPendingAction(null);
  }, []);

  // Required so the parent screen can fully dismiss the error toast.
  // Without this, the toast UI fires onDismiss → setLocalError(null) in the
  // screen, but the next render still has `chat.errorMessage` set and
  // `displayError = localError ?? chat.errorMessage` becomes truthy again,
  // re-mounting the toast. Both state sources MUST clear on dismiss.
  const clearErrorMessage = useCallback((): void => {
    setErrorMessage(null);
  }, []);

  return {
    messages: messagesQuery.data ?? [],
    isLoadingMessages: messagesQuery.isLoading,
    sendMessage,
    isSending: sendMutation.isPending,
    pendingAction,
    clearPendingAction,
    conversationId,
    setConversationId,
    brandId,
    errorMessage,
    clearErrorMessage,
  };
}
