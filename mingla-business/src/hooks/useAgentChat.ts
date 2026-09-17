/**
 * Issue #3429 — one-owner Ari delivery state.
 * One immutable client_turn_id owns the local row, retry payload, activity,
 * cancellation, and reconciliation. Text is presentation, never identity.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useShareNetworkState } from "../components/ui/useShareNetworkState";
import { useAuth } from "../context/AuthContext";
import {
  type AgentChoiceSubmissionV2,
  type AgentChatResponse,
  type AgentMessage,
  fetchMessages,
  sendAgentMessage,
} from "../services/agentChatService";
import {
  type AriAttachmentDraft,
  type AriSentAttachment,
  discardAriAttachment,
} from "../services/ariAttachmentService";
import {
  type AriActivityEvent,
  type AriAttemptStatus,
  fetchAriTurnStatus,
  retryAriTurn,
  stopAriTurn,
  subscribeAriTurnActivity,
} from "../services/ariTurnService";
import { captureAriActivityDisplayed, captureAriTurnOutcome } from "../services/ariPolishAnalytics";
import {
  type AriActivityWatermark,
  ariRowDelivery,
  isAriTurnStoppable,
  isOrdinaryTurnActivityVisible,
  isTurnInSelectedConversation,
  latestLabelledActivityEvent,
  shouldFollowTurnConversation,
} from "../services/ariTurnView";
import {
  type AriClientIntentRecord,
  canDispatchAriIntent,
  createAriClientIntent,
  isCurrentAriTurnEpoch,
  reduceAriClientIntent,
} from "../services/agentReliability";
import { agentQueryKeys } from "./agentQueryKeys";

export { agentQueryKeys };

export interface PendingActionView {
  pending_action_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
}

type AriSurface = "main" | "website";

export interface AriEditableTurn {
  text: string;
  attachments: AriAttachmentDraft[];
}

export interface AriActiveTurn {
  clientTurnId: string;
  accepted: boolean;
  delivery: "sending" | "sent" | "failed" | "stopped";
  event: AriActivityEvent | null;
  errorCode: string | null;
  errorMessage: string | null;
  reconciling: boolean;
  startedAt: number;
  /** D-1: false for a completed attempt (e.g. an approved action), so no Stop is offered. */
  stoppable: boolean;
}

export interface UseAgentChatResult {
  messages: AgentMessage[];
  isLoadingMessages: boolean;
  sendMessage: (text: string, attachments?: AriAttachmentDraft[]) => Promise<AgentChatResponse>;
  sendChoice: (submission: AgentChoiceSubmissionV2, label: string) => Promise<AgentChatResponse>;
  retryTurn: (clientTurnId: string) => Promise<AgentChatResponse | null>;
  retryTenantRecovery: () => Promise<AgentChatResponse | null>;
  editTurn: (clientTurnId: string) => AriEditableTurn | null;
  discardTurn: (clientTurnId: string) => void;
  stopTurn: (clientTurnId: string) => Promise<void>;
  beginConfirmedActivity: (pendingActionId: string) => void;
  finishConfirmedActivity: () => void;
  reconcileActiveTurns: () => Promise<void>;
  activeTurn: AriActiveTurn | null;
  isSending: boolean;
  pendingAction: PendingActionView | null;
  clearPendingAction: () => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  brandId: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  clearErrorMessage: () => void;
  setSurface: (surface: AriSurface) => void;
}

type TurnPayload = {
  message?: string;
  choice_response?: AgentChoiceSubmissionV2;
  attachment_ids?: string[];
};

interface LocalTurn {
  clientTurnId: string;
  localId: string;
  conversationId: string | null;
  /** The selection the turn was sent from; never changes (D-2 origin guard). */
  originConversationId: string | null;
  displayText: string;
  payload: TurnPayload;
  attachments: AriAttachmentDraft[];
  delivery: "sending" | "sent" | "failed" | "stopped";
  accepted: boolean;
  attemptStatus: AriAttemptStatus | null;
  attemptNumber: number;
  events: AriActivityEvent[];
  errorCode: string | null;
  errorMessage: string | null;
  reconciling: boolean;
  startedAt: number;
  createdAt: string;
  epoch: number;
}

/**
 * D-1: an approved-action confirmation owns the activity callout only from
 * `approved_action_started` (or Confirm) until the confirm call resolves.
 * Events at or before the watermark belong to the original answer and never
 * relabel it.
 */
interface ConfirmationActivity {
  clientTurnId: string;
  conversationId: string | null;
  watermark: AriActivityWatermark;
  events: AriActivityEvent[];
  startedAt: number;
}

