import fs from "node:fs";
import path from "node:path";

import { buildChoiceSubmission, choicesOf } from "../agentChoices";
import type { AgentChoicesV2, AgentMessage } from "../../../services/agentChatService";

/**
 * [TEST-MOD-APPROVED #1985]
 * ORCH-1103's V1 label-as-semantic-turn assertion became unsafe when #1985
 * made stored, question-bound V2 payload IDs the only submission authority.
 * Still-valid chip rendering, no-dead-tap, single-live-tail, clarifying,
 * multi-select, and proposal coverage remains here; historical V1 is inert.
 */

const ROOT = path.resolve(__dirname, "../../../..");
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), "utf8");

function assistantWithChoices(id: string, choices: unknown): AgentMessage {
  return {
    id,
    conversation_id: "c1",
    role: "assistant",
    content: { text: "Choose one", structured: { choices } },
    client_turn_id: null,
    tool_calls: null,
    tool_results: null,
    created_at: new Date().toISOString(),
  };
}

const choices: AgentChoicesV2 = {
  schema_version: 2,
  question_id: "q1",
  kind: "clarifying",
  prompt: "Which date?",
  required_slot_keys: ["start_at"],
  options: [
    { id: "d1", label: "Friday at 7 PM", payload: { type: "slot_patch", slot_updates: { start_at: "2026-08-28T18:00:00.000Z" } } },
    { id: "d2", label: "Saturday at 8 PM", payload: { type: "slot_patch", slot_updates: { start_at: "2026-08-29T19:00:00.000Z" } } },
  ],
};

describe("ORCH-1103 / #1985 — typed choices render without label authority", () => {
  it("extracts well-formed V2 options that become chips", () => {
    const parsed = choicesOf(assistantWithChoices("m1", choices));
    expect(parsed).toEqual(choices);
    expect(parsed?.options.map((option) => option.label)).toEqual(["Friday at 7 PM", "Saturday at 8 PM"]);
  });

  it("keeps malformed, V1, and non-assistant rows inert", () => {
    expect(choicesOf(assistantWithChoices("m2", { kind: "clarifying", prompt: "Old", options: [] }))).toBeUndefined();
    expect(choicesOf(assistantWithChoices("m3", { ...choices, schema_version: 1 }))).toBeUndefined();
    expect(choicesOf({ ...assistantWithChoices("u1", choices), role: "user" })).toBeUndefined();
  });

  it("tap dispatches the question-bound ID and rejects a bad ID", () => {
    expect(buildChoiceSubmission(choices, ["d2"])).toEqual({ question_id: "q1", option_ids: ["d2"] });
    expect(buildChoiceSubmission(choices, ["missing"])).toBeNull();
    expect(JSON.stringify(buildChoiceSubmission(choices, ["d2"]))).not.toContain("Saturday at 8 PM");
  });
});

describe("ORCH-1103 / #1985 — MessageList choice wiring", () => {
  const messageList = read("src/components/ari/MessageList.tsx");

  it("reuses QuickReplyChips and both structured ask components", () => {
    expect(messageList).toMatch(/import\s*\{\s*QuickReplyChips\s*\}\s*from\s*"\.\/QuickReplyChips"/);
    expect(messageList).toContain("<QuickReplyChips");
    expect(messageList).toContain("<ClarifyingCard");
    expect(messageList).toContain("<MultiSelectPrompt");
  });

  it("routes all taps through typed submissions, not display labels", () => {
    expect(messageList).toContain("buildChoiceSubmission(choices, [optionId])");
    expect(messageList).toContain("onSendChoice?.(submission, label)");
    expect(messageList).not.toContain("sendChoice?.(label)");
  });

  it("keeps only the latest choice row interactive and a proposal supersedes it", () => {
    expect(messageList).toContain("lastChoiceMessageId");
    expect(messageList).toMatch(/if\s*\(!pendingAction\)\s*\{[\s\S]*lastChoiceMessageId/);
  });

  it("wires the screen to the typed choice request", () => {
    const screen = read("src/screens/ari/AriChatScreen.tsx");
    expect(screen).toContain("onSendChoice={(submission, label) => void handleChoice(submission, label)}");
  });
});

describe("#1970 Wave 0 — clarifying and multi-select remain wired", () => {
  it("accepts strict V2 clarifying free text", () => {
    const freeText: AgentChoicesV2 = { ...choices, options: [] };
    expect(buildChoiceSubmission(freeText, [], "Friday 7pm")).toEqual({ question_id: "q1", option_ids: [], free_text: "Friday 7pm" });
  });

  it("retains the money-confirm proposal pattern", () => {
    const source = read("src/components/ari/ToolProposalCard.tsx");
    expect(source).toContain("MONEY_CONFIRM_TOOLS");
    expect(source).toContain("send_campaign_now");
    expect(source).toContain("request_account_deletion");
    expect(source).toContain("refund_order");
  });
});
