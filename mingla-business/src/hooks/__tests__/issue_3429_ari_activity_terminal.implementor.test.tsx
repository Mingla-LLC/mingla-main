/**
 * #3429 REWORK-1 implementor proof — D-1, P2-1, P2-7.
 *
 * Drives the real useAgentChat with a captured Realtime activity callback
 * (the rework_races harness): an ordinary answer ends its activity, only an
 * approved action owns a confirmation callout, the row reads Sent on
 * acceptance, and three failed Stop transports reconcile without inventing
 * "checking" copy.
 */

import React from "react";

type Renderer = { update: (node: React.ReactElement) => void };
const { create, act } = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ActivityCallback = (event: Record<string, unknown>) => void;

const mockSendAgentMessage = jest.fn();
const mockFetchMessages = jest.fn(async () => []);
const mockFetchAriTurnStatus = jest.fn<Promise<unknown>, [string]>(async () => {
  throw new Error("status unavailable");
});
const mockStopAriTurn = jest.fn<Promise<unknown>, [string]>(async () => {
  throw new Error("transport unavailable");
});
const mockRetryAriTurn = jest.fn<Promise<unknown>, [string]>();
const mockActivityCallbacks = new Map<string, ActivityCallback>();
const mockQueryResult = { data: [] as unknown[], isLoading: false };
const mockQueryClient = { invalidateQueries: jest.fn(), setQueryData: jest.fn() };

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => mockQueryResult,
  useQueryClient: () => mockQueryClient,
}));
jest.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: jest.fn() }) },
}));
jest.mock("../../components/ui/useShareNetworkState", () => ({
  useShareNetworkState: () => true,
}));
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));
jest.mock("../../services/agentChatService", () => ({
  fetchMessages: () => mockFetchMessages(),
  sendAgentMessage: (request: unknown) => mockSendAgentMessage(request),
}));
jest.mock("../../services/ariTurnService", () => ({
  fetchAriTurnStatus: (clientTurnId: string) => mockFetchAriTurnStatus(clientTurnId),
  retryAriTurn: (clientTurnId: string) => mockRetryAriTurn(clientTurnId),
  stopAriTurn: (clientTurnId: string) => mockStopAriTurn(clientTurnId),
  subscribeAriTurnActivity: (clientTurnId: string, onEvent: ActivityCallback) => {
    mockActivityCallbacks.set(clientTurnId, onEvent);
    return jest.fn();
  },
}));
jest.mock("../../services/ariPolishAnalytics", () => ({
  captureAriActivityDisplayed: jest.fn(),
  captureAriTurnOutcome: jest.fn(),
}));
jest.mock("../../services/ariAttachmentService", () => ({
  discardAriAttachment: jest.fn(),
}));

import { useAgentChat, type UseAgentChatResult } from "../useAgentChat";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

let latest: UseAgentChatResult | null = null;

function Probe({ brandId }: { brandId: string | null }): null {
  latest = useAgentChat(null, brandId);
  return null;
}

function textResponse(clientTurnId: string) {
  return {
    kind: "text" as const,
    text: "Ari finished",
    conversation_id: "conversation-a",
    message_id: `assistant-${clientTurnId}`,
    task_state_revision: 2,
    client_turn_id: clientTurnId,
    attempt_status: "completed" as const,
    conversation_title: "Ari conversation",
  };
}

