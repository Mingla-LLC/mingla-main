/**
 * #4420 — the venue Reviews module was a blank page when a place had no
 * reviews (and when the read failed): LocalReviewsManager returned null. In
 * its "module" variant it now shows loading, an empty state (one line + one
 * short line) and an error state with Try again. The "panel" variant (Stay
 * Overview header) still hides itself.
 *
 * FAILS-ON-REVERT: `if (reviews.length === 0) return null;` for every variant
 * fails blocks 1 and 2.
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (p: (n: Node) => boolean) => Node[] };
  toJSON: () => unknown;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Renderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => void | Promise<void>) => Promise<void> | void;
};

const forClaimedPlace = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
jest.mock("../../../services/localReviewsService", () => ({
  localReviewsService: {
    forClaimedPlace: (...args: unknown[]) => forClaimedPlace(...args),
    reply: jest.fn(),
  },
}));
jest.mock("../../ui/Sheet", () => ({ Sheet: () => null }));
jest.mock("../../programs/ProgramKit", () => ({ SheetBody: () => null }));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Button", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Button: ({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) => (
      <Text onPress={onPress} testID={testID}>{label}</Text>
    ),
  };
});

import { LOCAL_REVIEWS_STATE_COPY, LocalReviewsManager } from "../LocalReviewsManager";

const mounted: Tree[] = [];
afterEach(() => {
  mounted.splice(0).forEach((r) => void Renderer.act(() => r.unmount()));
  forClaimedPlace.mockReset();
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await Renderer.act(async () => {
      await Promise.resolve();
    });
  }
};

const mount = async (variant?: "panel" | "module"): Promise<Tree> => {
  let tree!: Tree;
  await Renderer.act(async () => {
    tree = Renderer.create(<LocalReviewsManager brandId="b1" placePoolId="p1" variant={variant} />);
  });
  mounted.push(tree);
  await flush();
  return tree;
};

const byId = (t: Tree, id: string) =>
  t.root.findAll((n) => n.props.testID === id && typeof n.type === "string");
const text = (t: Tree): string =>
  t.root.findAll((n) => n.type === "Text").map((n) => [n.props.children].flat().join("")).join(" | ");

describe("#4420 Reviews module states", () => {
  test("1. module + no reviews → the empty state, not a blank page", async () => {
    forClaimedPlace.mockResolvedValue([]);
    const t = await mount("module");
    expect(byId(t, "venue-local-reviews-empty").length).toBeGreaterThan(0);
    expect(text(t)).toContain(LOCAL_REVIEWS_STATE_COPY.emptyTitle);
    expect(text(t)).toContain(LOCAL_REVIEWS_STATE_COPY.emptyBody);
  });

  test("2. module + failed read → error state; Try again reloads", async () => {
    forClaimedPlace.mockRejectedValueOnce(new Error("offline"));
    const t = await mount("module");
    expect(byId(t, "venue-local-reviews-error").length).toBeGreaterThan(0);
    expect(text(t)).toContain(LOCAL_REVIEWS_STATE_COPY.errorTitle);
    forClaimedPlace.mockResolvedValueOnce([]);
    const retry = t.root.findAll((n) => n.props.testID === "venue-local-reviews-retry")[0];
    await Renderer.act(async () => {
      (retry.props.onPress as () => void)();
    });
    await flush();
    expect(forClaimedPlace).toHaveBeenCalledTimes(2);
    expect(byId(t, "venue-local-reviews-empty").length).toBeGreaterThan(0);
  });

  test("3. panel (default) still hides itself when empty or failed", async () => {
    forClaimedPlace.mockResolvedValue([]);
    expect((await mount()).toJSON()).toBeNull();
    forClaimedPlace.mockRejectedValue(new Error("offline"));
    expect((await mount("panel")).toJSON()).toBeNull();
  });
});
