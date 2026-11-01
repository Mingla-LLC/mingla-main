/**
 * #3355 P3 — Ari flow cards on the Host (implementor happy path + adversarial).
 *
 * 1. Only the flow run's current card is answerable. Every other flow card is
 *    locked with words a screen reader announces: "Answered" or "Replaced by a
 *    newer question" (I-ARI-BOUND-ANSWERS).
 * 2. A tap sends a structured answer bound to run, step and question — never
 *    free text the server must re-parse.
 * 3. Offline: the controls are disabled and say "You're offline — I'll pick up
 *    here when you're back".
 * 4. A teammate's run is view-only and says who is working on it.
 * 5. The Host never authors a continuation message after a confirm
 *    (I-ARI-NO-CLIENT-AUTHORED-CONTINUATION), and resumes the flow instead.
 * 6. The wait label says "Ari is still thinking…" when the server is reachable
 *    and still running the turn; "Reconnecting to Ari…" only when it is not.
 */
import * as fs from "fs";
import * as path from "path";
import React from "react";

import type {
  AgentMessage,
  AriFlowAnswer,
  AriFlowArtefact,
  AriFlowState,
} from "../../../services/agentChatService";
import {
  answeredFlowQuestionIds,
  flowCardStatus,
  newestOpenFlowArtefactId,
} from "../ariFlowCards";
import {
  ARI_RECONNECTING_LABEL,
  ARI_STILL_THINKING_LABEL,
  ariWaitLabel,
} from "../ariWaitLabel";

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (node: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    unmount: () => void;
  };
};

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    FlatList: ({
      data,
      renderItem,
    }: {
      data: unknown[];
      renderItem: (args: { item: unknown }) => React.ReactNode;
    }) =>
      ReactModule.createElement(
        "flat-list",
        null,
        ...data.map((item, index) =>
          ReactModule.createElement(
            ReactModule.Fragment,
            { key: index },
            renderItem({ item }),
          ),
        ),
      ),
    Pressable: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement("pressable", props, children),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement("text", props, children),
    View: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement("view", props, children),
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
    tertiaryText: "grey",
  },
  glass: { tint: { profileBase: "x" }, border: { profileBase: "x" } },
  radius: { full: 999 },
  semantic: { error: "red", success: "green", successTint: "green" },
  spacing: { xs: 4, sm: 8, md: 16, xl: 32 },
  typography: { bodySm: { fontSize: 13 }, caption: { fontSize: 12 } },
}));
jest.mock("../ChatBubble", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ChatBubble: () => require("react").createElement("chat-bubble"),
}));
jest.mock("../ToolProposalCard", () => ({ ToolProposalCard: () => null }));
jest.mock("../ResponseCard", () => ({ ResponseCard: () => null }));
jest.mock("../AriAttachmentCards", () => ({
  AriSentAttachments: () => null,
  AriAttachmentTray: () => null,
}));
jest.mock("../QuickReplyChips", () => ({
  QuickReplyChips: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("quick-reply-chips", props),
}));
jest.mock("../ClarifyingCard", () => ({ ClarifyingCard: () => null }));
jest.mock("../MultiSelectPrompt", () => ({ MultiSelectPrompt: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MessageList } = require("../MessageList") as typeof import("../MessageList");

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      requestAnimationFrame: (callback: () => void) => number;
    }
  ).requestAnimationFrame = () => 1;
});

const RUN = "66666666-6666-4666-8666-666666666666";
const Q1 = "77777777-7777-4777-8777-777777777771";
const Q2 = "77777777-7777-4777-8777-777777777772";

function card(question: string, title: string): AriFlowArtefact {
  return {
    schema_version: 1,
    artefact_id: `q:${RUN}:${question}`,
    run_id: RUN,
    step_key: "brand_can_wait",
    question_id: question,
    kind: "question",
    title,
    text: "These can wait.",
    options: [
      { id: "not_now", label: "Not now, keep going" },
      { id: "fix:profile_photo", label: "Add brand logo" },
    ],
  };
}

function ari(id: string, artefact: AriFlowArtefact): AgentMessage {
  return {
    id,
    conversation_id: "c1",
    role: "assistant",
    content: { text: artefact.text, structured: { flow: artefact } },
    client_turn_id: null,
    tool_calls: null,
    tool_results: null,
    created_at: "2026-11-01T10:00:00Z",
  };
}

function owner(id: string, question: string): AgentMessage {
  return {
    id,
    conversation_id: "c1",
    role: "user",
    content: {
      text: "Not now, keep going",
      structured: {
        flow_answer: {
          run_id: RUN,
          step_key: "brand_can_wait",
          question_id: question,
          choice_id: "not_now",
        },
      },
    },
    client_turn_id: "t1",
    tool_calls: null,
    tool_results: null,
    created_at: "2026-11-01T10:01:00Z",
  };
}

function state(current: string | null, viewOnly = false): AriFlowState {
  return {
    run_id: RUN,
    status: "awaiting_owner",
    current_artefact_id: current,
    current_step_key: "brand_can_wait",
    lease_owner_name: null,
    owner_name: "Ada Owner",
    view_only: viewOnly,
  };
}

function mount(props: {
  messages: AgentMessage[];
  flowState?: AriFlowState | null;
  online?: boolean;
  onFlowAnswer?: (answer: AriFlowAnswer, label: string) => void;
}) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      <MessageList
        messages={props.messages}
        pendingAction={null}
        isExecuting={false}
        onConfirm={async () => ({ ok: true })}
        onCancel={() => undefined}
        flowState={props.flowState}
        online={props.online ?? true}
        onFlowAnswer={props.onFlowAnswer}
      />,
    );
  });
  return renderer;
}

