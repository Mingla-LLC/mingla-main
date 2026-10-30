/** #3355 — Ari feedback is explicit, compact, and independent of icon shims. */
import fs from "node:fs";
import path from "node:path";
import React from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const base = jest.requireActual("react-native");
  const FlatList = (props: Record<string, unknown>): React.ReactElement => {
    const data = (props.data as unknown[]) ?? [];
    const renderItem = props.renderItem as
      | ((info: { item: unknown; index: number }) => React.ReactNode)
      | undefined;
    const cells = data.map((item, index) =>
      ReactModule.createElement(
        "MockCell",
        { key: String(index) },
        renderItem ? renderItem({ item, index }) : null,
      )
    );
    return ReactModule.createElement("FlatList", null, cells);
  };
  return { ...base, FlatList };
});

jest.mock("../ChatBubble", () => ({
  ChatBubble: (props: { text: string }) =>
    React.createElement("ChatBubbleStub", props),
}));
jest.mock("../ToolProposalCard", () => ({
  ToolProposalCard: () => React.createElement("ToolProposalCardStub"),
}));
jest.mock("../ResponseCard", () => ({
  ResponseCard: () => React.createElement("ResponseCardStub"),
}));
jest.mock("../QuickReplyChips", () => ({
  QuickReplyChips: () => React.createElement("QuickReplyChipsStub"),
}));
jest.mock("../ClarifyingCard", () => ({
  ClarifyingCard: () => React.createElement("ClarifyingCardStub"),
}));
jest.mock("../MultiSelectPrompt", () => ({
  MultiSelectPrompt: () => React.createElement("MultiSelectPromptStub"),
}));
jest.mock("lucide-react-native", () => ({
  Check: () => React.createElement("CheckStub"),
}));

// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void | Promise<void>) => void | Promise<void>;
  create: (node: React.ReactElement) => { toJSON: () => JsonNode };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MessageList } = require("../MessageList") as {
  MessageList: React.ComponentType<Record<string, unknown>>;
};

interface JsonElement {
  type: string;
  props: Record<string, unknown>;
  children: JsonNode[] | null;
}
type JsonNode = JsonElement | string | null;

const isElement = (node: JsonNode): node is JsonElement =>
  typeof node === "object" && node !== null &&
  typeof (node as JsonElement).type === "string";

function collect(node: JsonNode, out: JsonElement[] = []): JsonElement[] {
  if (!isElement(node)) return out;
  out.push(node);
  for (const child of node.children ?? []) collect(child, out);
  return out;
}

function textOf(node: JsonNode, out: string[] = []): string {
  if (typeof node === "string") out.push(node);
  else if (isElement(node)) {
    for (const child of node.children ?? []) textOf(child, out);
  }
  return out.join(" ");
}

const globalWithRaf = globalThis as unknown as {
  requestAnimationFrame?: (cb: (time: number) => void) => number;
};
globalWithRaf.requestAnimationFrame ??= (cb) => {
  cb(0);
  return 0;
};

const source = fs.readFileSync(
  path.join(__dirname, "../MessageList.tsx"),
  "utf8",
);
const settingsSource = fs.readFileSync(
  path.join(__dirname, "../../../screens/ari/AriSettingsScreen.tsx"),
  "utf8",
);
const proposalSource = fs.readFileSync(
  path.join(__dirname, "../ToolProposalCard.tsx"),
  "utf8",
);
const responseCardSource = fs.readFileSync(
  path.join(__dirname, "../ResponseCard.tsx"),
  "utf8",
);

