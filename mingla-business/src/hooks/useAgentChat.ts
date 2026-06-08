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

// ORCH-1101 REWORK Bug #2 — optimistic user message. Built crash-safe to the
// exact AgentMessage shape MessageList consumes (role "user", content.text set,
// tool_calls/tool_results null) so it renders as a normal user ChatBubble with
// zero special-casing. The id is prefixed `optimistic-` so it can be removed on
// reconcile and never collides with a real DB uuid.
function makeOptimisticMessage(text: string, conversationId: string | null): AgentMessage {
  return {
    id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversation_id: conversationId ?? "new",
    role: "user",
    content: { text },
    tool_calls: null,
    tool_results: null,
    created_at: new Date().toISOString(),
  };
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
  // ORCH-1101 REWORK Bug #2 — optimistic user messages awaiting server echo.
  // Rendered immediately so the user's bubble appears the instant they hit send,
  // not after the edge round-trip. Reconciled (cleared) once the real thread
  // refetch lands, or dropped on send error.
  const [optimisticMessages, setOptimisticMessages] = useState<AgentMessage[]>([]);

  const messagesQuery = useQuery({
    queryKey: agentQueryKeys.messages(conversationId),
    queryFn: () => (conversationId ? fetchMessages(conversationId) : Promise.resolve([])),
    enabled: isAuthReady && !!conversationId,
    staleTime: 0,
  });

  const sendMutation = useMutation({
    mutationFn: (vars: { text: string; optimisticId: string }) =>
      sendAgentMessage({
        conversation_id: conversationId,
        message: vars.text,
        brand_id: brandId,
      }),
    onSuccess: async (response, vars) => {
      setErrorMessage(null);
      if (response.kind === "error") {
        setErrorMessage(response.message);
        // Drop the optimistic bubble — the message never landed.
        setOptimisticMessages((prev) => prev.filter((m) => m.id !== vars.optimisticId));
        return;
      }
      // Adopt the conversation id if the server created one
      if (response.conversation_id !== conversationId) {
        setConversationId(response.conversation_id);
        void qc.invalidateQueries({ queryKey: agentQueryKeys.conversations() });
      }
      if (response.kind === "pending_action") {
        setPendingAction({
          pending_action_id: response.pending_action_id,
          tool_name: response.tool_name,
          tool_args: response.tool_args,
        });
      }
      // Refetch the canonical thread, THEN drop the optimistic echo. Awaiting the
      // invalidation (which refetches the active query) guarantees the real
      // user+assistant rows are in the cache before we remove the placeholder, so
      // the user's bubble never blinks out between optimistic-clear and refetch.
      await qc.invalidateQueries({ queryKey: agentQueryKeys.messages(response.conversation_id) });
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== vars.optimisticId));
    },
    onError: (err: unknown, vars) => {
      const message = err instanceof Error ? err.message : "Couldn't send — try again";
      setErrorMessage(message);
      // The send failed — remove the optimistic bubble so the thread doesn't
      // strand a message that was never persisted.
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== vars.optimisticId));
    },
  });

  const sendMessage = useCallback(
    async (text: string): Promise<AgentChatResponse> => {
      // ORCH-1101 REWORK Bug #2 — insert the optimistic user bubble synchronously
      // so it renders this frame, before the edge round-trip.
      const optimistic = makeOptimisticMessage(text, conversationId);
      setOptimisticMessages((prev) => [...prev, optimistic]);
      return sendMutation.mutateAsync({ text, optimisticId: optimistic.id });
    },
    [sendMutation, conversationId],
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

  // ORCH-1101 REWORK Bug #2 — render server thread + any not-yet-reconciled
  // optimistic bubbles. Defensive dedupe: if the refetched thread already
  // contains a user row with identical text (the real echo landed before the
  // optimistic clear ran), drop the placeholder so the bubble never doubles.
  const serverMessages = messagesQuery.data ?? [];
  const liveOptimistic = optimisticMessages.filter(
    (o) =>
      !serverMessages.some(
        (s) => s.role === "user" && (s.content as { text?: string })?.text === (o.content as { text?: string })?.text,
      ),
  );
  const mergedMessages: AgentMessage[] = [...serverMessages, ...liveOptimistic];

  return {
    messages: mergedMessages,
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
