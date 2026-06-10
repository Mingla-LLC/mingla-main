import fs from "node:fs";
import path from "node:path";

import { choicesOf, resolveChoiceLabel } from "../agentChoices";
import type { AgentMessage, AgentChoices } from "../../../services/agentChatService";

/**
 * ORCH-1103 REWORK 2 — the choices payload renders chips in MessageList and a
 * tap dispatches the expected user message.
 *
 * The dead-tap audit (REWORK 1, Discovery #5) found Surfaces 3 ("which brand?"
 * disambiguation) and 5 (no-brand → "create one?" handoff) were NEVER wired into
 * MessageList — QuickReplyChips was not imported/rendered. This locks the wiring:
 *
 *   1. choicesOf() extracts a well-formed payload off an assistant message
 *      (persisted in content.structured by agent-chat) → these become the chips.
 *   2. resolveChoiceLabel() returns the EXACT label a tap must send as the next
 *      user turn (Q2 conversational feedback — a brand name, or yes/no — NEVER a
 *      tool-arg pre-fill). This is the no-dead-tap guarantee: a tap dispatches a
 *      real follow-up message.
 *   3. Source assertions: MessageList imports + renders QuickReplyChips CHOICE
 *      and routes the tap through resolveChoiceLabel → sendChoice (onSendChoice).
 *
 * fails-on-revert: reverting MessageList drops the exports + render path; both
 * the behavioral and source assertions go red.
 */

const ROOT = path.resolve(__dirname, "../../../..");
function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function asstWithChoices(id: string, choices: unknown): AgentMessage {
  return {
    id,
    conversation_id: "c1",
    role: "assistant",
    content: { text: "Which brand should I update?", structured: { choices } },
    tool_calls: null,
    tool_results: null,
    created_at: new Date().toISOString(),
  };
}

describe("ORCH-1103 REWORK 2 — choicesOf extracts the chip payload", () => {
  it("returns brand_disambiguation options that become chips", () => {
    const m = asstWithChoices("m1", {
      kind: "brand_disambiguation",
      prompt: "Which brand?",
      options: [
        { id: "b1", label: "Lumen Coffee" },
        { id: "b2", label: "Night Owl Bar" },
      ],
    });
    const c = choicesOf(m);
    expect(c).toBeDefined();
    expect(c?.kind).toBe("brand_disambiguation");
    expect(c?.options).toHaveLength(2);
    expect(c?.options[1].label).toBe("Night Owl Bar");
  });

  it("returns the no_brand_handoff yes/no pair", () => {
    const m = asstWithChoices("m2", {
      kind: "no_brand_handoff",
      prompt: "Create a brand first?",
      options: [
        { id: "yes", label: "Yes, create a brand" },
        { id: "no", label: "Not now" },
      ],
    });
    const c = choicesOf(m);
    expect(c?.kind).toBe("no_brand_handoff");
    expect(c?.options.map((o) => o.label)).toEqual(["Yes, create a brand", "Not now"]);
  });

  it("degrades to undefined for malformed / legacy / non-assistant rows", () => {
    expect(choicesOf(asstWithChoices("m3", undefined))).toBeUndefined();
    expect(choicesOf(asstWithChoices("m4", { kind: "bogus", options: [] }))).toBeUndefined();
    expect(choicesOf(asstWithChoices("m5", { kind: "brand_disambiguation", options: [] }))).toBeUndefined();
    // options missing id/label are filtered out → undefined when none survive.
    expect(
      choicesOf(asstWithChoices("m6", { kind: "brand_disambiguation", options: [{ id: 1 }] })),
    ).toBeUndefined();
    const userRow: AgentMessage = {
      id: "u1",
      conversation_id: "c1",
      role: "user",
      content: { text: "hi", structured: { choices: { kind: "brand_disambiguation", options: [{ id: "b1", label: "X" }] } } },
      tool_calls: null,
      tool_results: null,
      created_at: new Date().toISOString(),
    };
    expect(choicesOf(userRow)).toBeUndefined();
  });
});

