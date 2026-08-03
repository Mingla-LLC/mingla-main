/**
 * issue #1027 — Thread A (native keyboard/viewport) · Symptom 2 · TESTER
 * ADVERSARIAL regression. Different angle from the implementor's happy-path suite
 * (`creatorStep1DescriptionOnFocusReveal.1027.test.ts`), which only source-regexes
 * the presence of `onFocus={() => scrollToBottom?.()}`. This suite MOUNTS the REAL
 * `CreatorStep1Basics`, finds the description field's actual `onFocus`, and FIRES it
 * to prove the behaviour:
 *
 *   ANGLE 1 (error path — the exact defensive claim): rendered with `scrollToBottom`
 *   OMITTED (undefined), focusing the description MUST NOT throw. This is the whole
 *   point of the `?.()` optional call — a regex that the `?.()` text is present does
 *   NOT prove the component survives an undefined prop at runtime. If someone
 *   "cleans up" the optional chain to `scrollToBottom()` the regex could still be
 *   argued around, but THIS test throws.
 *
 *   ANGLE 2 (positive wiring, executed): rendered WITH a spy `scrollToBottom`,
 *   focusing the description calls it (proves the handler is actually wired to the
 *   reveal, not merely present in source).
 *
 * Bare react-test-renderer under the stock mingla-business/jest.config.cjs
 * (react-native → the manual mock, Platform.OS "web"); GlassCard/Input are stubbed
 * at the boundary so only the Basics body renders. react-test-renderer is installed
 * --no-save by the #1027 workflow + the nightly biz suite.
 *
 * FAILS-ON-REVERT (tester-verified): delete `onFocus={() => scrollToBottom?.()}`
 * → ANGLE 2 goes RED (spy never called); change `?.()` to a bare `scrollToBottom()`
 * → ANGLE 1 goes RED (undefined prop throws on focus).
 *
 * I-PROPOSED-1027-WIZARD-MULTILINE-REVEALED-ON-FOCUS.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Break the expo-blur (ESM) chain GlassCard pulls in, and stub the heavy
// children so only the Basics body renders under node/ts-jest.
jest.mock("expo-blur", () => ({ __esModule: true, BlurView: (): null => null }));
jest.mock("../../ui/GlassCard", () => ({
  __esModule: true,
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../ui/Input", () => ({ __esModule: true, Input: (): null => null }));

import { CreatorStep1Basics } from "../CreatorStep1Basics";
import { buildDraftEvent } from "../../../store/draftEventStore";

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (p: (n: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

/** Mount CreatorStep1Basics; `scrollToBottom` omitted unless provided. */
async function mount(
  scrollToBottom?: () => void,
): Promise<Tree> {
  let created: Tree | undefined;
  await TestRenderer.act(() => {
    const props: Record<string, unknown> = {
      draft: buildDraftEvent("brand_1027_adv"),
      updateDraft: () => undefined,
      errors: [],
      showErrors: false,
      onShowToast: () => undefined,
    };
    if (scrollToBottom !== undefined) props.scrollToBottom = scrollToBottom;
    created = TestRenderer.create(
      React.createElement(
        CreatorStep1Basics as unknown as React.FC<Record<string, unknown>>,
        props,
      ),
    );
  });
  return created as Tree;
}

/** The multiline description input (accessibilityLabel "Event description"). */
function descriptionOnFocus(tree: Tree): () => void {
  const nodes = tree.root.findAll(
    (n) =>
      n.props !== undefined &&
      n.props.accessibilityLabel === "Event description" &&
      typeof n.props.onFocus === "function",
  );
  expect(nodes.length).toBeGreaterThan(0);
  return nodes[0].props.onFocus as () => void;
}

describe("issue #1027 · Symptom 2 ADVERSARIAL — description onFocus reveal (executed)", () => {
  test("ANGLE 1: focusing the description with scrollToBottom OMITTED does not throw", async () => {
    const tree = await mount(/* scrollToBottom undefined */);
    const onFocus = descriptionOnFocus(tree);
    let threw = false;
    await TestRenderer.act(() => {
      try {
        onFocus();
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("ANGLE 2: focusing the description invokes the provided scrollToBottom reveal", async () => {
    const calls: number[] = [];
    const spy = (): void => {
      calls.push(Date.now());
    };
    const tree = await mount(spy);
    const onFocus = descriptionOnFocus(tree);
    await TestRenderer.act(() => {
      onFocus();
    });
    expect(calls.length).toBeGreaterThanOrEqual(1);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });
});
