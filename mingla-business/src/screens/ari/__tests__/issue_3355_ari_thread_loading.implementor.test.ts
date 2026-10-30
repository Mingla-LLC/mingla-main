/**
 * #3355 — selecting an existing conversation must never flash an empty thread.
 * The query already exposes its loading state; the screen owns the visible,
 * motion-aware transition while canonical messages are fetched.
 */

import fs from "fs";
import path from "path";
import React from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("../../../components/ari/AriOrb", () => ({
  AriOrb: (props: Record<string, unknown>) =>
    React.createElement("AriOrbStub", props),
}));

// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void) => void;
  create: (node: React.ReactElement) => { toJSON: () => JsonNode };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AriThreadLoadingState } = require("../AriThreadLoadingState") as {
  AriThreadLoadingState: React.ComponentType;
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

const screen = fs.readFileSync(
  path.join(__dirname, "../AriChatScreen.tsx"),
  "utf8",
);

describe("#3355 Ari thread loading transition", () => {
  it("renders a labelled thinking orb until the selected thread is ready", () => {
    let tree: { toJSON: () => JsonNode } | null = null;
    act(() => {
      tree = create(React.createElement(AriThreadLoadingState));
    });
    const nodes = collect(
      (tree as unknown as { toJSON: () => JsonNode }).toJSON(),
    );
    const progress = nodes.find(
      (node) => node.props.accessibilityLabel === "Opening Ari conversation",
    );
    const orb = nodes.find((node) => node.type === "AriOrbStub");
    const text = nodes.flatMap((node) => node.children ?? [])
      .filter((child): child is string => typeof child === "string")
      .join(" ");

    expect(progress?.props.accessibilityRole).toBe("progressbar");
    expect(progress?.props.accessibilityLiveRegion).toBe("polite");
    expect(orb?.props).toMatchObject({ size: "md", thinking: true, decorative: true });
    expect(text).toContain("Opening conversation…");
  });

  it("resolves the loading branch before either the empty state or MessageList", () => {
    const loading = screen.indexOf(
      "chat.conversationId && chat.isLoadingMessages",
    );
    const empty = screen.indexOf(") : noMessages ? (");
    const messages = screen.indexOf("<MessageList", empty);
    expect(loading).toBeGreaterThan(-1);
    expect(screen).toContain("<AriThreadLoadingState />");
    expect(loading).toBeLessThan(empty);
    expect(empty).toBeLessThan(messages);
  });
});
