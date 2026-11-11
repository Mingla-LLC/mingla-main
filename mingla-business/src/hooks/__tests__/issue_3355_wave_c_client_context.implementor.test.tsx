/**
 * #3355 Wave C (C2) implementor proof — every Ari message says which Host
 * screen the host asked from, so "this event" resolves on the server.
 */

import React from "react";

const { create, act } = require("react-test-renderer") as {
  create: (node: React.ReactElement) => unknown;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSendAgentMessage = jest.fn();
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
  fetchMessages: jest.fn(async () => []),
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
import {
  ariClientContextFor,
  isAriChatPath,
  rememberAriHostScreen,
} from "../../config/routes";

const EVENT = "33333333-3333-4333-8333-333333333333";

let latest: UseAgentChatResult | null = null;

function Probe(): null {
  latest = useAgentChat(null, "brand-a");
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

describe("#3355 C2 client_context", () => {
  beforeEach(() => {
    latest = null;
    jest.clearAllMocks();
    mockSendAgentMessage.mockReset();
  });

  it("derives the route and entity from a Host screen path, never the query string", () => {
    expect(ariClientContextFor(`/event/${EVENT}?token=secret`)).toEqual({
      route: `/event/${EVENT}`,
      entity_kind: "event",
      entity_id: EVENT,
    });
    expect(ariClientContextFor(`/(tabs)/home`)).toEqual({ route: "/home" });
    expect(ariClientContextFor(`/trip/${EVENT.toUpperCase()}/edit`)).toEqual({
      route: `/trip/${EVENT.toUpperCase()}/edit`,
      entity_kind: "trip",
      entity_id: EVENT,
    });
    expect(ariClientContextFor("/event/not-a-uuid")).toEqual({ route: "/event/not-a-uuid" });
    expect(ariClientContextFor("relative")).toBeUndefined();
  });

  it("never records Ari's own screens as the host's screen", () => {
    expect(isAriChatPath("/ari")).toBe(true);
    expect(isAriChatPath("/(tabs)/ari")).toBe(true);
    expect(isAriChatPath("/ari/settings")).toBe(true);
    expect(isAriChatPath(`/brand/${EVENT}/website/ari`)).toBe(true);
    expect(isAriChatPath(`/event/${EVENT}`)).toBe(false);
    rememberAriHostScreen(`/event/${EVENT}`);
    rememberAriHostScreen("/ari");
    expect(ariClientContextFor()?.route).toBe(`/event/${EVENT}`);
  });

  it("sends the host's screen as client_context with each message", async () => {
    rememberAriHostScreen(`/event/${EVENT}`);
    rememberAriHostScreen("/(tabs)/ari");
    mockSendAgentMessage.mockImplementation(async (request: Record<string, unknown>) =>
      textResponse(request.client_turn_id as string));
    await act(async () => { create(<Probe />); });
    await act(async () => { await latest!.sendMessage("Add a VIP tier to this event"); });
    expect(mockSendAgentMessage).toHaveBeenCalledTimes(1);
    const payload = mockSendAgentMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.client_context).toEqual({
      route: `/event/${EVENT}`,
      entity_kind: "event",
      entity_id: EVENT,
    });

    rememberAriHostScreen("/home");
    await act(async () => { await latest!.sendMessage("And now?"); });
    const second = mockSendAgentMessage.mock.calls[1][0] as Record<string, unknown>;
    expect(second.client_context).toEqual({ route: "/home" });
  });

  it("the Host shell records every screen the host visits", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const source = fs.readFileSync(
      path.join(__dirname, "../../../app/(tabs)/_layout.tsx"),
      "utf8",
    );
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*rememberAriHostScreen\(pathname\);\s*\}, \[pathname\]\);/,
    );
  });
});
