/**
 * #3614 [Confirming an Ari website change silently does nothing] — implementor
 * happy-path suite for the Business thread.
 *
 * THE DEFECT, as the operator met it on 2026-09-28: they pressed
 * "Confirm draft update" on a typed Website proposal and the card simply
 * disappeared. No write, no error, no toast, nothing left in the thread.
 *
 * The server had in fact refused it. agent_pending_actions 7f88befc-…
 * terminalized as `failed` and agent-confirm-action wrote the terminal tool row
 * 8d037fc7-… carrying
 * `{ outcome: "failed", pending_action_id: "7f88befc-…", reason: "FORBIDDEN: …" }`.
 * Two things then conspired to make a real refusal look like nothing at all:
 *
 *   1. that row RESOLVES the pending action, so `useAgentChat` clears it and
 *      the proposal card unmounts — the card "disappearing" is correct;
 *   2. `MessageList` dropped every failed tool row on the floor, on the stated
 *      grounds that "toast + Ari follow-up cover this". For an in-turn tool
 *      failure that is true. For a CONFIRMATION it is not: agent-confirm-action
 *      writes an assistant follow-up only on the executed path, so the entire
 *      visible outcome of a refused confirm was a toast that dismisses itself
 *      in twelve seconds.
 *
 * WHY THIS SUITE RENDERS INSTEAD OF GREPPING. The defect was a `continue` in a
 * list-building loop plus an early `return null` in a renderer. Both read
 * perfectly in source; only a mounted tree shows whether the row reaches the
 * thread. A source pin would have passed over this bug for as long as it
 * existed. The harness below therefore mounts the REAL MessageList and reads
 * the REAL rendered text.
 *
 * fails-on-revert: restore the unconditional `if (outcome === "failed") return
 * null;` (or the unconditional `continue`) and H1/H2 go red — the refusal is
 * absent from the tree again.
 */

import React from "react";

// React 19 gates act() support on this flag.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ─────────────────────────── the FlatList emulator ──────────────────────────
// The default node/ts-jest config maps `react-native` to inert passthroughs
// whose FlatList renders nothing. Substitute one that renders its cells, in
// data order, and nothing else — this suite asserts on CONTENT, not ordering
// (#2649 owns ordering).
jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const base = jest.requireActual("react-native");
  const FlatList = (props: Record<string, unknown>): React.ReactElement => {
    const data = (props.data as unknown[]) ?? [];
    const renderItem = props.renderItem as
      | ((info: { item: unknown; index: number }) => React.ReactNode)
      | undefined;
    const keyExtractor = props.keyExtractor as
      | ((item: unknown, index: number) => string)
      | undefined;
    const listRef = props.ref as { current: unknown } | undefined;
    if (listRef && typeof listRef === "object" && "current" in listRef) {
      listRef.current = {
        scrollToOffset: () => {},
        scrollToEnd: () => {},
        scrollToIndex: () => {},
      };
    }
    const cells = data.map((item, index) =>
      ReactModule.createElement(
        "MockCell",
        { key: keyExtractor ? keyExtractor(item, index) : String(index) },
        renderItem ? renderItem({ item, index }) : null,
      )
    );
    return ReactModule.createElement("FlatList", { testID: props.testID }, cells);
  };
  return { ...base, FlatList };
});

// ───────────────────────────── boundary stubs ───────────────────────────────
jest.mock("../ChatBubble", () => ({
  ChatBubble: (props: { text: string }) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ChatBubbleStub", { text: props.text }),
}));
jest.mock("../ToolProposalCard", () => ({
  ToolProposalCard: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ToolProposalCardStub", null),
}));
jest.mock("../ResponseCard", () => ({
  ResponseCard: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ResponseCardStub", null),
}));
jest.mock("../QuickReplyChips", () => ({
  QuickReplyChips: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("QuickReplyChipsStub", null),
}));
jest.mock("../ClarifyingCard", () => ({
  ClarifyingCard: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ClarifyingCardStub", null),
}));
jest.mock("../MultiSelectPrompt", () => ({
  MultiSelectPrompt: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("MultiSelectPromptStub", null),
}));
jest.mock("lucide-react-native", () => ({
  Check: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("CheckStub", null),
}));

// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void) => void;
  create: (node: React.ReactElement) => { toJSON: () => JsonNode };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MessageListModule = require("../MessageList") as {
  MessageList: React.ComponentType<Record<string, unknown>>;
  confirmationFailureSentence: (toolResults: unknown) => string | null;
};
const { MessageList, confirmationFailureSentence } = MessageListModule;