function newClientTurnId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function sentAttachment(draft: AriAttachmentDraft, index: number): AriSentAttachment {
  return {
    id: draft.attachmentId ?? draft.localId,
    original_filename: draft.name,
    verified_mime: draft.mimeType,
    file_type: draft.fileType === "unsupported" ? "text" : draft.fileType,
    verified_size_bytes: draft.sizeBytes,
    display_order: index,
    state: "ready",
  };
}

function turnMessage(turn: LocalTurn): AgentMessage {
  const attachmentCount = turn.attachments.length;
  const text = turn.displayText || (attachmentCount === 1 ? "1 attachment" : `${attachmentCount} attachments`);
  return {
    id: turn.localId,
    conversation_id: turn.conversationId ?? "new",
    role: "user",
    content: {
      text,
      local_delivery: ariRowDelivery(turn.delivery, turn.accepted),
      ...(turn.errorMessage ? { local_error: turn.errorMessage } : {}),
      ...(attachmentCount ? { attachments: turn.attachments.map(sentAttachment) } : {}),
    },
    client_turn_id: turn.clientTurnId,
    tool_calls: null,
    tool_results: null,
    created_at: turn.createdAt,
  };
}

function canonicalIdentityMatch(server: AgentMessage, local: AgentMessage): boolean {
  if (server.role !== "user" || local.role !== "user") return false;
  if (server.client_turn_id && local.client_turn_id) return server.client_turn_id === local.client_turn_id;
  // Compatibility for historical pre-#3429 records only. New turns always
  // have ids and can never reconcile by text equality.
  if (!server.client_turn_id || !local.client_turn_id) {
    return (server.content as { text?: string }).text === (local.content as { text?: string }).text;
  }
  return false;
}

export function reconcileAgentDeliveryMessages(
  serverMessages: AgentMessage[],
  optimisticMessages: AgentMessage[],
  failedMessages: AgentMessage[],
  currentScope: boolean,
): AgentMessage[] {
  if (!currentScope) return serverMessages;
  const locals = [...optimisticMessages, ...failedMessages];
  const live = locals.filter((local, index) =>
    locals.findIndex((candidate) => candidate.client_turn_id === local.client_turn_id) === index &&
    !serverMessages.some((server) => canonicalIdentityMatch(server, local)));
  return [...serverMessages, ...live];
}

function mergeEvents(current: AriActivityEvent[], incoming: AriActivityEvent[]): AriActivityEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) =>
    a.attempt_number - b.attempt_number || a.sequence - b.sequence || a.id.localeCompare(b.id));
}

