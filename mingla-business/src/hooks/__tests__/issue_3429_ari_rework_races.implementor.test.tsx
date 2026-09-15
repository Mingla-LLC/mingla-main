/** #3429 rework — executable deferred-promise ownership and recovery races. */

import React from "react";

type Renderer = { update: (node: React.ReactElement) => void };
const { create, act } = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSendAgentMessage = jest.fn();
const mockFetchMessages = jest.fn(async () => []);
const mockFetchAriTurnStatus = jest.fn<Promise<unknown>, [string]>(async () => {
  throw new Error("status unavailable");
});
const mockStopAriTurn = jest.fn<Promise<unknown>, [string]>(async () => {
  throw new Error("transport unavailable");
});
const mockRetryAriTurn = jest.fn<Promise<unknown>, [string]>();
const mockQueryResult = { data: [] as unknown[], isLoading: false };
const mockQueryClient = {
  invalidateQueries: jest.fn(),
  setQueryData: jest.fn(),
};

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
  subscribeAriTurnActivity: () => jest.fn(),
}));
jest.mock("../../services/ariPolishAnalytics", () => ({
  captureAriActivityDisplayed: jest.fn(),
  captureAriTurnOutcome: jest.fn(),
}));
jest.mock("../../services/ariAttachmentService", () => ({
  discardAriAttachment: jest.fn(),
}));

import { useAgentChat, type UseAgentChatResult } from "../useAgentChat";
import { isCurrentAriTurnEpoch } from "../../services/agentReliability";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

let latest: UseAgentChatResult | null = null;