// ───────────────────────────── tree utilities ───────────────────────────────
interface JsonElement {
  type: string;
  props: Record<string, unknown>;
  children: JsonNode[] | null;
}
type JsonNode = JsonElement | string | null;

const isElement = (node: JsonNode): node is JsonElement =>
  typeof node === "object" && node !== null &&
  typeof (node as JsonElement).type === "string";

function allText(node: JsonNode, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (!isElement(node)) return out;
  for (const child of node.children ?? []) allText(child, out);
  return out;
}

const globalWithRaf = globalThis as unknown as {
  requestAnimationFrame?: (cb: (t: number) => void) => number;
};
if (!globalWithRaf.requestAnimationFrame) {
  globalWithRaf.requestAnimationFrame = (cb) => {
    cb(0);
    return 0;
  };
}

function renderThread(messages: Record<string, unknown>[]): JsonNode {
  let tree: { toJSON: () => JsonNode } | null = null;
  act(() => {
    tree = create(
      React.createElement(MessageList, {
        messages,
        pendingAction: null,
        isExecuting: false,
        onConfirm: async () => ({ ok: true }),
        onCancel: () => {},
      }),
    );
  });
  return (tree as unknown as { toJSON: () => JsonNode }).toJSON();
}

// ──────────────────────────────── fixtures ──────────────────────────────────
const PENDING_ACTION_ID = "7f88befc-661b-48ff-9797-60881e6c22b8";

/** The exact row agent-confirm-action wrote at 14:41:39.275 on 2026-09-28. */
const refusedConfirmation = {
  id: "8d037fc7-1ef9-4d0c-b19c-0911eff89ff1",
  role: "tool",
  content: {},
  tool_calls: null,
  tool_results: {
    outcome: "failed",
    tool_name: "propose_site_content_update",
    pending_action_id: PENDING_ACTION_ID,
    reason: "FORBIDDEN: This Website action is not available for your role.",
  },
  created_at: "2026-09-28T14:41:39.275Z",
};

/** An in-turn tool failure: no pending action, so Ari's reply explains it. */
const inTurnToolFailure = {
  id: "aa000000-0000-4000-8000-000000000001",
  role: "tool",
  content: {},
  tool_calls: null,
  tool_results: {
    outcome: "failed",
    tool_name: "get_site_page",
    reason: "SITE_SERVICE_UNAVAILABLE: Ari could not reach Website tools.",
  },
  created_at: "2026-09-28T14:42:44.000Z",
};

describe("#3614 a refused confirmation is visible in the thread", () => {
  it("H1 renders the refusal, in the operator's words, where the card used to be", () => {
    const text = allText(renderThread([refusedConfirmation])).join(" | ");
    expect(text).toContain("That didn't go through.");
    expect(text).toContain("This Website action is not available for your role.");
  });

  it("H2 never leaks the machine code the reason is stored with", () => {
    const text = allText(renderThread([refusedConfirmation])).join(" | ");
    expect(text).not.toContain("FORBIDDEN");
    expect(text).not.toContain(PENDING_ACTION_ID);
    expect(text).not.toContain("propose_site_content_update");
  });

  it("H3 leaves an in-turn tool failure hidden — Ari's own reply still covers that one", () => {
    const text = allText(renderThread([inTurnToolFailure])).join(" | ");
    expect(text).not.toContain("That didn't go through");
    expect(text).not.toContain("Ari could not reach Website tools.");
  });

  it("H4 falls back to fixed copy when the reason is not a CODE: sentence", () => {
    for (
      const reason of [
        undefined,
        "",
        "unknown",
        "TypeError: Cannot read properties of undefined (reading 'brand_id')",
        `WRITE_FAILED: ${"x".repeat(240)}`,
      ]
    ) {
      const sentence = confirmationFailureSentence({
        outcome: "failed",
        pending_action_id: PENDING_ACTION_ID,
        reason,
      });
      expect(sentence).toBe(
        "That didn't go through, so nothing changed. Ask Ari to try it again.",
      );
    }
  });

  it("H5 says nothing for an executed or cancelled outcome", () => {
    for (const outcome of ["executed", "cancelled", undefined]) {
      expect(
        confirmationFailureSentence({
          outcome,
          pending_action_id: PENDING_ACTION_ID,
          reason: "FORBIDDEN: nope",
        }),
      ).toBeNull();
    }
    expect(confirmationFailureSentence(null)).toBeNull();
    expect(confirmationFailureSentence(undefined)).toBeNull();
  });
});