function event(clientTurnId: string, sequence: number, eventType: string, attemptNumber = 1) {
  return {
    id: `${clientTurnId}-${attemptNumber}-${sequence}`,
    attempt_number: attemptNumber,
    sequence,
    event_type: eventType,
    created_at: "2026-09-17T12:00:00.000Z",
    conversation_id: "conversation-a",
    client_turn_id: clientTurnId,
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

async function startPendingSend(text: string) {
  const pending = deferred<ReturnType<typeof textResponse>>();
  mockSendAgentMessage.mockImplementationOnce(() => pending.promise);
  await act(async () => { create(<Probe brandId="brand-a" />); });
  let original!: Promise<unknown>;
  act(() => { original = latest!.sendMessage(text); });
  await flush();
  const clientTurnId = (mockSendAgentMessage.mock.calls[0][0] as Record<string, unknown>).client_turn_id as string;
  const emit = async (payload: Record<string, unknown>) => {
    await act(async () => { mockActivityCallbacks.get(clientTurnId)!(payload); });
  };
  return { pending, original, clientTurnId, emit };
}

describe("#3429 D-1 activity ends with its work", () => {
  beforeEach(() => {
    latest = null;
    jest.clearAllMocks();
    mockActivityCallbacks.clear();
    mockSendAgentMessage.mockReset();
    mockStopAriTurn.mockReset();
    mockFetchAriTurnStatus.mockReset();
    mockFetchAriTurnStatus.mockRejectedValue(new Error("status unavailable"));
  });

  it("clears the callout after an ordinary answer even though finalizing_started arrived, and reads Sent on acceptance", async () => {
    const { pending, original, clientTurnId, emit } = await startPendingSend("Plan my week");
    expect(latest!.messages[0].content).toMatchObject({ local_delivery: "sending" });

    await emit(event(clientTurnId, 1, "accepted"));
    // P2-1: accepted while HTTP is still pending reads Sent; activity continues.
    expect(latest!.messages).toHaveLength(1);
    expect(latest!.messages[0].content).toMatchObject({ local_delivery: "sent" });
    expect(latest!.activeTurn).toMatchObject({ clientTurnId, accepted: true, stoppable: true });

    await emit(event(clientTurnId, 2, "model_started"));
    await emit(event(clientTurnId, 3, "finalizing_started"));
    expect(latest!.activeTurn?.event?.event_type).toBe("finalizing_started");

    await act(async () => {
      pending.resolve(textResponse(clientTurnId));
      await original;
    });
    expect(latest!.activeTurn).toBeNull();

    await emit(event(clientTurnId, 4, "response_ready"));
    expect(latest!.activeTurn).toBeNull();
  });

  it("ends the callout on response_ready even before the HTTP answer returns", async () => {
    const { pending, original, clientTurnId, emit } = await startPendingSend("Quick answer");
    await emit(event(clientTurnId, 1, "accepted"));
    await emit(event(clientTurnId, 2, "finalizing_started"));
    await emit(event(clientTurnId, 3, "response_ready"));
    expect(latest!.activeTurn).toBeNull();
    await act(async () => {
      pending.resolve(textResponse(clientTurnId));
      await original;
    });
    expect(latest!.activeTurn).toBeNull();
  });

  it("shows an approved-action callout only from approved_action_started until the confirmation finishes, and never offers Stop", async () => {
    const { pending, original, clientTurnId, emit } = await startPendingSend("Create the event");
    await emit(event(clientTurnId, 1, "accepted"));
    await emit(event(clientTurnId, 2, "finalizing_started"));
    await act(async () => {
      pending.resolve(textResponse(clientTurnId));
      await original;
    });
    expect(latest!.activeTurn).toBeNull();

    await emit(event(clientTurnId, 3, "response_ready"));
    await emit(event(clientTurnId, 4, "approved_action_started"));
    expect(latest!.activeTurn).toMatchObject({
      clientTurnId,
      stoppable: false,
      event: expect.objectContaining({ event_type: "approved_action_started" }),
    });

    await act(async () => { latest!.stopTurn(clientTurnId); });
    expect(mockStopAriTurn).not.toHaveBeenCalled();

    act(() => { latest!.finishConfirmedActivity(); });
    expect(latest!.activeTurn).toBeNull();
  });

  it("P2-7: three failed Stop transports reconcile without any 'checking' message", async () => {
    const { pending, original, clientTurnId, emit } = await startPendingSend("Stop when asked");
    await emit(event(clientTurnId, 1, "accepted"));
    mockStopAriTurn.mockRejectedValue(new Error("transport unavailable"));
    await act(async () => { await latest!.stopTurn(clientTurnId); });
    expect(mockStopAriTurn).toHaveBeenCalledTimes(3);
    expect(latest!.activeTurn).toMatchObject({ clientTurnId, reconciling: true, errorCode: "STOP_RECONCILING" });
    expect(latest!.activeTurn?.errorMessage ?? "").not.toMatch(/checking/i);
    await act(async () => {
      pending.resolve(textResponse(clientTurnId));
      await original;
    });
  });
});