export function useAgentChat(
  initialConversationId: string | null = null,
  brandId: string | null = null,
  onConversationIdChange?: (conversationId: string | null) => void,
): UseAgentChatResult {
  const qc = useQueryClient();
  const { isAuthReady } = useAuth();
  const online = useShareNetworkState();
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [stateBrandId, setStateBrandId] = useState(brandId);
  const [pendingAction, setPendingAction] = useState<PendingActionView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [turns, setTurns] = useState<LocalTurn[]>([]);
  const turnsRef = useRef<LocalTurn[]>([]);
  const conversationIdRef = useRef<string | null>(initialConversationId);
  const [confirmation, setConfirmationState] = useState<ConfirmationActivity | null>(null);
  const confirmationRef = useRef<ConfirmationActivity | null>(null);
  const confirmationSubscription = useRef<(() => void) | null>(null);
  const subscriptions = useRef(new Map<string, () => void>());
  const sendIntentRef = useRef<AriClientIntentRecord | null>(null);
  const surfaceRef = useRef<AriSurface>("main");
  const brandEpoch = useRef(0);
  const previousBrandId = useRef(brandId);
  const sameFrameLock = useRef(false);

  const replaceTurns = useCallback((producer: (current: LocalTurn[]) => LocalTurn[]): void => {
    const next = producer(turnsRef.current);
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const patchTurn = useCallback((clientTurnId: string, patch: Partial<LocalTurn>): void => {
    replaceTurns((current) => current.map((turn) => turn.clientTurnId === clientTurnId ? { ...turn, ...patch } : turn));
  }, [replaceTurns]);

  const setConfirmation = useCallback((next: ConfirmationActivity | null): void => {
    confirmationRef.current = next;
    setConfirmationState(next);
  }, []);

  const selectConversation = useCallback((id: string | null): void => {
    conversationIdRef.current = id;
    setConversationId(id);
    onConversationIdChange?.(id);
  }, [onConversationIdChange]);
  const setSurface = useCallback((nextSurface: AriSurface): void => {
    surfaceRef.current = nextSurface;
  }, []);

  useEffect(() => {
    if (previousBrandId.current === brandId) return;
    previousBrandId.current = brandId;
    brandEpoch.current += 1;
    subscriptions.current.forEach((unsubscribe) => unsubscribe());
    subscriptions.current.clear();
    confirmationSubscription.current?.();
    confirmationSubscription.current = null;
    setConfirmation(null);
    sendIntentRef.current = null;
    turnsRef.current = [];
    setTurns([]);
    setStateBrandId(brandId);
    conversationIdRef.current = null;
    setConversationId(null);
    setPendingAction(null);
    setErrorMessage(null);
    setErrorCode(null);
  }, [brandId, setConfirmation]);

  useEffect(() => () => {
    subscriptions.current.forEach((unsubscribe) => unsubscribe());
    subscriptions.current.clear();
    confirmationSubscription.current?.();
    confirmationSubscription.current = null;
  }, []);

  const messagesQuery = useQuery({
    queryKey: agentQueryKeys.messages(conversationId),
    queryFn: () => conversationId ? fetchMessages(conversationId) : Promise.resolve([]),
    enabled: isAuthReady && !!conversationId,
    staleTime: 0,
  });

  /** Records a confirmation-phase event, starting confirmation on approved_action_started. */
  const routeConfirmationEvent = useCallback((clientTurnId: string, event: AriActivityEvent, currentAttempt: number | null): void => {
    const active = confirmationRef.current;
    if (active?.clientTurnId === clientTurnId) {
      const afterWatermark = event.attempt_number > active.watermark.attemptNumber ||
        (event.attempt_number === active.watermark.attemptNumber && event.sequence > active.watermark.sequence);
      if (afterWatermark && !active.events.some((item) => item.id === event.id)) {
        setConfirmation({ ...active, events: mergeEvents(active.events, [event]) });
      }
      return;
    }
    if (
      event.event_type === "approved_action_started" &&
      (currentAttempt === null || event.attempt_number === currentAttempt)
    ) {
      const owner = turnsRef.current.find((turn) => turn.clientTurnId === clientTurnId);
      setConfirmation({
        clientTurnId,
        conversationId: owner?.conversationId ?? conversationIdRef.current,
        watermark: { attemptNumber: event.attempt_number, sequence: event.sequence - 1 },
        events: [event],
        startedAt: Date.now(),
      });
    }
  }, [setConfirmation]);

  const installSubscription = useCallback((clientTurnId: string): void => {
    if (subscriptions.current.has(clientTurnId)) return;
    const unsubscribe = subscribeAriTurnActivity(clientTurnId, (event) => {
      replaceTurns((current) => current.map((turn) => {
        if (turn.clientTurnId !== clientTurnId || event.attempt_number < turn.attemptNumber) return turn;
        const events = event.attempt_number > turn.attemptNumber ? [event] : mergeEvents(turn.events, [event]);
        const eventConversationId = (event as AriActivityEvent & { conversation_id?: unknown }).conversation_id;
        captureAriActivityDisplayed({ surface: surfaceRef.current, phase: event.event_type });
        return {
          ...turn,
          // D-2: the claim is known once any event exists for the turn.
          conversationId: typeof eventConversationId === "string" ? eventConversationId : turn.conversationId,
          attemptNumber: event.attempt_number,
          events,
          accepted: true,
          delivery: event.event_type === "stopped" ? "stopped" : turn.delivery,
          attemptStatus: event.event_type === "stopped"
            ? "stopped"
            : event.event_type === "failed"
            ? "failed"
            : event.event_type === "response_ready"
            ? "completed"
            : turn.attemptStatus,
        };
      }));
      const owner = turnsRef.current.find((turn) => turn.clientTurnId === clientTurnId);
      // D-2: a claim learned from an event follows the same origin guard as
      // HTTP success, so an in-flight New conversation row never vanishes.
      if (
        owner && owner.conversationId !== null &&
        owner.conversationId !== conversationIdRef.current &&
        shouldFollowTurnConversation(conversationIdRef.current, owner.originConversationId)
      ) {
        selectConversation(owner.conversationId);
      }
      routeConfirmationEvent(clientTurnId, event, owner ? owner.attemptNumber : null);
    });
    subscriptions.current.set(clientTurnId, unsubscribe);
  }, [replaceTurns, routeConfirmationEvent, selectConversation]);

  const refreshCanonicalMessages = useCallback(async (targetConversationId: string): Promise<void> => {
    qc.setQueryData(agentQueryKeys.messages(targetConversationId), await fetchMessages(targetConversationId));
  }, [qc]);

  /**
   * Canonical reconciliation. `announce` shows "Reconnecting to Ari…" (P2-7):
   * only after transport uncertainty, reconnect, foreground, or failed Stop
   * transports — never for a definitive server answer.
   */
  const reconcileOne = useCallback(async (clientTurnId: string, announce = true): Promise<void> => {
    const before = turnsRef.current.find((turn) => turn.clientTurnId === clientTurnId);
    if (!before) return;
    const scopeEpoch = brandEpoch.current;
    if (announce) patchTurn(clientTurnId, { reconciling: true });
    try {
      const canonical = await fetchAriTurnStatus(clientTurnId);
      if (!isCurrentAriTurnEpoch(before.epoch, scopeEpoch, brandEpoch.current)) return;
      const status = canonical.attempt.status;
      const delivery = status === "stopped" ? "stopped" as const
        : status === "failed" ? "failed" as const
        : status === "completed" ? "sent" as const
        : before.delivery === "failed" ? "sending" as const : before.delivery;
      patchTurn(clientTurnId, {
        conversationId: canonical.attempt.conversation_id,
        accepted: true,
        delivery,
        attemptStatus: status,
        attemptNumber: canonical.attempt.attempt_number,
        events: mergeEvents(before.events, canonical.events),
        reconciling: false,
        ...(status === "failed"
          ? { errorCode: canonical.attempt.error_code ?? "ACCEPTED_RESPONSE_FAILED", errorMessage: "Ari couldn’t finish this response. Your message is safe." }
          : status === "stopped"
            ? { errorCode: "TURN_STOPPED", errorMessage: "Ari stopped. Your message is still here." }
            : { errorCode: null, errorMessage: null }),
      });
      if (
        canonical.attempt.conversation_id !== conversationIdRef.current &&
        shouldFollowTurnConversation(conversationIdRef.current, before.originConversationId)
      ) {
        selectConversation(canonical.attempt.conversation_id);
      }
      if (status === "completed") {
        await refreshCanonicalMessages(canonical.attempt.conversation_id);
        if (!isCurrentAriTurnEpoch(before.epoch, scopeEpoch, brandEpoch.current)) return;
      }
    } catch {
      if (!isCurrentAriTurnEpoch(before.epoch, scopeEpoch, brandEpoch.current)) return;
      patchTurn(clientTurnId, {
        reconciling: announce,
        attemptStatus: "reconciliation_required",
        errorCode: before.errorCode ?? "RECONCILIATION_REQUIRED",
        errorMessage: before.errorMessage,
      });
    }
  }, [patchTurn, refreshCanonicalMessages, selectConversation]);

  const reconcileActiveTurns = useCallback(async (): Promise<void> => {
    const candidates = turnsRef.current.filter((turn) =>
      turn.delivery === "sending" || turn.reconciling || turn.attemptStatus === "reconciliation_required");
    await Promise.all(candidates.map((turn) => reconcileOne(turn.clientTurnId)));
  }, [reconcileOne]);

  useEffect(() => { if (online === true) void reconcileActiveTurns(); }, [online, reconcileActiveTurns]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reconcileActiveTurns();
    });
    return () => subscription.remove();
  }, [reconcileActiveTurns]);

  const executeTurn = useCallback(async (turn: LocalTurn): Promise<AgentChatResponse> => {
    const { payload, clientTurnId } = turn;
    try {
      const response = await sendAgentMessage({
        conversation_id: turn.conversationId,
        ...payload,
        client_turn_id: clientTurnId,
        client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        locale: Intl.DateTimeFormat().resolvedOptions().locale || "en-US",
        brand_id: brandId,
      });
      if (turn.epoch !== brandEpoch.current) return response;
      if (response.kind === "error") {
        // A definitive answer, not transport uncertainty: reconcile quietly.
        await reconcileOne(clientTurnId, false);
        const reconciled = turnsRef.current.find((candidate) => candidate.clientTurnId === clientTurnId);
        if (!reconciled?.accepted) {
          const stoppedBeforeAcceptance = response.code === "TURN_STOPPED" &&
            response.message.startsWith("Message not sent.");
          patchTurn(clientTurnId, {
            delivery: stoppedBeforeAcceptance ? "failed" : response.code === "TURN_STOPPED" ? "stopped" : "failed",
            attemptStatus: stoppedBeforeAcceptance ? null : response.code === "TURN_STOPPED" ? "stopped" : null,
            errorCode: stoppedBeforeAcceptance ? "STOP_BEFORE_ACCEPTANCE" : response.code,
            errorMessage: response.code === "TRANSPORT_UNAVAILABLE"
              ? "Message not sent. Check your connection and try again." : response.message,
            reconciling: false,
          });
        }
        const ownsScreenRecovery = [
          "BRAND_CONTEXT_REQUIRED",
          "BRAND_ACCESS_DENIED",
          "CONVERSATION_BRAND_MISMATCH",
          "LEGACY_CONVERSATION_UNSCOPED",
          "TENANT_SCOPE_UNAVAILABLE",
          "UNAUTHORIZED",
        ].includes(response.code);
        setErrorCode(ownsScreenRecovery ? response.code : null);
        setErrorMessage(null);
        captureAriTurnOutcome({ surface: surfaceRef.current, outcome: "failed", errorCode: response.code });
        return response;
      }
      const targetConversationId = response.conversation_id;
      patchTurn(clientTurnId, {
        conversationId: targetConversationId,
        accepted: true,
        delivery: "sent",
        attemptStatus: response.attempt_status,
        errorCode: null,
        errorMessage: null,
        reconciling: false,
      });
      if (response.conversation_id !== turn.originConversationId) {
        void qc.invalidateQueries({ queryKey: agentQueryKeys.conversations(brandId) });
      }
      // D-2: never pull the person out of a conversation they navigated to.
      if (
        response.conversation_id !== conversationIdRef.current &&
        shouldFollowTurnConversation(conversationIdRef.current, turn.originConversationId)
      ) {
        selectConversation(response.conversation_id);
      }
      if (response.kind === "pending_action") {
        setPendingAction({ pending_action_id: response.pending_action_id, tool_name: response.tool_name, tool_args: response.tool_args });
      }
      await refreshCanonicalMessages(targetConversationId);
      setErrorCode(null);
      setErrorMessage(null);
      captureAriTurnOutcome({ surface: surfaceRef.current, outcome: "accepted" });
      return response;
    } catch {
      if (turn.epoch !== brandEpoch.current) {
        return { kind: "error", code: "SCOPE_CHANGED", message: "Brand changed." };
      }
      patchTurn(clientTurnId, { reconciling: true });
      await reconcileOne(clientTurnId);
      const canonical = turnsRef.current.find((candidate) => candidate.clientTurnId === clientTurnId);
      if (!canonical?.accepted) {
        patchTurn(clientTurnId, {
          delivery: "failed",
          errorCode: "TRANSPORT_UNAVAILABLE",
          errorMessage: "Message not sent. Check your connection and try again.",
          reconciling: false,
        });
      }
      setErrorCode(null);
      setErrorMessage(null);
      captureAriTurnOutcome({ surface: surfaceRef.current, outcome: "failed", errorCode: "TRANSPORT_UNAVAILABLE" });
      return { kind: "error", code: "TRANSPORT_UNAVAILABLE", message: "Message not sent. Check your connection and try again." };
    }
  }, [brandId, patchTurn, qc, reconcileOne, refreshCanonicalMessages, selectConversation]);

  const sendTurn = useCallback((
    displayText: string,
    payload: TurnPayload,
    attachments: AriAttachmentDraft[] = [],
    clientTurnId = newClientTurnId(),
  ): Promise<AgentChatResponse> => {
    if (sameFrameLock.current) return Promise.resolve({ kind: "error", code: "IN_FLIGHT", message: "Ari is already sending that message." });
    sameFrameLock.current = true;
    queueMicrotask(() => { sameFrameLock.current = false; });

    const intent = createAriClientIntent({
      intent: "send",
      conversationId,
      brandId,
      draftText: displayText,
    }, () => clientTurnId);
    const currentIntent = sendIntentRef.current?.stableId === clientTurnId
      ? sendIntentRef.current
      : intent;
    const dispatchGate = canDispatchAriIntent(currentIntent, online !== false);
    if (!dispatchGate.allowed) {
      return Promise.resolve({
        kind: "error",
        code: dispatchGate.reason === "offline" ? "OFFLINE" : dispatchGate.reason === "server_reconcile" ? "RECONCILIATION_REQUIRED" : "IN_FLIGHT",
        message: dispatchGate.reason === "offline"
          ? "You’re offline. Reconnect to send."
          : dispatchGate.reason === "server_reconcile"
          ? "Ari is verifying the result before showing it as complete."
          : "Ari is already sending that message.",
      });
    }
    sendIntentRef.current = reduceAriClientIntent(currentIntent, { type: "dispatch_started" });
    const existing = turnsRef.current.find((turn) => turn.clientTurnId === clientTurnId);
    const turn: LocalTurn = existing ? {
      ...existing,
      delivery: "sending",
      errorCode: null,
      errorMessage: null,
      reconciling: false,
      startedAt: Date.now(),
    } : {
      clientTurnId,
      localId: `local-turn-${clientTurnId}`,
      conversationId,
      originConversationId: conversationId,
      displayText,
      payload,
      attachments,
      delivery: "sending",
      accepted: false,
      attemptStatus: null,
      attemptNumber: 1,
      events: [],
      errorCode: null,
      errorMessage: null,
      reconciling: false,
      startedAt: Date.now(),
      createdAt: new Date().toISOString(),
      epoch: brandEpoch.current,
    };
    replaceTurns((current) => current.some((candidate) => candidate.clientTurnId === clientTurnId)
      ? current.map((candidate) => candidate.clientTurnId === clientTurnId ? turn : candidate)
      : [...current, turn]);
    setErrorMessage(null);
    setErrorCode(null);
    installSubscription(clientTurnId);
    captureAriTurnOutcome({ surface: surfaceRef.current, outcome: existing ? "retried" : "started" });
    return executeTurn(turn).then((response) => {
      if (sendIntentRef.current?.stableId === clientTurnId) {
        sendIntentRef.current = response.kind === "error"
          ? reduceAriClientIntent(sendIntentRef.current, { type: "transport_uncertain", code: response.code })
          : { ...sendIntentRef.current, state: "terminal", lastCode: "PROPOSAL_READY", retryAt: null };
      }
      return response;
    }).catch((error: unknown) => {
      if (sendIntentRef.current?.stableId === clientTurnId) {
        sendIntentRef.current = reduceAriClientIntent(sendIntentRef.current, {
          type: "transport_uncertain",
          code: "TRANSPORT_UNAVAILABLE",
        });
      }
      throw error;
    });
  }, [brandId, conversationId, executeTurn, installSubscription, online, replaceTurns]);

  const sendMessage = useCallback((text: string, attachments: AriAttachmentDraft[] = []) => {
    const attachmentIds = attachments.map((attachment) => attachment.attachmentId).filter((id): id is string => !!id);
    return sendTurn(text, {
      ...(text.trim() ? { message: text.trim() } : {}),
      ...(attachmentIds.length ? { attachment_ids: attachmentIds } : {}),
    }, attachments);
  }, [sendTurn]);

  const sendChoice = useCallback((submission: AgentChoiceSubmissionV2, label: string) =>
    sendTurn(label, { choice_response: submission }), [sendTurn]);

  const retryTurn = useCallback(async (clientTurnId: string): Promise<AgentChatResponse | null> => {
    const turn = turnsRef.current.find((candidate) => candidate.clientTurnId === clientTurnId);
    if (!turn || !["failed", "stopped"].includes(turn.delivery)) return null;
    if (turn.accepted || turn.errorCode === "STOP_BEFORE_ACCEPTANCE") {
      try {
        // The retry RPC creates the next server attempt; clear the old
        // in-flight intent before dispatching that invocation.
        if (sendIntentRef.current?.stableId === clientTurnId) sendIntentRef.current = null;
        const retried = await retryAriTurn(clientTurnId);
        patchTurn(clientTurnId, {
          accepted: retried.accepted !== false,
          attemptNumber: Math.max(1, retried.attempt.attempt_number),
          attemptStatus: retried.accepted === false ? null : retried.attempt.status,
          events: [],
          delivery: "sending",
          errorCode: null,
          errorMessage: null,
          startedAt: Date.now(),
        });
      } catch {
        await reconcileOne(clientTurnId);
        return null;
      }
    }
    const latest = turnsRef.current.find((candidate) => candidate.clientTurnId === clientTurnId) ?? turn;
    const failed = turnMessage(latest);
    const payload = latest.payload;
    return sendTurn((failed.content as { text?: string }).text ?? latest.displayText, payload, latest.attachments, clientTurnId);
  }, [patchTurn, reconcileOne, sendTurn]);

  const retryTenantRecovery = useCallback(async (): Promise<AgentChatResponse | null> => {
    const recoverable = [...turnsRef.current].reverse().find((turn) =>
      turn.delivery === "failed" && turn.errorCode === "TENANT_SCOPE_UNAVAILABLE" &&
      isTurnInSelectedConversation(turn.conversationId, conversationIdRef.current)
    );
    return recoverable ? retryTurn(recoverable.clientTurnId) : null;
  }, [retryTurn]);

  const editTurn = useCallback((clientTurnId: string): AriEditableTurn | null => {
    const turn = turnsRef.current.find((candidate) => candidate.clientTurnId === clientTurnId);
    if (!turn || turn.accepted || turn.delivery !== "failed") return null;
    replaceTurns((current) => current.filter((candidate) => candidate.clientTurnId !== clientTurnId));
    subscriptions.current.get(clientTurnId)?.();
    subscriptions.current.delete(clientTurnId);
    captureAriTurnOutcome({ surface: surfaceRef.current, outcome: "edited" });
    return { text: turn.displayText, attachments: turn.attachments };
  }, [replaceTurns]);

  const discardTurn = useCallback((clientTurnId: string): void => {
    const turn = turnsRef.current.find((candidate) => candidate.clientTurnId === clientTurnId);
    if (!turn || turn.accepted) return;
    replaceTurns((current) => current.filter((candidate) => candidate.clientTurnId !== clientTurnId));
    subscriptions.current.get(clientTurnId)?.();
    subscriptions.current.delete(clientTurnId);
    turn.attachments.forEach((attachment) => {
      if (attachment.attachmentId) void discardAriAttachment(attachment.attachmentId).catch(() => undefined);
    });
    captureAriTurnOutcome({ surface: surfaceRef.current, outcome: "discarded" });
  }, [replaceTurns]);

  const stopTurn = useCallback(async (clientTurnId: string): Promise<void> => {
    const turn = turnsRef.current.find((candidate) => candidate.clientTurnId === clientTurnId);
    // D-1 / SC-R1-D1-5: a completed attempt is never cancelled.
    if (!turn || !isAriTurnStoppable(turn)) return;
    // P2-7: while Stop is pending the callout keeps its last truthful label.
    let stopResult: Awaited<ReturnType<typeof stopAriTurn>> | null = null;
    let stopped = false;
    for (let attempt = 0; attempt < 3 && !stopped; attempt += 1) {
      try {
        stopResult = await stopAriTurn(clientTurnId);
        stopped = true;
      } catch {
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
    if (!stopped) {
      patchTurn(clientTurnId, {
        reconciling: true,
        errorCode: "STOP_RECONCILING",
        errorMessage: null,
      });
      await reconcileOne(clientTurnId);
      return;
    }
    if (stopResult?.accepted === false) {
      patchTurn(clientTurnId, {
        accepted: false,
        delivery: "failed",
        attemptStatus: null,
        reconciling: false,
        errorCode: "STOP_BEFORE_ACCEPTANCE",
        errorMessage: "Message not sent. Check your connection and try again.",
      });
      captureAriTurnOutcome({ surface: surfaceRef.current, outcome: "cancelled" });
      return;
    }
    patchTurn(clientTurnId, {
      accepted: true,
      delivery: "stopped",
      attemptStatus: "stopped",
      reconciling: false,
      errorCode: "TURN_STOPPED",
      errorMessage: "Ari stopped. Your message is still here.",
    });
    captureAriTurnOutcome({ surface: surfaceRef.current, outcome: "cancelled" });
    await reconcileOne(clientTurnId, false);
  }, [patchTurn, reconcileOne]);

  const clearPendingAction = useCallback(() => setPendingAction(null), []);
  /**
   * D-1 / SC-R1-D1-4: Confirm starts watching the proposal's own turn. The
   * callout appears only once `approved_action_started` arrives for it; if the
   * turn is not in this session's registry (for example after a reload), the
   * screen subscribes to that turn now.
   */
  const beginConfirmedActivity = useCallback((pendingActionId: string): void => {
    const proposal = [...(messagesQuery.data ?? [])].reverse().find((message) =>
      message.role === "assistant" && message.tool_calls?.pending_action_id === pendingActionId
    );
    const clientTurnId = proposal?.client_turn_id ?? null;
    if (!clientTurnId) return;
    const local = turnsRef.current.find((turn) => turn.clientTurnId === clientTurnId);
    const watermarkSequence = local
      ? local.events.reduce((max, event) =>
        event.attempt_number === local.attemptNumber ? Math.max(max, event.sequence) : max, 0)
      : 0;
    setConfirmation({
      clientTurnId,
      conversationId: proposal?.conversation_id ?? conversationIdRef.current,
      watermark: { attemptNumber: local?.attemptNumber ?? 1, sequence: watermarkSequence },
      events: [],
      startedAt: Date.now(),
    });
    if (!local && !subscriptions.current.has(clientTurnId)) {
      confirmationSubscription.current?.();
      confirmationSubscription.current = subscribeAriTurnActivity(clientTurnId, (event) => {
        routeConfirmationEvent(clientTurnId, event, null);
      });
    }
  }, [messagesQuery.data, routeConfirmationEvent, setConfirmation]);

  const finishConfirmedActivity = useCallback((): void => {
    confirmationSubscription.current?.();
    confirmationSubscription.current = null;
    setConfirmation(null);
  }, [setConfirmation]);
  const clearErrorMessage = useCallback(() => { setErrorMessage(null); setErrorCode(null); }, []);
  const currentScope = stateBrandId === brandId;
  const serverMessages = currentScope ? messagesQuery.data ?? [] : [];

  useEffect(() => {
    if (!currentScope) return;
    const resolved = new Set(serverMessages.filter((message) => message.role === "tool")
      .map((message) => (message.tool_results as { pending_action_id?: unknown } | null)?.pending_action_id)
      .filter((id): id is string => typeof id === "string"));
    let unresolved: PendingActionView | null = null;
    for (const message of serverMessages) {
      const call = message.role === "assistant" ? message.tool_calls : null;
      if (call && !resolved.has(call.pending_action_id)) {
        unresolved = { pending_action_id: call.pending_action_id, tool_name: call.tool_name, tool_args: call.args };
      }
    }
    setPendingAction(unresolved);
  }, [currentScope, serverMessages]);

  // D-2: only the selected conversation's local turns render anywhere.
  const scopedTurns = useMemo(() => currentScope
    ? turns.filter((turn) => isTurnInSelectedConversation(turn.conversationId, conversationId))
    : [], [conversationId, currentScope, turns]);
  const localMessages = scopedTurns.map(turnMessage);
  const liveLocalMessages = localMessages.filter((local) => !serverMessages.some((server) => canonicalIdentityMatch(server, local)));
  const turnById = new Map(turns.map((turn) => [turn.clientTurnId, turn]));
  const decoratedServerMessages = serverMessages.map((message) => {
    if (!message.client_turn_id) return message;
    const turn = turnById.get(message.client_turn_id);
    if (!turn) return message;
    if (message.role === "assistant" && turn.attemptStatus === "completed") {
      return { ...message, content: { ...message.content, local_reveal: true } };
    }
    if (message.role !== "user") return message;
    return { ...message, content: { ...message.content, local_delivery: turn.delivery === "failed" ? "sent" : ariRowDelivery(turn.delivery, turn.accepted), ...(turn.errorMessage ? { local_error: turn.errorMessage } : {}) } };
  });
  const messages = [...decoratedServerMessages, ...liveLocalMessages];

  const activeTurn = useMemo<AriActiveTurn | null>(() => {
    if (!currentScope) return null;
    if (
      confirmation &&
      isTurnInSelectedConversation(confirmation.conversationId, conversationId)
    ) {
      const confirmationEvent = latestLabelledActivityEvent(
        confirmation.events,
        confirmation.events[confirmation.events.length - 1]?.attempt_number ?? confirmation.watermark.attemptNumber,
        confirmation.watermark,
      );
      if (confirmationEvent) {
        return {
          clientTurnId: confirmation.clientTurnId,
          accepted: true,
          delivery: "sent",
          event: confirmationEvent,
          errorCode: null,
          errorMessage: null,
          reconciling: false,
          startedAt: confirmation.startedAt,
          stoppable: false,
        };
      }
    }
    const candidate = [...scopedTurns].reverse().find(isOrdinaryTurnActivityVisible);
    if (!candidate) return null;
    return {
      clientTurnId: candidate.clientTurnId,
      accepted: candidate.accepted,
      delivery: candidate.delivery,
      event: latestLabelledActivityEvent(candidate.events, candidate.attemptNumber),
      errorCode: candidate.errorCode,
      errorMessage: candidate.errorMessage,
      reconciling: candidate.reconciling,
      startedAt: candidate.startedAt,
      stoppable: isAriTurnStoppable(candidate),
    };
  }, [confirmation, conversationId, currentScope, scopedTurns]);

  return {
    messages,
    isLoadingMessages: messagesQuery.isLoading,
    sendMessage,
    sendChoice,
    retryTurn,
    retryTenantRecovery,
    editTurn,
    discardTurn,
    stopTurn,
    beginConfirmedActivity,
    finishConfirmedActivity,
    reconcileActiveTurns,
    activeTurn,
    isSending: currentScope && turns.some((turn) => turn.delivery === "sending"),
    pendingAction: currentScope ? pendingAction : null,
    clearPendingAction,
    conversationId: currentScope ? conversationId : null,
    setConversationId: selectConversation,
    brandId,
    errorMessage: currentScope ? errorMessage : null,
    errorCode: currentScope ? errorCode : null,
    clearErrorMessage,
    setSurface,
  };
}