const textsOf = (renderer: ReturnType<typeof mount>): string[] =>
  renderer.root
    .findAll((node) => node.type === "text")
    .map((node) => String((node.props.children as unknown) ?? ""));

describe("#3355 P3 flow cards", () => {
  test("happy: the current card is answerable and sends a bound, structured answer", () => {
    const sent: AriFlowAnswer[] = [];
    const first = card(Q1, "Before your event goes live");
    const renderer = mount({
      messages: [ari("a1", first)],
      flowState: state(first.artefact_id),
      onFlowAnswer: (answer) => sent.push(answer),
    });
    const chips = renderer.root.findAll((n) => n.type === "quick-reply-chips");
    expect(chips).toHaveLength(1);
    expect(chips[0].props.disabled).toBe(false);
    TestRenderer.act(() => {
      (chips[0].props.onSelectId as (id: string) => void)("fix:profile_photo");
    });
    expect(sent).toEqual([
      {
        run_id: RUN,
        step_key: "brand_can_wait",
        question_id: Q1,
        choice_id: "fix:profile_photo",
        display_text: "Add brand logo",
      },
    ]);
    renderer.unmount();
  });

  test("adversarial: older cards lock with announced words — Answered vs Replaced", () => {
    const first = card(Q1, "First question");
    const second = card(Q2, "Second question");
    const third = card("77777777-7777-4777-8777-777777777773", "Third question");
    const renderer = mount({
      messages: [ari("a1", first), owner("u1", Q1), ari("a2", second), ari("a3", third)],
      flowState: state(third.artefact_id),
    });
    const chips = renderer.root.findAll((n) => n.type === "quick-reply-chips");
    expect(chips).toHaveLength(1);
    const locked = renderer.root.findAll(
      (n) =>
        n.type === "text" &&
        (n.props.accessibilityState as { disabled?: boolean } | undefined)
          ?.disabled === true,
    );
    // The thread is an inverted list; compare as a set.
    expect(locked.map((n) => n.props.accessibilityLabel).sort()).toEqual([
      "First question. Answered.",
      "Second question. Replaced by a newer question.",
    ]);
    renderer.unmount();
  });

  test("adversarial: a card the server says is not current never accepts a tap, even if newest", () => {
    const first = card(Q1, "Only card");
    const renderer = mount({ messages: [ari("a1", first)], flowState: state(null) });
    expect(renderer.root.findAll((n) => n.type === "quick-reply-chips")).toHaveLength(0);
    expect(textsOf(renderer)).toContain("Replaced by a newer question");
    renderer.unmount();
  });

  test("adversarial: offline disables answers and says so", () => {
    const first = card(Q1, "Q");
    const renderer = mount({
      messages: [ari("a1", first)],
      flowState: state(first.artefact_id),
      online: false,
    });
    const chips = renderer.root.findAll((n) => n.type === "quick-reply-chips");
    expect(chips[0].props.disabled).toBe(true);
    expect(textsOf(renderer)).toContain(
      "You're offline — I'll pick up here when you're back.",
    );
    renderer.unmount();
  });

  test("adversarial: a teammate's run is view-only and names who is on it", () => {
    const first = card(Q1, "Q");
    const renderer = mount({
      messages: [ari("a1", first)],
      flowState: state(first.artefact_id, true),
    });
    expect(renderer.root.findAll((n) => n.type === "quick-reply-chips")).toHaveLength(0);
    expect(textsOf(renderer)).toContain(
      "Ada Owner is working on this. You can follow along here.",
    );
    renderer.unmount();
  });

  test("before the server answers, only the newest unanswered card is live", () => {
    const first = card(Q1, "A");
    const second = card(Q2, "B");
    const messages = [ari("a1", first), ari("a2", second)];
    expect(newestOpenFlowArtefactId(messages)).toBe(second.artefact_id);
    expect(
      newestOpenFlowArtefactId([...messages, owner("u2", Q2)]),
    ).toBeNull();
    const answered = answeredFlowQuestionIds([owner("u1", Q1)]);
    expect(
      flowCardStatus({
        artefact: first,
        flowState: undefined,
        answered,
        fallbackCurrentId: first.artefact_id,
      }),
    ).toBe("answered");
  });
});

describe("#3355 P3 Host never authors a continuation", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const screen = fs.readFileSync(
    path.join(repoRoot, "mingla-business/src/screens/ari/AriChatScreen.tsx"),
    "utf8",
  );
  test("no client-authored Continue message after confirm; resume instead", () => {
    expect(screen).not.toMatch(/sendMessage\(\s*["'`]Continue /);
    expect(screen).not.toMatch(/Continue Website setup: resume/);
    expect(screen).toMatch(/chat\.applyFlowState\(result\.flow_state\)/);
    expect(screen).toMatch(/chat\.resumeFlow\("handoff_return"\)/);
  });
});

describe("#3355 P3 wait label", () => {
  test("a reachable server still working reads as thinking, not reconnecting", () => {
    expect(ariWaitLabel({ reconciling: false }, "Thinking…")).toBe("Thinking…");
    expect(ariWaitLabel({ reconciling: true, serverWorking: true }, "x")).toBe(
      ARI_STILL_THINKING_LABEL,
    );
    expect(ariWaitLabel({ reconciling: true, serverWorking: false }, "x")).toBe(
      ARI_RECONNECTING_LABEL,
    );
  });
});
