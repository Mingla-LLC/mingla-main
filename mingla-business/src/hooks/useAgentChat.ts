/**
 * ORCH-0821 — useAgentChat
 * Manages chat state for one conversation: message history (React Query),
 * sendMessage mutation, pending-action tracking.
 * Issue #2060: gates Send through canDispatchAriIntent / reduceAriClientIntent.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import {
  AgentChoiceSubmissionV2,
  AgentChatResponse,
  AgentMessage,
  fetchMessages,
  sendAgentMessage,
} from "../services/agentChatService";
import {
  AriClientIntentRecord,
  canDispatchAriIntent,
  createAriClientIntent,
  reduceAriClientIntent,
} from "../services/agentReliability";
import { useShareNetworkState } from "../components/ui/useShareNetworkState";
import { agentQueryKeys } from "./agentQueryKeys";

export { agentQueryKeys };

export interface PendingActionView {
  pending_action_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
}

export interface UseAgentChatResult {
  messages: AgentMessage[];
  isLoadingMessages: boolean;
  sendMessage: (text: string) => Promise<AgentChatResponse>;
  sendChoice: (submission: AgentChoiceSubmissionV2, label: string) => Promise<AgentChatResponse>;
  retryTurn: (clientTurnId: string) => Promise<AgentChatResponse | null>;
  isSending: boolean;
  pendingAction: PendingActionView | null;
  clearPendingAction: () => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  brandId: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  clearErrorMessage: () => void;
}

// ORCH-1101 REWORK Bug #2 — optimistic user message. Built crash-safe to the
// exact AgentMessage shape MessageList consumes (role "user", content.text set,
// tool_calls/tool_results null) so it renders as a normal user ChatBubble with
// zero special-casing. The id is prefixed `optimistic-` so it can be removed on
// reconcile and never collides with a real DB uuid.
function newClientTurnId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function makeOptimisticMessage(text: string, conversationId: string | null): AgentMessage {
  return {
    id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversation_id: conversationId ?? "new",
    role: "user",
    content: { text },
    client_turn_id: null,
    tool_calls: null,
    tool_results: null,
    created_at: new Date().toISOString(),
  };
}

function makeFailedMessage(
  text: string,
  conversationId: string | null,
  clientTurnId: string,
): AgentMessage {
  return {
    id: `failed-${clientTurnId}`,
    conversation_id: conversationId ?? "new",
    role: "user",
    content: { text, local_delivery: "failed" },
    client_turn_id: clientTurnId,
    tool_calls: null,
    tool_results: null,
    created_at: new Date().toISOString(),
  };
}

export function reconcileAgentDeliveryMessages(
  serverMessages: AgentMessage[],
  optimisticMessages: AgentMessage[],
  failedMessages: AgentMessage[],
  currentScope: boolean,
): AgentMessage[] {
  const liveOptimistic = optimisticMessages.filter(
    (o) =>
      currentScope && !serverMessages.some(
        (s) => s.role === "user" && (s.content as { text?: string })?.text === (o.content as { text?: string })?.text,
      ),
  );
  const mergedMessages: AgentMessage[] = [...serverMessages, ...liveOptimistic];
  const liveFailed = failedMessages.filter(
    (failed) => currentScope && !serverMessages.some(
      (server) => server.role === "user" && server.client_turn_id === failed.client_turn_id,
    ),
  );
  mergedMessages.push(...liveFailed);
  return mergedMessages;
}

export function useAgentChat(
  initialConversationId: string | null = null,
  brandId: string | null = null,
  onConversationIdChange?: (conversationId: string | null) => void,
): UseAgentChatResult {
  const qc = useQueryClient();
  // ORCH-1004 — agent conversation messages are RLS auth.uid()-scoped; gate on
  // auth readiness so a pre-auth fire can't cache an empty thread as success.
  const { isAuthReady } = useAuth();
  const online = useShareNetworkState();
  const sendIntentRef = useRef<AriClientIntentRecord | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [pendingAction, setPendingAction] = useState<PendingActionView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // ORCH-1101 REWORK Bug #2 — optimistic user messages awaiting server echo.
  // Rendered immediately so the user's bubble appears the instant they hit send,
  // not after the edge round-trip. Reconciled (cleared) once the real thread
  // refetch lands, or dropped on send error.
  const [optimisticMessages, setOptimisticMessages] = useState<AgentMessage[]>([]);
  // Failed delivery is a separate terminal local state. The sending placeholder
  // is always removed on failure; this row alone owns retry retention.
  const [failedMessages, setFailedMessages] = useState<AgentMessage[]>([]);
  const turnPayloads = useRef(new Map<string, { message?: string; choice_response?: AgentChoiceSubmissionV2 }>());
  const previousBrandId = useRef(brandId);
  const [stateBrandId, setStateBrandId] = useState(brandId);
  const brandEpoch = useRef(0);

  const selectConversation = useCallback((id: string | null): void => {
    setConversationId(id);
    onConversationIdChange?.(id);
  }, [onConversationIdChange]);

  useEffect(() => {
    if (previousBrandId.current === brandId) return;
    previousBrandId.current = brandId;
    setStateBrandId(brandId);
    brandEpoch.current += 1;
    setConversationId(null);
    setPendingAction(null);
    setOptimisticMessages([]);
    setFailedMessages([]);
    turnPayloads.current.clear();
    setErrorMessage(null);
    setErrorCode(null);
    sendMutation.reset();
  // The mutation object is intentionally excluded: only a selected-brand change resets a thread.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  const messagesQuery = useQuery({
    queryKey: agentQueryKeys.messages(conversationId),
    queryFn: () => (conversationId ? fetchMessages(conversationId) : Promise.resolve([])),
    enabled: isAuthReady && !!conversationId,
    staleTime: 0,
  });

  const sendMutation = useMutation({
    mutationFn: (vars: { displayText: string; optimisticId: string; clientTurnId: string; epoch: number; message?: string; choice_response?: AgentChoiceSubmissionV2 }) =>
      sendAgentMessage({
        conversation_id: conversationId,
        ...(vars.message ? { message: vars.message } : {}),
        ...(vars.choice_response ? { choice_response: vars.choice_response } : {}),
        client_turn_id: vars.clientTurnId,
        client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        locale: Intl.DateTimeFormat().resolvedOptions().locale || "en-US",
        brand_id: brandId,
      }),
    onSuccess: async (response, vars) => {
      if (vars.epoch !== brandEpoch.current) return;
      setErrorMessage(null);
      setErrorCode(null);
      if (response.kind === "error") {
        setErrorMessage(response.message);
        setErrorCode(response.code);
        setOptimisticMessages((prev) => prev.filter((m) => m.id !== vars.optimisticId));
        setFailedMessages((prev) => [
          ...prev.filter((m) => m.client_turn_id !== vars.clientTurnId),
          makeFailedMessage(vars.displayText, conversationId, vars.clientTurnId),
        ]);
        if (
          response.code === "TASK_STATE_CONFLICT" ||
          response.code === "CHOICE_STALE" ||
          response.code === "STALE_PROPOSAL" ||
          response.code === "CONFLICT"
        ) {
          void qc.invalidateQueries({ queryKey: agentQueryKeys.messages(conversationId) });
        }
        return;
      }
      // Adopt the conversation id if the server created one
      if (response.conversation_id !== conversationId) {
        selectConversation(response.conversation_id);
        void qc.invalidateQueries({ queryKey: agentQueryKeys.conversations(brandId) });
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
      setFailedMessages((prev) => prev.filter((m) => m.client_turn_id !== vars.clientTurnId));
      turnPayloads.current.delete(vars.clientTurnId);
    },
    onError: (err: unknown, vars) => {
      if (vars.epoch !== brandEpoch.current) return;
      const message = err instanceof Error ? err.message : "Couldn't send — try again";
      setErrorMessage(message);
      setErrorCode("EDGE_ERROR");
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== vars.optimisticId));
      setFailedMessages((prev) => [
        ...prev.filter((m) => m.client_turn_id !== vars.clientTurnId),
        makeFailedMessage(vars.displayText, conversationId, vars.clientTurnId),
      ]);
    },
  });

  const sendTurn = useCallback(async (
    displayText: string,
    payload: { message?: string; choice_response?: AgentChoiceSubmissionV2 },
    clientTurnId = newClientTurnId(),
  ): Promise<AgentChatResponse> => {
    setErrorMessage(null);
    setErrorCode(null);
    const intent = createAriClientIntent({
      intent: "send",
      conversationId,
      brandId,
      draftText: displayText,
    }, () => clientTurnId);
    const current = sendIntentRef.current?.stableId === clientTurnId
      ? sendIntentRef.current
      : intent;
    const gate = canDispatchAriIntent(current, online !== false);
    if (!gate.allowed) {
      const blocked: AgentChatResponse = {
        kind: "error",
        code: gate.reason === "offline"
          ? "OFFLINE"
          : gate.reason === "server_reconcile"
          ? "RECONCILIATION_REQUIRED"
          : "IN_FLIGHT",
        message: gate.reason === "offline"
          ? "You are offline. Your request is still here for you to retry."
          : gate.reason === "server_reconcile"
          ? "Ari is verifying the result before showing it as complete."
          : "Ari is already working on that request.",
      };
      setErrorMessage(blocked.message);
      setErrorCode(blocked.code);
      return blocked;
    }
    sendIntentRef.current = reduceAriClientIntent(current, { type: "dispatch_started" });
    turnPayloads.current.set(clientTurnId, payload);
    setFailedMessages((prev) => prev.filter((m) => m.client_turn_id !== clientTurnId));
    const optimistic = makeOptimisticMessage(displayText, conversationId);
    setOptimisticMessages((prev) => [...prev, optimistic]);
    try {
      const response = await sendMutation.mutateAsync({
        displayText,
        optimisticId: optimistic.id,
        clientTurnId,
        epoch: brandEpoch.current,
        ...payload,
      });
      if (sendIntentRef.current?.stableId === clientTurnId) {
        if (response.kind === "error") {
          sendIntentRef.current = reduceAriClientIntent(sendIntentRef.current, {
            type: "transport_uncertain",
            code: response.code,
          });
        } else {
          // Terminal success for this turn — retries must mint a new turn.
          sendIntentRef.current = {
            ...sendIntentRef.current,
            state: "terminal",
            lastCode: response.kind === "pending_action"
              ? "PROPOSAL_READY"
              : "PROPOSAL_READY",
            retryAt: null,
          };
        }
      }
      return response;
    } catch (err) {
      if (sendIntentRef.current?.stableId === clientTurnId) {
        sendIntentRef.current = reduceAriClientIntent(sendIntentRef.current, {
          type: "transport_uncertain",
          code: "TRANSPORT_UNAVAILABLE",
        });
      }
      throw err;
    }
  }, [brandId, conversationId, online, sendMutation]);

  const sendMessage = useCallback(
    async (text: string): Promise<AgentChatResponse> => {
      return sendTurn(text, { message: text });
    },
    [sendTurn],
  );

  const sendChoice = useCallback(
    (submission: AgentChoiceSubmissionV2, label: string) => sendTurn(label, { choice_response: submission }),
    [sendTurn],
  );

  const retryTurn = useCallback(async (clientTurnId: string): Promise<AgentChatResponse | null> => {
    const payload = turnPayloads.current.get(clientTurnId);
    const failed = failedMessages.find((message) => message.client_turn_id === clientTurnId);
    if (!payload || !failed) return null;
    return sendTurn((failed.content as { text?: string }).text ?? "Retry", payload, clientTurnId);
  }, [failedMessages, sendTurn]);

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
    setErrorCode(null);
  }, []);

  // ORCH-1101 REWORK Bug #2 — render server thread + any not-yet-reconciled
  // optimistic bubbles. Defensive dedupe: if the refetched thread already
  // contains a user row with identical text (the real echo landed before the
  // optimistic clear ran), drop the placeholder so the bubble never doubles.
  const currentScope = stateBrandId === brandId;
  const serverMessages = currentScope ? messagesQuery.data ?? [] : [];
  useEffect(() => {
    if (!currentScope) return;
    let unresolved: PendingActionView | null = null;
    const resolved = new Set(serverMessages
      .filter((message) => message.role === "tool")
      .map((message) => (message.tool_results as { pending_action_id?: unknown } | null)?.pending_action_id)
      .filter((id): id is string => typeof id === "string"));
    for (const message of serverMessages) {
      const call = message.role === "assistant" ? message.tool_calls : null;
      if (call && !resolved.has(call.pending_action_id)) {
        unresolved = {
          pending_action_id: call.pending_action_id,
          tool_name: call.tool_name,
          tool_args: call.args,
        };
      }
    }
    setPendingAction(unresolved);
  }, [currentScope, serverMessages]);
  const mergedMessages = reconcileAgentDeliveryMessages(
    serverMessages,
    optimisticMessages,
    failedMessages,
    currentScope,
  );

  return {
    messages: mergedMessages,
    isLoadingMessages: messagesQuery.isLoading,
    sendMessage,
    sendChoice,
    retryTurn,
    isSending: currentScope ? sendMutation.isPending : false,
    pendingAction: currentScope ? pendingAction : null,
    clearPendingAction,
    conversationId: currentScope ? conversationId : null,
    setConversationId: selectConversation,
    brandId,
    errorMessage: currentScope ? errorMessage : null,
    errorCode: currentScope ? errorCode : null,
    clearErrorMessage,
  };
}
