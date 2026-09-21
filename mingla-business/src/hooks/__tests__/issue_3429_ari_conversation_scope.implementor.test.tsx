/**
 * #3429 REWORK-1 implementor proof — D-2 local turns are scoped to their
 * conversation, and a finishing turn never moves a person who navigated away.
 */

import React from "react";

const { create, act } = require("react-test-renderer") as {
  create: (node: React.ReactElement) => unknown;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSendAgentMessage = jest.fn();
const mockFetchMessages = jest.fn(async () => []);
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
  fetchAriTurnStatus: jest.fn(async () => { throw new Error("status unavailable"); }),
  retryAriTurn: jest.fn(),
  stopAriTurn: jest.fn(),
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

let latest: UseAgentChatResult | null = null;

function Probe(): null {
  latest = useAgentChat(null, "brand-a");
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function textResponse(clientTurnId: string, conversationId: string) {
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

describe("#3429 D-2 local turns belong to one conversation", () => {
  beforeEach(() => {
    latest = null;
    jest.clearAllMocks();
    mockSendAgentMessage.mockReset();
  });

  it("hides conversation A's rows and activity in B and restores them exactly once in A", async () => {
    mockSendAgentMessage.mockImplementationOnce(async (request: Record<string, unknown>) =>
      textResponse(request.client_turn_id as string, "conversation-a"));
    await act(async () => { create(<Probe />); });
    act(() => { latest!.setConversationId("conversation-a"); });
    await act(async () => { await latest!.sendMessage("Only for A"); });
    expect(latest!.conversationId).toBe("conversation-a");
    expect(latest!.messages).toHaveLength(1);

    act(() => { latest!.setConversationId("conversation-b"); });
    expect(latest!.messages).toEqual([]);
    expect(latest!.activeTurn).toBeNull();

    act(() => { latest!.setConversationId(null); });
    expect(latest!.messages).toEqual([]);

    act(() => { latest!.setConversationId("conversation-a"); });
    expect(latest!.messages).toHaveLength(1);
    expect((latest!.messages[0].content as { text?: string }).text).toBe("Only for A");
  });

  it("keeps the person in B when a New conversation turn finishes in C", async () => {
    const pending = deferred<ReturnType<typeof textResponse>>();
    mockSendAgentMessage.mockImplementationOnce(() => pending.promise);
    await act(async () => { create(<Probe />); });
    let original!: Promise<unknown>;
    act(() => { original = latest!.sendMessage("Start something new"); });
    await act(async () => { await Promise.resolve(); });
    expect(latest!.messages).toHaveLength(1);
    const clientTurnId = (mockSendAgentMessage.mock.calls[0][0] as Record<string, unknown>).client_turn_id as string;

    act(() => { latest!.setConversationId("conversation-b"); });
    expect(latest!.messages).toEqual([]);
    expect(latest!.activeTurn).toBeNull();
    // Single-flight gating stays global.
    expect(latest!.isSending).toBe(true);

    await act(async () => {
      pending.resolve(textResponse(clientTurnId, "conversation-c"));
      await original;
    });
    expect(latest!.conversationId).toBe("conversation-b");
    expect(latest!.messages).toEqual([]);

    act(() => { latest!.setConversationId("conversation-c"); });
    expect(latest!.messages).toHaveLength(1);
  });

  it("follows the canonical conversation when the person stayed on New conversation", async () => {
    mockSendAgentMessage.mockImplementationOnce(async (request: Record<string, unknown>) =>
      textResponse(request.client_turn_id as string, "conversation-new"));
    await act(async () => { create(<Probe />); });
    await act(async () => { await latest!.sendMessage("Hello Ari"); });
    expect(latest!.conversationId).toBe("conversation-new");
    expect(latest!.messages).toHaveLength(1);
  });
});
