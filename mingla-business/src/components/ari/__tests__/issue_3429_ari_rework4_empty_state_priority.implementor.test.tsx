/**
 * #3429 / #3355 — compact Ari empty-state contract.
 *
 * The hero keeps the no-clipping and no-keyboard-jump geometry from #3429,
 * while #3355 deliberately removes the duplicate composer instruction. The
 * attachment control remains discoverable in the composer itself.
 */

import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../AriOrb", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return {
    AriOrb: (props: Record<string, unknown>): React.ReactElement =>
      ReactModule.createElement("AriOrb", props),
    SIZE_PX: { sm: 34, md: 54, lg: 82 },
    HALO_MULT_PX: { sm: 3, md: 5, lg: 7 },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AriEmptyStateLayoutContext, EmptyState } = require("../EmptyState") as {
  AriEmptyStateLayoutContext: React.Context<{ viewportBottomClampPx: number }>;
  EmptyState: React.FC;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => void) => void;
  create: (el: React.ReactElement) => {
    toJSON: () => JsonNode;
    unmount: () => void;
  };
};

interface JsonNode {
  type: string;
  props: Record<string, unknown>;
  children: Array<JsonNode | string> | null;
}

function textOf(node: JsonNode | string): string[] {
  if (typeof node === "string") return [node];
  return (node.children ?? []).flatMap(textOf);
}

function views(node: JsonNode): JsonNode[] {
  return (node.children ?? []).filter(
    (child): child is JsonNode =>
      typeof child !== "string" && child.type === "View",
  );
}

describe("Ari empty-state priority", () => {
  it("renders one focused hero with the outcome-led copy", () => {
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(
        <AriEmptyStateLayoutContext.Provider
          value={{ viewportBottomClampPx: 0 }}
        >
          <EmptyState />
        </AriEmptyStateLayoutContext.Provider>,
      );
    });
    const tree = root!.toJSON();
    expect(views(tree)).toHaveLength(1);
    expect(textOf(tree).join(" ")).toContain("What should we tackle?");
    expect(textOf(tree).join(" ")).toContain("I'll make a plan");
    act(() => root!.unmount());
  });

  it("does not render a + hint or duplicate attachment instruction", () => {
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(
        <AriEmptyStateLayoutContext.Provider
          value={{ viewportBottomClampPx: 226 }}
        >
          <EmptyState />
        </AriEmptyStateLayoutContext.Provider>,
      );
    });
    const tree = root!.toJSON();
    const copy = textOf(tree).join(" ").toLowerCase();
    expect(copy).not.toContain("attach context");
    expect(copy).not.toContain("files and context");
    expect(copy).not.toContain("tap +");
    expect(JSON.stringify(tree)).not.toContain('"type":"Plus"');
    act(() => root!.unmount());
  });
});