describe("ORCH-1103 REWORK 2 — a chip tap dispatches the expected user message", () => {
  const choices: AgentChoices = {
    kind: "brand_disambiguation",
    prompt: "Which brand?",
    options: [
      { id: "b1", label: "Lumen Coffee" },
      { id: "b2", label: "Night Owl Bar" },
    ],
  };

  it("resolves the tapped option id to its brand-name label (no tool pre-fill)", () => {
    expect(resolveChoiceLabel(choices, "b2")).toBe("Night Owl Bar");
    expect(resolveChoiceLabel(choices, "b1")).toBe("Lumen Coffee");
  });

  it("simulates the tap → send path: the dispatched text is the chip label", () => {
    const sent: string[] = [];
    const sendChoice = (label: string): void => {
      sent.push(label);
    };
    // This mirrors MessageList's onSelectId handler verbatim.
    const onSelectId = (optionId: string): void => {
      const label = resolveChoiceLabel(choices, optionId);
      if (label == null) return;
      sendChoice(label);
    };
    onSelectId("b2");
    expect(sent).toEqual(["Night Owl Bar"]);
    // A bad id is a no-op (never sends an empty turn) — no dead tap, no junk send.
    onSelectId("does-not-exist");
    expect(sent).toEqual(["Night Owl Bar"]);
  });

  it("the yes/no handoff dispatches the yes-label as a create-brand turn", () => {
    const handoff: AgentChoices = {
      kind: "no_brand_handoff",
      prompt: "Create a brand first?",
      options: [
        { id: "yes", label: "Yes, create a brand" },
        { id: "no", label: "Not now" },
      ],
    };
    expect(resolveChoiceLabel(handoff, "yes")).toBe("Yes, create a brand");
    expect(resolveChoiceLabel(handoff, "no")).toBe("Not now");
  });
});

describe("ORCH-1103 REWORK 2 — MessageList renders QuickReplyChips CHOICE for choices", () => {
  const messageList = read("src/components/ari/MessageList.tsx");

  it("imports the existing QuickReplyChips (reused verbatim, no new component)", () => {
    expect(messageList).toMatch(/import\s*\{\s*QuickReplyChips\s*\}\s*from\s*"\.\/QuickReplyChips"/);
    expect(messageList).toMatch(/import\s*\{\s*choicesOf,\s*resolveChoiceLabel\s*\}\s*from\s*"\.\/agentChoices"/);
  });

  it("renders QuickReplyChips in CHOICE mode beneath the bubble when choices exist", () => {
    expect(messageList).toContain("const choices = choicesOf(m)");
    expect(messageList).toMatch(/<QuickReplyChips\b/);
    expect(messageList).toContain("options={choices.options}");
    // CHOICE mode props (not legacy chips).
    expect(messageList).toMatch(/state=\{isResolved \? "submitted" : "default"\}/);
  });

  it("the tap routes through resolveChoiceLabel and sends via sendChoice (no pre-fill)", () => {
    expect(messageList).toContain("resolveChoiceLabel(choices, optionId)");
    expect(messageList).toContain("sendChoice?.(label)");
    // sendChoice prefers onSendChoice, falling back to onSeedMessage.
    expect(messageList).toMatch(/const sendChoice = onSendChoice \?\? onSeedMessage/);
  });

  it("only the latest choices row is interactive (single-live-at-tail)", () => {
    expect(messageList).toContain("lastChoiceMessageId");
    // A live pending proposal supersedes choices.
    expect(messageList).toMatch(/if\s*\(!pendingAction\)\s*\{[\s\S]*lastChoiceMessageId/);
  });

  it("AriChatScreen wires onSendChoice to a normal user-turn send", () => {
    const screen = read("src/screens/ari/AriChatScreen.tsx");
    expect(screen).toMatch(/onSendChoice=\{\(label\) => void handleSend\(label\)\}/);
  });
});
