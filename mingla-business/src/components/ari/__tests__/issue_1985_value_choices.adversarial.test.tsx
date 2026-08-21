import React from "react";

import type { AgentMessage } from "../../../services/agentChatService";

const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (node: React.ReactElement) => {
    root: {
      findAllByType: (
        type: string,
      ) => Array<{ props: Record<string, unknown> }>;
    };
    unmount: () => void;
  };
};

jest.mock("react-native", () => {
  const React = require("react");
  return {
    FlatList: (
      { data, renderItem }: {
        data: unknown[];
        renderItem: (args: { item: unknown }) => React.ReactNode;
      },
    ) =>
      React.createElement(
        "flat-list",
        null,
        ...data.map((item, index) =>
          React.createElement(
            React.Fragment,
            { key: index },
            renderItem({ item }),
          )
        ),
      ),
    Pressable: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement("pressable", props, children),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement("text", props, children),
    View: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement("view", props, children),
  };
});
jest.mock("lucide-react-native", () => ({ Check: () => null }));
jest.mock("../../../constants/designSystem", () => ({
  ariThread: {
    gapGroup: 4,
    gapTurn: 10,
    orbGap: 8,
    ribbonPadH: 10,
    ribbonPadV: 5,
  },
  glass: { tint: { profileBase: "x" }, border: { profileBase: "x" } },
  radius: { full: 999 },
  semantic: { error: "red", success: "green", successTint: "green" },
  spacing: { sm: 8, md: 16, xl: 32 },
  typography: { bodySm: { fontSize: 13 } },
}));
jest.mock(
  "../ChatBubble",
  () => ({ ChatBubble: () => React.createElement("chat-bubble") }),
);
jest.mock(
  "../ToolProposalCard",
  () => ({ ToolProposalCard: () => React.createElement("proposal-card") }),
);
jest.mock(
  "../ResponseCard",
  () => ({ ResponseCard: () => React.createElement("response-card") }),
);
jest.mock("../QuickReplyChips", () => ({
  QuickReplyChips: (props: Record<string, unknown>) =>
    React.createElement("quick-reply-chips", props),
}));
jest.mock("../ClarifyingCard", () => ({
  ClarifyingCard: (props: Record<string, unknown>) =>
    React.createElement("clarifying-card", props),
}));
jest.mock("../MultiSelectPrompt", () => ({
  MultiSelectPrompt: (props: Record<string, unknown>) =>
    React.createElement("multi-select-prompt", props),
}));

const { MessageList } = require(
  "../MessageList",
) as typeof import("../MessageList");

beforeAll(() => {
  (globalThis as typeof globalThis & {
    requestAnimationFrame: (callback: () => void) => number;
  })
    .requestAnimationFrame = () => 1;
});

test("#1985 T-9 renders server-provided date values as semantic chips, not a free-text-only card", () => {
  const message: AgentMessage = {
    id: "assistant-date-question",
    conversation_id: "conversation-1",
    role: "assistant",
    content: {
      text: "Which date and time should I use?",
      structured: {
        choices: {
          schema_version: 2,
          question_id: "question-date",
          kind: "clarifying",
          prompt: "Which date and time should I use?",
          required_slot_keys: ["start_at", "timezone"],
          options: [
            {
              id: "date-one",
              label: "Fri, Aug 28 at 7:00 PM",
              payload: {
                type: "slot_patch",
                slot_updates: {
                  start_at: {
                    original_text: "end of this month",
                    precision: "instant",
                    local_date: "2026-08-28",
                    local_time: "19:00",
                    timezone: "Africa/Lagos",
                    resolved_iso: "2026-08-28T18:00:00.000Z",
                    source: "choice",
                  },
                  timezone: "Africa/Lagos",
                },
              },
            },
          ],
        },
      },
    },
    client_turn_id: null,
    tool_calls: null,
    tool_results: null,
    created_at: "2026-08-13T16:00:00.000Z",
  };

  let tree!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <MessageList
        messages={[message]}
        pendingAction={null}
        isExecuting={false}
        onConfirm={async () => ({ ok: true })}
        onCancel={() => undefined}
        onSendChoice={() => undefined}
      />,
    );
  });

  expect(tree.root.findAllByType("quick-reply-chips")).toHaveLength(1);
  expect(tree.root.findAllByType("clarifying-card")).toHaveLength(0);
  tree.unmount();
});
