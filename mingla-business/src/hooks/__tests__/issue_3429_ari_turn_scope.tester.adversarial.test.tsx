/**
 * #3429 adversarial client seam proof. The real reconciliation export executes
 * the one-owner rule; source assertions pin the hook's dispatch and epoch
 * boundaries without creating a second implementation of them in test code.
 */
import fs from "fs";
import path from "path";
import type { AgentMessage } from "../../services/agentChatService";

jest.mock("@tanstack/react-query", () => ({}));
jest.mock("../../context/AuthContext", () => ({}));
jest.mock("../../services/agentChatService", () => ({}));
jest.mock("../../services/supabase", () => ({ supabase: {} }));
jest.mock("../../components/ui/useShareNetworkState", () => ({
  useShareNetworkState: () => true,
}));

import { reconcileAgentDeliveryMessages } from "../useAgentChat";

const hookPath = path.resolve(__dirname, "../useAgentChat.ts");
const inputPath = path.resolve(__dirname, "../../components/ari/InputBar.tsx");
const reliabilityPath = path.resolve(__dirname, "../../services/agentReliability.ts");
const screenPath = path.resolve(__dirname, "../../screens/ari/AriChatScreen.tsx");

function userMessage(id: string, clientTurnId: string, text = "same text"): AgentMessage {
  return {
    id,
    conversation_id: "conversation-3429",
    role: "user",
    content: { text },
    client_turn_id: clientTurnId,
    tool_calls: null,
    tool_results: null,
    created_at: "2026-09-15T12:00:00.000Z",
  };
}

describe("#3429 LocalTurn ownership and scope adversarial seams", () => {
  it("keeps different IDs distinct, replaces only the acknowledged id, and permits exact-id retry", () => {
    const first = "00000000-0000-4000-8000-000000003461";
    const second = "00000000-0000-4000-8000-000000003462";
    const acknowledged = userMessage("server-first", first);
    const result = reconcileAgentDeliveryMessages(
      [acknowledged],
      [userMessage("local-first", first), userMessage("local-second", second)],
      [],
      true,
    );
    expect(result).toEqual([acknowledged, userMessage("local-second", second)]);

    const hook = fs.readFileSync(hookPath, "utf8");
    expect(hook).toContain("interface LocalTurn");
    expect(hook).toContain("current.some((candidate) => candidate.clientTurnId === clientTurnId)");
    expect(hook).toMatch(/return sendTurn\([\s\S]*latest\.attachments, clientTurnId\)/);
    expect(hook).not.toContain("turnPayloads");
  });

  it("keeps edit/discard attachment ownership and clears every old-brand delivery channel before stale work can render", () => {
    const hook = fs.readFileSync(hookPath, "utf8");
    expect(hook).toContain("return { text: turn.displayText, attachments: turn.attachments };");
    expect(hook).toContain("turn.attachments.forEach");
    expect(hook).toContain("brandEpoch.current += 1");
    expect(hook).toContain("subscriptions.current.forEach((unsubscribe) => unsubscribe())");
    expect(hook).toContain("sendIntentRef.current = null");
    expect(hook).toContain("turnsRef.current = []");
    expect(hook).toContain("setConversationId(null)");
    expect(hook).toContain("if (turn.epoch !== brandEpoch.current) return response;");
  });

  it("requires each readiness condition while accepting text-only and ready-file-only sends", () => {
    const input = fs.readFileSync(inputPath, "utf8");
    const reliability = fs.readFileSync(reliabilityPath, "utf8");
    const screen = fs.readFileSync(screenPath, "utf8");
    expect(input).toContain("isAriSendReady(text, hasReadyAttachments, disabled, sendDisabled)");
    expect(reliability).toMatch(/return \(text\.trim\(\)\.length > 0 \|\| hasReadyAttachments\) && !disabled\s*&&\s*!sendDisabled;/);
    expect(screen).toContain("disabled={brands.isLoading || !conversationSelectionReady}");
    expect(screen).toContain("sendDisabled={chat.isSending || rateLimited || !online || !attachments.allReady}");
    expect(screen).toContain("hasReadyAttachments={attachments.attachments.length > 0 && attachments.allReady}");
  });
});