function Probe({ brandId }: { brandId: string | null }): null {
  latest = useAgentChat(null, brandId);
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("#3429 executable delivery races", () => {
  beforeEach(() => {
    latest = null;
    jest.clearAllMocks();
  });

  it("rejects a deferred completion after its brand epoch changes", async () => {
    const completion = deferred<number>();
    const turnEpoch = 7;
    const applyAfterAwait = async (): Promise<boolean> => {
      const observedEpoch = await completion.promise;
      return isCurrentAriTurnEpoch(turnEpoch, observedEpoch, 8);
    };
    const work = applyAfterAwait();
    completion.resolve(7);
    await expect(work).resolves.toBe(false);
  });

  it("retries a tenant-scope failure with the original turn identity and attachment ids", async () => {
    const attachment = {
      localId: "attachment-local",
      attachmentId: "attachment-server",
      uri: "file:///report.pdf",
      name: "report.pdf",
      mimeType: "application/pdf",
      fileType: "pdf" as const,
      sizeBytes: 12,
      state: "ready" as const,
      errorCode: null,
      errorMessage: null,
    };
    mockSendAgentMessage
      .mockResolvedValueOnce({
        kind: "error",
        code: "TENANT_SCOPE_UNAVAILABLE",
        message: "scope pending",
      })
      .mockResolvedValueOnce({
        kind: "text",
        text: "retried",
        conversation_id: "conversation-a",
        message_id: "message-a",
        task_state_revision: 1,
        client_turn_id: "server-turn",
        attempt_status: "completed",
        conversation_title: "A",
      });
    await act(async () => { create(<Probe brandId="brand-a" />); });
    await act(async () => { await latest!.sendMessage("Use the report", [attachment]); });
    expect(latest!.errorCode).toBe("TENANT_SCOPE_UNAVAILABLE");
    await act(async () => { await latest!.retryTenantRecovery(); });

    expect(mockSendAgentMessage).toHaveBeenCalledTimes(2);
    const [first, second] = mockSendAgentMessage.mock.calls.map(([request]) => request as Record<string, unknown>);
    expect(second.client_turn_id).toBe(first.client_turn_id);
    expect(second.attachment_ids).toEqual(["attachment-server"]);
  });

});

function textResponse(clientTurnId: string, conversationId = "conversation-a") {
  return {
    kind: "text" as const,
    text: "Ari finished",
    conversation_id: conversationId,
    message_id: `assistant-${clientTurnId}`,
    task_state_revision: 2,
    client_turn_id: clientTurnId,
    attempt_status: "completed" as const,
    conversation_title: "Ari conversation",
  };
}

function canonicalStatus(
  clientTurnId: string,
  status: "accepted" | "running" | "stopped" | "completed" | "failed",
  attemptNumber = 1,
) {
  return {
    attempt: {
      id: `attempt-${attemptNumber}`,
      conversation_id: "conversation-a",
      user_message_id: `user-${clientTurnId}`,
      client_turn_id: clientTurnId,
      attempt_number: attemptNumber,
      status,
      error_code: status === "failed" ? "PROVIDER_UNAVAILABLE" : null,
      accepted_at: "2026-09-15T12:00:00.000Z",
      started_at: "2026-09-15T12:00:01.000Z",
      terminal_at: ["stopped", "completed", "failed"].includes(status)
        ? "2026-09-15T12:00:02.000Z"
        : null,
      updated_at: "2026-09-15T12:00:02.000Z",
    },
    events: [],
  };
}

describe("#3429 useAgentChat deferred transport behavior", () => {
  beforeEach(() => {
    latest = null;
    jest.clearAllMocks();
    mockSendAgentMessage.mockReset();
    mockFetchAriTurnStatus.mockReset();
    mockFetchAriTurnStatus.mockImplementation(async (): Promise<unknown> => {
      throw new Error("status unavailable");
    });
    mockStopAriTurn.mockReset();
    mockStopAriTurn.mockImplementation(async (): Promise<unknown> => {
      throw new Error("transport unavailable");
    });
    mockRetryAriTurn.mockReset();
  });

  it("does not dispatch a duplicate retry while the original send remains pending", async () => {
    const pending = deferred<ReturnType<typeof textResponse>>();
    mockSendAgentMessage.mockImplementationOnce(() => pending.promise);
    await act(async () => { create(<Probe brandId="brand-a" />); });

    let original!: Promise<unknown>;
    act(() => { original = latest!.sendMessage("Plan the launch"); });
    await flush();
    const request = mockSendAgentMessage.mock.calls[0][0] as Record<string, unknown>;
    const clientTurnId = request.client_turn_id as string;

    let retryResult: unknown;
    await act(async () => { retryResult = await latest!.retryTurn(clientTurnId); });
    expect(retryResult).toBeNull();
    expect(mockRetryAriTurn).not.toHaveBeenCalled();
    expect(mockSendAgentMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(textResponse(clientTurnId));
      await original;
    });
    expect(mockSendAgentMessage).toHaveBeenCalledTimes(1);
  });

  it.each(["failed", "stopped"] as const)(
    "retries a canonical %s turn in place only after retry authority is granted",
    async (terminalStatus) => {
      const order: string[] = [];
      mockSendAgentMessage
        .mockResolvedValueOnce({
          kind: "error",
          code: "TRANSPORT_UNAVAILABLE",
          message: "transport uncertain",
        })
        .mockImplementationOnce(async (request: Record<string, unknown>) => {
          order.push("retry-dispatch");
          return textResponse(request.client_turn_id as string);
        });
      mockFetchAriTurnStatus.mockImplementation(async (clientTurnId): Promise<unknown> =>
        canonicalStatus(clientTurnId, terminalStatus));
      await act(async () => { create(<Probe brandId="brand-a" />); });
      await act(async () => { await latest!.sendMessage("Retry this safely"); });
      const first = mockSendAgentMessage.mock.calls[0][0] as Record<string, unknown>;
      const clientTurnId = first.client_turn_id as string;

      mockRetryAriTurn.mockImplementationOnce(async (retriedId): Promise<unknown> => {
        order.push("retry-control");
        expect(retriedId).toBe(clientTurnId);
        return { ...canonicalStatus(clientTurnId, "accepted", 2), accepted: true };
      });
      await act(async () => { await latest!.retryTurn(clientTurnId); });

      expect(order).toEqual(["retry-control", "retry-dispatch"]);
      expect(mockSendAgentMessage).toHaveBeenCalledTimes(2);
      const second = mockSendAgentMessage.mock.calls[1][0] as Record<string, unknown>;
      expect(second.client_turn_id).toBe(clientTurnId);
    },
  );

  it("keeps stop transport uncertainty reconciling after three failures", async () => {
    const pending = deferred<ReturnType<typeof textResponse>>();
    mockSendAgentMessage.mockImplementationOnce(() => pending.promise);
    mockStopAriTurn.mockRejectedValue(new Error("transport unavailable"));
    mockFetchAriTurnStatus.mockRejectedValue(new Error("status unavailable"));
    await act(async () => { create(<Probe brandId="brand-a" />); });

    let original!: Promise<unknown>;
    act(() => { original = latest!.sendMessage("Stop if I ask"); });
    await flush();
    const request = mockSendAgentMessage.mock.calls[0][0] as Record<string, unknown>;
    const clientTurnId = request.client_turn_id as string;
    await act(async () => { await latest!.stopTurn(clientTurnId); });

    expect(mockStopAriTurn).toHaveBeenCalledTimes(3);
    expect(latest!.activeTurn).toMatchObject({
      clientTurnId,
      delivery: "sending",
      reconciling: true,
      errorCode: "STOP_RECONCILING",
    });
    expect(latest!.activeTurn?.delivery).not.toBe("stopped");

    await act(async () => {
      pending.resolve(textResponse(clientTurnId));
      await original;
    });
  });

  it("reconciliation records canonical acceptance and failed terminal status", async () => {
    const pending = deferred<ReturnType<typeof textResponse>>();
    mockSendAgentMessage.mockImplementationOnce(() => pending.promise);
    await act(async () => { create(<Probe brandId="brand-a" />); });

    let original!: Promise<unknown>;
    act(() => { original = latest!.sendMessage("Reconcile this turn"); });
    await flush();
    const request = mockSendAgentMessage.mock.calls[0][0] as Record<string, unknown>;
    const clientTurnId = request.client_turn_id as string;
    mockFetchAriTurnStatus.mockResolvedValue(canonicalStatus(clientTurnId, "failed"));
    await act(async () => { await latest!.reconcileActiveTurns(); });

    expect(latest!.activeTurn).toMatchObject({
      clientTurnId,
      accepted: true,
      delivery: "failed",
      errorCode: "PROVIDER_UNAVAILABLE",
      reconciling: false,
    });
    expect(latest!.messages).toHaveLength(1);
    expect(latest!.messages[0].content).toMatchObject({ local_delivery: "failed" });

    await act(async () => {
      pending.resolve(textResponse(clientTurnId));
      await original;
    });
  });

  it("reconciliation keeps a canonically accepted attempt active without inventing completion", async () => {
    const pending = deferred<ReturnType<typeof textResponse>>();
    mockSendAgentMessage.mockImplementationOnce(() => pending.promise);
    await act(async () => { create(<Probe brandId="brand-a" />); });

    let original!: Promise<unknown>;
    act(() => { original = latest!.sendMessage("Confirm acceptance only"); });
    await flush();
    const request = mockSendAgentMessage.mock.calls[0][0] as Record<string, unknown>;
    const clientTurnId = request.client_turn_id as string;
    mockFetchAriTurnStatus.mockResolvedValue(canonicalStatus(clientTurnId, "accepted"));
    await act(async () => { await latest!.reconcileActiveTurns(); });

    expect(latest!.activeTurn).toMatchObject({
      clientTurnId,
      accepted: true,
      delivery: "sending",
      reconciling: false,
      errorCode: null,
    });

    await act(async () => {
      pending.resolve(textResponse(clientTurnId));
      await original;
    });
  });

  it("ignores a late original-brand completion after a brand rerender", async () => {
    const pending = deferred<ReturnType<typeof textResponse>>();
    mockSendAgentMessage.mockImplementationOnce(() => pending.promise);
    let renderer!: Renderer;
    await act(async () => { renderer = create(<Probe brandId="brand-a" />); });

    let original!: Promise<unknown>;
    act(() => { original = latest!.sendMessage("Old brand turn"); });
    await flush();
    const request = mockSendAgentMessage.mock.calls[0][0] as Record<string, unknown>;
    const clientTurnId = request.client_turn_id as string;
    await act(async () => { renderer.update(<Probe brandId="brand-b" />); });

    await act(async () => {
      pending.resolve(textResponse(clientTurnId, "old-brand-conversation"));
      await original;
    });
    expect(latest!.brandId).toBe("brand-b");
    expect(latest!.conversationId).toBeNull();
    expect(latest!.messages).toEqual([]);
    expect(mockFetchMessages).not.toHaveBeenCalled();
  });
});
