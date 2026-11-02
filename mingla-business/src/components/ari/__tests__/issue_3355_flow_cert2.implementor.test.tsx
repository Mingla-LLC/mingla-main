/**
 * #3355 — Ari Website setup, second live certification (8/8, local Sites
 * stack, 2026-11-01): Host fixes.
 *
 * D1. After "I checked; your plan approval isn't there yet" the card Ari
 *     shows again is live with its buttons (the owner's earlier "check"
 *     answer no longer marks it "Answered").
 * D3. Discarding a failed message removes its "Ari couldn't finish this
 *     response" banner, and a later turn clears an older failure's banner.
 * D6. A logo / cover handoff takes the upload right in the chat through the
 *     SAME pickers Brand details uses; a finished upload asks Ari to check.
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
  flowUploadAnswer,
  flowUploadKind,
  type AriFlowUploadKind,
} from "../ariFlowCards";
import {
  activityTurnOf,
  isAriTurnDiscardable,
  type AriTurnActivityInput,
} from "../../../services/ariTurnView";

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

function handoff(item: string, title: string): AriFlowArtefact {
  return {
    schema_version: 1,
    artefact_id: `h:${RUN}:${Q1}`,
    run_id: RUN,
    step_key: item === "approved_plan" ? "approve" : "brand",
    question_id: Q1,
    kind: "handoff",
    title,
    text: `${title}.`,
    options: [
      { id: "open", label: "Open it", route: "/brand/b1/edit?section=photo" },
      { id: "check", label: "I've done it, check now" },
    ],
    handoff: {
      item_key: item,
      item_label: title,
      route: "/brand/b1/edit?section=photo",
      route_label: "Brand details",
      can_caller_fix: true,
      who_can_fix: "you",
    },
  } as AriFlowArtefact;
}

function ari(id: string, artefact: AriFlowArtefact, text?: string): AgentMessage {
  return {
    id,
    conversation_id: "c1",
    role: "assistant",
    content: { text: text ?? artefact.text, structured: { flow: artefact } },
    client_turn_id: null,
    tool_calls: null,
    tool_results: null,
    created_at: "2026-11-01T10:00:00Z",
  };
}

function checkAnswer(id: string, artefact: AriFlowArtefact): AgentMessage {
  return {
    id,
    conversation_id: "c1",
    role: "user",
    content: {
      text: "I've approved it, check now",
      structured: {
        flow_answer: {
          run_id: RUN,
          step_key: artefact.step_key,
          question_id: artefact.question_id,
          choice_id: "check",
        },
      },
    },
    client_turn_id: "t1",
    tool_calls: null,
    tool_results: null,
    created_at: "2026-11-01T10:01:00Z",
  };
}

function state(current: string | null): AriFlowState {
  return {
    run_id: RUN,
    status: "awaiting_handoff",
    current_artefact_id: current,
    current_step_key: "approve",
    lease_owner_name: null,
    owner_name: "Ada Owner",
    view_only: false,
  };
}

function mount(props: {
  messages: AgentMessage[];
  flowState?: AriFlowState | null;
  onFlowAnswer?: (answer: AriFlowAnswer, label: string) => void;
  renderFlowUpload?: (args: {
    kind: AriFlowUploadKind;
    disabled: boolean;
    onUploaded: () => void;
  }) => React.ReactNode;
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
        online
        onFlowAnswer={props.onFlowAnswer}
        onFlowRoute={() => undefined}
        renderFlowUpload={props.renderFlowUpload}
      />,
    );
  });
  return renderer;
}

const textsOf = (renderer: ReturnType<typeof mount>): string[] =>
  renderer.root
    .findAll((node) => node.type === "text")
    .map((node) => String((node.props.children as unknown) ?? ""));

const repoRoot = path.resolve(__dirname, "../../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(repoRoot, relative), "utf8");

describe("#3355 cert round 2 — D1 a failed check keeps the live card", () => {
  test("the card shown again after a failed check is live with its buttons, not Answered", () => {
    const approval = handoff("approved_plan", "Review and approve your plan");
    const messages = [
      ari("a1", approval),
      checkAnswer("u1", approval),
      ari(
        "a2",
        approval,
        "I checked; your plan approval isn't there yet. Here's the same step whenever you're ready.",
      ),
    ];
    expect(answeredFlowQuestionIds(messages).has(Q1)).toBe(false);
    // Answered until Ari shows it again.
    expect(answeredFlowQuestionIds(messages.slice(0, 2)).has(Q1)).toBe(true);
    const renderer = mount({
      messages,
      flowState: state(approval.artefact_id),
    });
    const chips = renderer.root.findAll((n) => n.type === "quick-reply-chips");
    expect(chips).toHaveLength(1);
    expect(chips[0].props.state).toBe("default");
    expect(chips[0].props.disabled).toBe(false);
    const texts = textsOf(renderer);
    expect(texts).not.toContain("Answered");
    expect(texts).toContain("Continued below");
    expect(
      flowCardStatus({
        artefact: approval,
        flowState: state(approval.artefact_id),
        answered: answeredFlowQuestionIds(messages),
        fallbackCurrentId: null,
      }),
    ).toBe("live");
    renderer.unmount();
  });
});

describe("#3355 cert round 2 — D3 a discarded or superseded failure leaves no banner", () => {
  const turn = (
    over: Partial<AriTurnActivityInput>,
  ): AriTurnActivityInput & { id: string } => ({
    id: Math.random().toString(36),
    delivery: "sent",
    accepted: true,
    attemptStatus: "completed",
    attemptNumber: 1,
    events: [],
    ...over,
  });

  test("an older failure's banner is cleared by any later turn", () => {
    const failed = turn({ attemptStatus: "failed" });
    expect(activityTurnOf([failed])).toBe(failed);
    const later = turn({ attemptStatus: "completed" });
    expect(activityTurnOf([failed, later])).toBeNull();
    const sending = turn({ delivery: "sending", attemptStatus: "running" });
    expect(activityTurnOf([failed, sending])).toBe(sending);
    const stopped = turn({ delivery: "stopped" });
    expect(activityTurnOf([stopped, later])).toBeNull();
    expect(activityTurnOf([])).toBeNull();
  });

  test("a failed turn the server accepted can be discarded; a live or answered one cannot", () => {
    expect(
      isAriTurnDiscardable({
        delivery: "failed",
        accepted: true,
        attemptStatus: "failed",
      }),
    ).toBe(true);
    expect(
      isAriTurnDiscardable({
        delivery: "sent",
        accepted: true,
        attemptStatus: "failed",
      }),
    ).toBe(true);
    expect(
      isAriTurnDiscardable({
        delivery: "failed",
        accepted: false,
        attemptStatus: null,
      }),
    ).toBe(true);
    expect(
      isAriTurnDiscardable({
        delivery: "sent",
        accepted: true,
        attemptStatus: "completed",
      }),
    ).toBe(false);
    expect(
      isAriTurnDiscardable({
        delivery: "sending",
        accepted: true,
        attemptStatus: "running",
      }),
    ).toBe(false);
  });

  test("the chat hook uses both rules", () => {
    const hook = read("mingla-business/src/hooks/useAgentChat.ts");
    expect(hook).toMatch(/const candidate = activityTurnOf\(scopedTurns\);/);
    expect(hook).toMatch(/if \(!turn \|\| !isAriTurnDiscardable\(turn\)\) return;/);
    expect(hook).not.toMatch(/if \(!turn \|\| turn\.accepted\) return;\s*replaceTurns/);
  });
});

describe("#3355 cert round 2 — D6 in-chat logo and cover upload", () => {
  test("only a live logo or cover handoff with a check choice takes an upload", () => {
    expect(flowUploadKind(handoff("profile_photo", "Upload your logo"))).toBe("logo");
    expect(flowUploadKind(handoff("cover_media", "Add cover media"))).toBe("cover");
    expect(flowUploadKind(handoff("approved_plan", "Approve"))).toBeNull();
    const noCheck = {
      ...handoff("profile_photo", "Logo"),
      options: [{ id: "open", label: "Open", route: "/x" }],
    };
    expect(flowUploadKind(noCheck)).toBeNull();
    expect(flowUploadAnswer(handoff("profile_photo", "Logo"), "logo")).toEqual({
      answer: {
        run_id: RUN,
        step_key: "brand",
        question_id: Q1,
        choice_id: "check",
        display_text: "I've uploaded my logo",
      },
      label: "I've uploaded my logo",
    });
  });

  test("the live logo card shows the upload; a finished upload asks Ari to check", () => {
    const logo = handoff("profile_photo", "Upload your logo");
    const sent: AriFlowAnswer[] = [];
    const uploads: Array<{ kind: string; onUploaded: () => void }> = [];
    const renderer = mount({
      messages: [ari("a1", logo)],
      flowState: state(logo.artefact_id),
      onFlowAnswer: (answer) => sent.push(answer),
      renderFlowUpload: (args) => {
        uploads.push(args);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("react").createElement("flow-upload", args);
      },
    });
    expect(renderer.root.findAll((n) => n.type === "flow-upload")).toHaveLength(1);
    expect(uploads[0].kind).toBe("logo");
    // Brand details stays the second way.
    expect(renderer.root.findAll((n) => n.type === "quick-reply-chips")).toHaveLength(1);
    TestRenderer.act(() => uploads[0].onUploaded());
    expect(sent.map((answer) => [answer.choice_id, answer.display_text])).toEqual([
      ["check", "I've uploaded my logo"],
    ]);
    renderer.unmount();
  });

  test("a replaced logo card offers no upload", () => {
    const logo = handoff("profile_photo", "Upload your logo");
    const renderer = mount({
      messages: [ari("a1", logo)],
      flowState: state("q:other"),
      renderFlowUpload: (args) =>
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("react").createElement("flow-upload", args),
    });
    expect(renderer.root.findAll((n) => n.type === "flow-upload")).toHaveLength(0);
    renderer.unmount();
  });

  test("the upload card reuses Brand details' own pickers, loaded lazily by the chat screen", () => {
    const card = read("mingla-business/src/components/ari/AriFlowUploadCard.tsx");
    // The avatar picker loads through its one lazy owner (#3493), shared with Brand Edit.
    expect(card).toMatch(/import \{ LazyBrandAvatarPickerSheet \} from "\.\.\/brand\/LazyBrandAvatarPickerSheet";/);
    expect(read("mingla-business/src/components/brand/LazyBrandAvatarPickerSheet.tsx")).toMatch(
      /import\("\.\/BrandAvatarPickerSheet"\)/,
    );
    expect(card).toMatch(/import \{ CoverPickerSheet \} from "\.\.\/ui\/CoverPickerSheet";/);
    expect(card).toMatch(/kind: "brand",/);
    // No second upload path: no storage or brand write of its own.
    expect(card).not.toMatch(/supabase|uploadBrandAvatar|uploadBrandCover|useUpdateBrand/);
    const screen = read("mingla-business/src/screens/ari/AriChatScreen.tsx");
    expect(screen).toMatch(/React\.lazy\(\(\) =>\s*import\("\.\.\/\.\.\/components\/ari\/AriFlowUploadCard"\)/);
    expect(screen).toMatch(/renderFlowUpload=\{/);
  });
});
