import * as fs from "fs";
import * as path from "path";
import type { AgentMessage } from "../../services/agentChatService";
import {
  isAriFailureMessageForPending,
  isAriFailureMessageForTurn,
} from "../../services/ariFailureParity";

function assistant(
  content: Record<string, unknown>,
  clientTurnId: string | null = null,
): AgentMessage {
  return {
    id: "46371000-0000-4000-8400-000000000001",
    conversation_id: "46371000-0000-4000-8100-000000000001",
    role: "assistant",
    content,
    client_turn_id: clientTurnId,
    tool_calls: null,
    tool_results: null,
    created_at: "2026-11-27T12:00:00.000Z",
  };
}

describe("#4637 durable Ari failure parity", () => {
  it("recognizes a typed chat-turn failure by immutable turn id", () => {
    const turnId = "46371000-0000-4000-8600-000000000001";
    expect(isAriFailureMessageForTurn(assistant({
      text: "I couldn't finish that. Nothing was changed.",
      structured: {
        failure: {
          v: 1,
          class: "internal",
          retryable: true,
          changed_anything: false,
        },
      },
    }, turnId), turnId)).toBe(true);
    expect(isAriFailureMessageForTurn(assistant({ text: "Try again." }, turnId), turnId)).toBe(false);
  });

  it("recognizes a durable confirmation failure by pending-action id", () => {
    const pendingId = "46371000-0000-4000-8200-000000000001";
    expect(isAriFailureMessageForPending(assistant({
      text: "I couldn't finish that change. Nothing was changed.",
      failure_for_pending_action_id: pendingId,
    }), pendingId)).toBe(true);
    expect(isAriFailureMessageForPending(assistant({
      text: "Another action failed.",
      failure_for_pending_action_id:
        "46371000-0000-4000-8200-000000000002",
    }), pendingId)).toBe(false);
  });

  it("resumes a waiting flow after transport recovery finds the durable failure", () => {
    const screen = fs.readFileSync(
      path.resolve(__dirname, "../../screens/ari/AriChatScreen.tsx"),
      "utf8",
    );
    const transportCatch = screen.slice(
      screen.indexOf("} catch {\n        const message = ariChatErrorCopy"),
      screen.indexOf("// #2830 (D-3)"),
    );
    expect(transportCatch).toContain('void chat.resumeFlow("resume");');
  });
});
