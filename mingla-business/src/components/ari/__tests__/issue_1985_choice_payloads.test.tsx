import fs from "node:fs";
import path from "node:path";

import { buildChoiceSubmission, choicesOf } from "../agentChoices";
import type { AgentChoicesV2 } from "../../../services/agentChatService";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), "utf8");

const choices: AgentChoicesV2 = {
  schema_version: 2,
  question_id: "question-date-1",
  kind: "clarifying",
  prompt: "Which date and time should I use?",
  required_slot_keys: ["start_at", "timezone"],
  options: [{
    id: "date-1",
    label: "Fri, Aug 28 at 7:00 PM GMT+1",
    payload: { type: "slot_patch", slot_updates: { start_at: "2026-08-28T18:00:00.000Z", timezone: "Africa/Lagos" } },
  }],
};

describe("#1985 AgentChoicesV2 client boundary", () => {
  it("executes the typed choice round trip through the real client boundary", async () => {
    const parsed = choicesOf({ role: "assistant", content: { structured: { choices } } });
    const submission = await Promise.resolve(
      parsed ? buildChoiceSubmission(parsed, [parsed.options[0].id]) : null,
    );
    expect(submission).toEqual({
      question_id: "question-date-1",
      option_ids: ["date-1"],
    });
  });

  it("submits question-bound option IDs and never a visible label", () => {
    expect(buildChoiceSubmission(choices, ["date-1"])).toEqual({
      question_id: "question-date-1",
      option_ids: ["date-1"],
    });
    expect(JSON.stringify(buildChoiceSubmission(choices, ["date-1"]))).not.toContain("Fri, Aug 28");
  });

  it("rejects unknown IDs and keeps historical V1 rows inert", () => {
    expect(buildChoiceSubmission(choices, ["tampered-id"])).toBeNull();
    expect(choicesOf({ role: "assistant", content: { structured: { choices: { kind: "clarifying", prompt: "Old", options: [] } } } })).toBeUndefined();
  });

  it("accepts strict V2 rows and preserves stored typed payloads", () => {
    const parsed = choicesOf({ role: "assistant", content: { structured: { choices } } });
    expect(parsed).toEqual(choices);
    expect(parsed?.options[0].payload).toEqual(choices.options[0].payload);
  });

  it("wires retry with the same client turn id and explicit offline blocking", () => {
    const hook = read("src/hooks/useAgentChat.ts");
    const screen = read("src/screens/ari/AriChatScreen.tsx");
    expect(hook).toContain("clientTurnId = newClientTurnId()");
    expect(hook).toContain("sendTurn((failed.content");
    expect(hook).toContain("payload, clientTurnId");
    expect(screen).toContain("You're offline. Reconnect to continue this plan.");
    expect(screen).toContain("choicesDisabled={chat.isSending || !online}");
  });

  it("restores an unresolved pending action from refreshed message history", () => {
    const hook = read("src/hooks/useAgentChat.ts");
    expect(hook).toContain("const resolved = new Set(serverMessages");
    expect(hook).toContain("setPendingAction(unresolved)");
  });
});