describe("#3355 mounted Ari reply feedback", () => {
  test("shows named actions and saves a positive decision in the real thread", async () => {
    const onFeedback = jest.fn().mockResolvedValue(undefined);
    let tree: { toJSON: () => JsonNode } | null = null;
    await act(async () => {
      tree = create(
        React.createElement(MessageList, {
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              content: { text: "Here is the finished brief." },
              tool_calls: null,
              tool_results: null,
              created_at: "2026-10-29T12:00:00.000Z",
            },
          ],
          pendingAction: null,
          isExecuting: false,
          onConfirm: async () => ({ ok: true }),
          onCancel: () => undefined,
          onFeedback,
        }),
      );
    });

    const rendered = (): JsonNode =>
      (tree as unknown as { toJSON: () => JsonNode }).toJSON();
    const controls = collect(rendered());
    const helpful = controls.find(
      (node) => node.props.accessibilityLabel === "This Ari reply was helpful",
    );
    const improve = controls.find(
      (node) =>
        node.props.accessibilityLabel === "This Ari reply needs improvement",
    );

    expect(textOf(rendered())).toContain("Was this useful?");
    expect(textOf(rendered())).toContain("Yes");
    expect(textOf(rendered())).toContain("Improve");
    expect(helpful?.props.accessibilityRole).toBe("button");
    expect(improve?.props.accessibilityRole).toBe("button");

    await act(async () => {
      (helpful?.props.onPress as (() => void))();
      await Promise.resolve();
    });
    expect(onFeedback).toHaveBeenCalledWith("assistant-1", "positive");
    expect(textOf(rendered())).toContain("Feedback saved");
  });
});

describe("#3355 Ari reply feedback controls", () => {
  test("names the decision and both actions in visible text", () => {
    expect(source).toContain("Was this useful?");
    expect(source).toMatch(/>\s*Yes\s*<\/Text>/);
    expect(source).toMatch(/>\s*Improve\s*<\/Text>/);
  });

  test("does not depend on thumbs icons that degrade to question marks on web", () => {
    expect(source).not.toMatch(/ThumbsUp|ThumbsDown/);
    expect(source).toContain('accessibilityLabel="This Ari reply was helpful"');
    expect(source).toContain(
      'accessibilityLabel="This Ari reply needs improvement"',
    );
  });

  test("keeps a compact visual control with a 44px effective hit target", () => {
    expect(source).toMatch(/feedbackButton:\s*\{[\s\S]*?minHeight: 34/);
    expect(source.match(/hitSlop=\{5\}/g)).toHaveLength(2);
  });

  test("does not render generic tool-completion badges", () => {
    expect(source).toContain("!toolResultNeedsThreadRow(m.tool_results)");
    expect(source).not.toContain('let label = "Done"');
    expect(responseCardSource).not.toContain(">Done</Text>");
    expect(proposalSource).toContain('accessibilityLabel="View result"');
    expect(proposalSource).not.toContain('accessibilityLabel="Done"');
  });

  test("keeps saved-task diagnostic codes out of host settings", () => {
    expect(settingsSource).toContain("jobErrorCopy(job.last_error_code)");
    expect(settingsSource).toContain(
      'return "This step needs attention before it can continue."',
    );
    expect(settingsSource).not.toContain(
      "Needs attention: {job.last_error_code}",
    );
  });

  test("exposes memory and durable-task controls as named buttons", () => {
    for (const label of [
      'accessibilityLabel="Cancel memory edit"',
      "accessibilityLabel={`Edit ${labelForMemoryKind(note.kind)} memory`}",
      "accessibilityLabel={`Forget ${labelForMemoryKind(note.kind)} memory`}",
      "accessibilityLabel={`Resume ${job.goal_summary}`}",
      "accessibilityLabel={`Pause ${job.goal_summary}`}",
      "accessibilityLabel={`Cancel ${job.goal_summary}`}",
    ]) {
      expect(settingsSource).toContain(label);
    }
    expect(settingsSource).toContain('accessibilityRole="button"');
    expect(settingsSource).toContain("accessibilityState={{");
  });

  test("proposal summaries show the selected brand name, never a UUID fragment", () => {
    expect(proposalSource).toContain(
      'value: brandNamesById[args.brand_id] ?? "Selected brand"',
    );
    expect(proposalSource).not.toContain(
      'value: String(args.brand_id).slice(0, 8) + "…"',
    );
  });
});
