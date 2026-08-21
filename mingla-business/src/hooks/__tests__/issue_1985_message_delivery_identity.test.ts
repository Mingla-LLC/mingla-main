import type { AgentMessage } from "../../services/agentChatService";

jest.mock("@tanstack/react-query", () => ({}));
jest.mock("../../context/AuthContext", () => ({}));
jest.mock("../../services/agentChatService", () => ({}));

import { reconcileAgentDeliveryMessages } from "../useAgentChat";

function message(
  id: string,
  text: string,
  clientTurnId: string | null,
): AgentMessage {
  return {
    id,
    conversation_id: "conversation-1985",
    role: "user",
    content: { text },
    client_turn_id: clientTurnId,
    tool_calls: null,
    tool_results: null,
    created_at: "2026-08-20T20:00:00.000Z",
  };
}

describe("#1985 canonical client message delivery identity", () => {
  it("keeps a failed turn retryable until the same client turn reaches the server", () => {
    const optimistic = message("optimistic-local", "Plan my event", null);
    const failed = message(
      "failed-turn-1985",
      "Plan my event",
      "00000000-0000-4000-8000-000000001985",
    );

    expect(
      reconcileAgentDeliveryMessages([], [], [failed], true),
    ).toEqual([failed]);

    const server = message(
      "server-user-row",
      "Plan my event",
      "00000000-0000-4000-8000-000000001985",
    );
    expect(
      reconcileAgentDeliveryMessages([server], [optimistic], [failed], true),
    ).toEqual([server]);
  });

  it("preserves ORCH-1101 text reconciliation for a sending placeholder", () => {
    const optimistic = message("optimistic-local", "Same visible turn", null);
    const server = message("server-user-row", "Same visible turn", null);

    expect(
      reconcileAgentDeliveryMessages([server], [optimistic], [], true),
    ).toEqual([server]);
  });
});
