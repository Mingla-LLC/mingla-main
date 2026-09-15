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
const mockFetchAriTurnStatus = jest.fn(async () => {
  throw new Error("status unavailable");
});
const mockStopAriTurn = jest.fn(async () => {
  throw new Error("transport unavailable");
});
const mockRetryAriTurn = jest.fn();
const mockQueryResult = { data: [] as unknown[], isLoading: false };

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => mockQueryResult,
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    setQueryData: jest.fn(),
  }),
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
  fetchAriTurnStatus: () => mockFetchAriTurnStatus(),
  retryAriTurn: () => mockRetryAriTurn(),
  stopAriTurn: () => mockStopAriTurn(),
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
