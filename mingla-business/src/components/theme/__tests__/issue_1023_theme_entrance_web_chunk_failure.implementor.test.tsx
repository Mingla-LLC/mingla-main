// issue #1023 review — a motion chunk that fails to load must never crash the
// page. The web entry (ThemeEntranceAnimation.web) loads the player chunk on
// first mount; here that import REJECTS (as a 404 chunk or deploy skew does).
// Pins: the shell renders null, nothing reaches an error boundary, and the
// next mount retries and shows the player.
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

type Node = { type: unknown; props: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; toJSON: () => unknown };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};
const act = TestRenderer.act;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const chunk = { fail: true, loads: 0 };
jest.mock("../../../../../packages/offering-rendering/ThemeEntranceAnimationWebImpl", () => {
  chunk.loads += 1;
  if (chunk.fail) throw new Error("ChunkLoadError: 404 ThemeEntranceAnimationWebImpl.bundle");
  const R = jest.requireActual<typeof import("react")>("react");
  return { ThemeEntranceAnimation: () => R.createElement("MotionPlayer", { testID: "motion-player" }) };
});

// eslint-disable-next-line import/first
import { ThemeEntranceAnimation } from "../../../../../packages/offering-rendering/ThemeEntranceAnimation.web";
// eslint-disable-next-line import/first
import type { ResolvedTheme } from "../../../../../packages/offering-rendering/designTokens";

const theme: ResolvedTheme = {
  color: "#eb7825",
  foregroundColor: "#000000",
  font: "inter",
  fontFamilyValue: "Inter_500Medium",
  animation: "confetti",
};

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): React.ReactNode {
    return this.state.failed ? React.createElement("SomethingBroke") : this.props.children;
  }
}

async function mount(): Promise<Tree> {
  let tree!: Tree;
  await act(async () => {
    tree = TestRenderer.create(
      <Boundary>
        <ThemeEntranceAnimation theme={theme} sessionKey="e:1" />
      </Boundary>,
    );
  });
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return tree;
}

describe("#1023 web motion chunk failure", () => {
  test("a rejected chunk renders nothing and never hits the error boundary", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const tree = await mount();
    expect(chunk.loads).toBe(1);
    expect(tree.root.findAll((n) => n.type === "SomethingBroke")).toHaveLength(0);
    expect(tree.toJSON()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("the failure is forgotten: the next mount retries and shows the player", async () => {
    chunk.fail = false;
    const tree = await mount();
    expect(chunk.loads).toBe(2);
    expect(tree.root.findAll((n) => n.props.testID === "motion-player").length).toBeGreaterThan(0);
  });
});
