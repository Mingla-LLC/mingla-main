/**
 * #3645 — Continue on an invalid step 1 was silent: it only set a flag, and the
 * red "Add a short description." caption could be off screen. The step now goes
 * to its FIRST invalid field each time Continue is refused.
 *
 * This suite MOUNTS the real `CreatorStep1Basics` (shared by the event and RSVP
 * creators) and drives the `focusFirstErrorSignal` the wizards bump:
 *   - a text field (name, description) takes focus;
 *   - a chip section (party type) cannot take focus, so the wizard body is
 *     scrolled to it and its message is read out;
 *   - the first invalid field in SCREEN order wins;
 *   - nothing happens before Continue is pressed, or when the step is valid.
 *
 * FAILS-ON-REVERT: remove the effect in CreatorStep1Basics and every "goes to"
 * test fails; drop `ref={descriptionRef}` and the description test fails; swap
 * the field order and "screen order wins" fails.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockAnnounced: string[] = [];
// The node test double of react-native has no screen-reader API; give it one
// that records what is read out.
jest.mock("react-native", () => ({
  ...(jest.requireActual("react-native") as Record<string, unknown>),
  AccessibilityInfo: {
    announceForAccessibility: (message: string): void => {
      mockAnnounced.push(message);
    },
  },
}));
jest.mock("expo-blur", () => ({ __esModule: true, BlurView: (): null => null }));
jest.mock("../../ui/GlassCard", () => ({
  __esModule: true,
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
// The name field: a real TextInput host behind the same forwarded ref.
jest.mock("../../ui/Input", () => {
  const ReactActual = jest.requireActual("react") as typeof React;
  const { TextInput } = jest.requireActual("react-native") as {
    TextInput: React.ComponentType<Record<string, unknown>>;
  };
  return {
    __esModule: true,
    Input: ReactActual.forwardRef<unknown, Record<string, unknown>>(
      function MockInput(props, ref) {
        return ReactActual.createElement(TextInput, {
          ref,
          accessibilityLabel: props.accessibilityLabel ?? "Event name",
        });
      },
    ),
  };
});

import { CreatorStep1Basics } from "../CreatorStep1Basics";
import { buildDraftEvent } from "../../../store/draftEventStore";
import type { ValidationError } from "../../../utils/draftEventValidation";

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (p: (n: HostNode) => boolean) => HostNode[] };
  update: (el: React.ReactElement) => void;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (
    el: React.ReactElement,
    options?: { createNodeMock: (element: { props: Record<string, unknown> }) => unknown },
  ) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

const focused: string[] = [];
const scrolledTo: number[] = [];
const announced = mockAnnounced;

const err = (fieldKey: string, message: string): ValidationError => ({
  fieldKey,
  step: 0,
  message,
});
const NAME = err("name", "Event name is required.");
const PARTY = err("partyTypes", "Pick at least one party type.");
const DESCRIPTION = err("description", "Add a short description.");

function element(errors: ValidationError[], signal: number): React.ReactElement {
  return React.createElement(
    CreatorStep1Basics as unknown as React.FC<Record<string, unknown>>,
    {
      draft: buildDraftEvent("brand_3645_step1"),
      updateDraft: () => undefined,
      errors,
      showErrors: signal > 0,
      onShowToast: () => undefined,
      scrollToBottom: () => undefined,
      focusFirstErrorSignal: signal,
      scrollToStepOffset: (y: number) => scrolledTo.push(y),
    },
  );
}

async function mount(errors: ValidationError[], signal: number): Promise<Tree> {
  let created: Tree | undefined;
  await TestRenderer.act(() => {
    created = TestRenderer.create(element(errors, signal), {
      createNodeMock: (node) => ({
        focus: () => focused.push(String(node.props.accessibilityLabel ?? "?")),
      }),
    });
  });
  if (created === undefined) throw new Error("step 1 did not mount");
  return created;
}

async function pressContinue(
  tree: Tree,
  errors: ValidationError[],
  signal: number,
): Promise<void> {
  await TestRenderer.act(() => {
    tree.update(element(errors, signal));
  });
}

/** Give the chip sections a position, as layout would on a device. */
async function layOut(tree: Tree): Promise<void> {
  const sections = tree.root.findAll(
    (n) => typeof n.type === "string" && typeof n.props.onLayout === "function",
  );
  await TestRenderer.act(() => {
    sections.forEach((section, index) => {
      (section.props.onLayout as (e: unknown) => void)({
        nativeEvent: { layout: { y: 300 + index * 200 } },
      });
    });
  });
}

describe("#3645 — a refused Continue on step 1 goes to the first invalid field", () => {
  beforeEach(() => {
    focused.length = 0;
    scrolledTo.length = 0;
    announced.length = 0;
  });

  test("nothing moves before Continue is pressed, even on an invalid step", async () => {
    const tree = await mount([DESCRIPTION], 0);
    expect(focused).toEqual([]);
    expect(scrolledTo).toEqual([]);
    tree.unmount();
  });

  test("an empty description scrolls into view then takes focus (the reported case)", async () => {
    const tree = await mount([DESCRIPTION], 0);
    await layOut(tree);
    await pressContinue(tree, [DESCRIPTION], 1);
    // Scroll first (description is the last onLayout section after chips), then
    // focus on the next tick so the caret sticks when the field was off-screen.
    expect(scrolledTo.length).toBe(1);
    expect(focused).toEqual([]);
    await TestRenderer.act(async () => {
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        } else {
          setTimeout(resolve, 0);
        }
      });
    });
    expect(focused).toEqual(["Event description"]);
    tree.unmount();
  });

  test("an empty name takes focus, and it comes before the description on screen", async () => {
    const tree = await mount([], 0);
    await pressContinue(tree, [DESCRIPTION, NAME], 1);
    expect(focused).toEqual(["Event name"]);
    tree.unmount();
  });

  test("a chip section cannot take focus: the body scrolls to it and its message is read out", async () => {
    const tree = await mount([], 0);
    await layOut(tree);
    await pressContinue(tree, [DESCRIPTION, PARTY], 1);
    expect(focused).toEqual([]);
    expect(scrolledTo).toEqual([300]);
    expect(announced).toEqual(["Pick at least one party type."]);
    tree.unmount();
  });

  test("every refused Continue goes there again, not only the first", async () => {
    const tree = await mount([], 0);
    await pressContinue(tree, [DESCRIPTION], 1);
    await pressContinue(tree, [DESCRIPTION], 2);
    await TestRenderer.act(async () => {
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        } else {
          setTimeout(resolve, 0);
        }
      });
    });
    expect(focused).toEqual(["Event description", "Event description"]);
    tree.unmount();
  });

  test("a valid step moves nothing", async () => {
    const tree = await mount([], 0);
    await pressContinue(tree, [], 1);
    expect(focused).toEqual([]);
    expect(scrolledTo).toEqual([]);
    tree.unmount();
  });
});
