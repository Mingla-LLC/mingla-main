/**
 * Issue #2739 — real CoverGalleryRow render/interaction proof.
 *
 * This suite resolves `react-native` to the deployed `react-native-web`
 * adapter. It mounts the real shared row, reads the host nodes RNW emits, and
 * invokes RNW's own click/keyboard PressResponder seam. It intentionally does
 * not duplicate the gallery's role, state, or callback logic in a test helper.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
import { Platform, Pressable } from "react-native";
// @ts-expect-error react-test-renderer ships without declarations here.
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

import { CoverGalleryRow } from "../../../../../packages/offering-rendering/CoverGalleryRow";
import { createThemePalette } from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";

// @ts-expect-error react-test-renderer ships without declarations here.
const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");

type Listener = (event: KeyboardPressEvent) => void;
type ButtonTarget = {
  getAttribute: (name: string) => string | null;
  tagName: "DIV";
};
type KeyboardPressEvent = {
  key: "Enter" | " ";
  nativeEvent: {
    key: "Enter" | " ";
    pageX: number;
    pageY: number;
    target: ButtonTarget;
    type: "keydown" | "keyup";
  };
  persist: jest.Mock;
  preventDefault: jest.Mock;
  stopPropagation: jest.Mock;
  target: ButtonTarget;
};

const listeners = new Map<string, Listener>();
const documentStub = {
  addEventListener: jest.fn((name: string, listener: Listener) => {
    listeners.set(name, listener);
  }),
  removeEventListener: jest.fn((name: string, listener: Listener) => {
    if (listeners.get(name) === listener) listeners.delete(name);
  }),
};

Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: documentStub,
});
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);
const gallery = [
  { url: "", type: "image" as const },
  { url: "", type: "image" as const },
  { url: "", type: "gif" as const },
  { url: "", type: "image" as const },
];

const setPlatform = (os: "ios" | "web"): void => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
};

const mountRow = async ({
  activeIndex = 0,
  coverType = "image",
  items = gallery,
  onSelect = jest.fn(),
}: {
  activeIndex?: number;
  coverType?: "image" | "video";
  items?: typeof gallery;
  onSelect?: (index: number) => void;
} = {}): Promise<ReactTestRenderer> => {
  let tree: ReactTestRenderer | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <CoverGalleryRow
        cover={{
          url: null,
          type: coverType,
        }}
        gallery={items}
        activeIndex={activeIndex}
        onSelect={onSelect}
        palette={palette}
        testID="issue-2739-gallery"
      />,
    );
  });
  if (tree === null) throw new Error("issue_2739_row_render_missing");
  return tree;
};

const hostButtons = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === "string" && node.props.role === "button",
  );

const buttonTarget = (): ButtonTarget => ({
  getAttribute: (name: string) => (name === "role" ? "button" : null),
  tagName: "DIV",
});

const click = (button: ReactTestInstance): void => {
  const target = buttonTarget();
  button.props.onClick({
    altKey: false,
    currentTarget: target,
    defaultPrevented: false,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    target,
  });
};

const pressKey = (
  button: ReactTestInstance,
  key: "Enter" | " ",
): KeyboardPressEvent => {
  const target = buttonTarget();
  const keyDown: KeyboardPressEvent = {
    key,
    nativeEvent: {
      key,
      pageX: 0,
      pageY: 0,
      target,
      type: "keydown",
    },
    persist: jest.fn(),
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    target,
  };
  button.props.onKeyDown(keyDown);
  const keyup = listeners.get("keyup");
  if (keyup === undefined) throw new Error(`issue_2739_keyup_missing:${key}`);
  keyup({
    ...keyDown,
    nativeEvent: { ...keyDown.nativeEvent, type: "keyup" },
  });
  return keyDown;
};

afterEach(() => {
  listeners.clear();
  documentStub.addEventListener.mockClear();
  documentStub.removeEventListener.mockClear();
  setPlatform("web");
});

describe("issue #2739 CoverGalleryRow web semantics", () => {
  it("H-1 emits one named group and five real button hosts", async () => {
    setPlatform("web");
    const tree = await mountRow();
    const groups = tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type === "string" &&
        node.props.role === "group" &&
        node.props["aria-label"] === "Choose cover photo",
    );
    const buttons = hostButtons(tree.root);
    const pressableInputs = tree.root.findAllByType(Pressable);

    expect(groups).toHaveLength(1);
    expect(buttons).toHaveLength(5);
    expect(pressableInputs).toHaveLength(5);
    expect(
      pressableInputs.every(
        (card: ReactTestInstance) =>
          card.props.accessibilityState === undefined,
      ),
    ).toBe(true);
    expect(buttons.map((button) => button.props["aria-label"])).toEqual([
      "Cover",
      "Photo 1 of 4",
      "Photo 2 of 4",
      "Photo 3 of 4",
      "Photo 4 of 4",
    ]);
    expect(buttons.every((button) => button.props.tabIndex === 0)).toBe(true);
    expect(
      buttons.every((button) => button.props["aria-selected"] === undefined),
    ).toBe(true);
    expect(
      buttons.every((button) => button.props["aria-pressed"] === undefined),
    ).toBe(true);
    expect(
      tree.root.findAll(
        (node: ReactTestInstance) =>
          typeof node.type === "string" &&
          node.props.tabIndex === 0 &&
          node.props.role !== "button",
      ),
    ).toHaveLength(0);
  });

  it("H-2 moves the sole current marker without changing control names", async () => {
    setPlatform("web");
    const tree = await mountRow({ activeIndex: 0 });
    const namesBefore = hostButtons(tree.root).map(
      (button) => button.props["aria-label"],
    );
    expect(
      hostButtons(tree.root).map((button) => button.props["aria-disabled"]),
    ).toEqual([true, undefined, undefined, undefined, undefined]);

    await TestRenderer.act(async () => {
      tree.update(
        <CoverGalleryRow
          cover={{ url: null, type: "image" }}
          gallery={gallery}
          activeIndex={2}
          onSelect={jest.fn()}
          palette={palette}
          testID="issue-2739-gallery"
        />,
      );
    });

    const buttonsAfter = hostButtons(tree.root);
    expect(buttonsAfter.map((button) => button.props["aria-label"])).toEqual(
      namesBefore,
    );
    expect(buttonsAfter.map((button) => button.props["aria-disabled"])).toEqual([
      undefined,
      undefined,
      true,
      undefined,
      undefined,
    ]);
    expect(buttonsAfter[2]?.props.tabIndex).toBe(0);
  });

  it.each([
    ["pointer", (button: ReactTestInstance) => click(button)],
    ["Enter", (button: ReactTestInstance) => pressKey(button, "Enter")],
    ["Space", (button: ReactTestInstance) => pressKey(button, " ")],
  ])("H-3 activates an inactive button exactly once with %s", async (_name, activate) => {
    setPlatform("web");
    const onSelect = jest.fn();
    const tree = await mountRow({ onSelect });
    const photoTwo = hostButtons(tree.root)[2];
    if (photoTwo === undefined) throw new Error("issue_2739_photo_two_missing");

    await TestRenderer.act(async () => activate(photoTwo));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("H-4 gives Space native button prevention so the page does not scroll", async () => {
    setPlatform("web");
    const tree = await mountRow();
    const photoOne = hostButtons(tree.root)[1];
    if (photoOne === undefined) throw new Error("issue_2739_photo_one_missing");

    const event = pressKey(photoOne, " ");

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("H-5 keeps the current web button focusable while every activator is a no-op", async () => {
    setPlatform("web");
    const onSelect = jest.fn();
    const tree = await mountRow({ onSelect });
    const current = hostButtons(tree.root)[0];
    if (current === undefined) throw new Error("issue_2739_current_missing");

    await TestRenderer.act(async () => {
      click(current);
      pressKey(current, "Enter");
      pressKey(current, " ");
    });

    expect(current.props.tabIndex).toBe(0);
    expect(current.props["aria-disabled"]).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("H-6 preserves the native imagebutton, selected-state, and selected-name contract", async () => {
    setPlatform("ios");
    const tree = await mountRow({ activeIndex: 1 });
    const nativeCards = tree.root.findAllByType(Pressable);

    expect(nativeCards).toHaveLength(5);
    expect(
      nativeCards.map(
        (card: ReactTestInstance) => card.props.accessibilityRole,
      ),
    ).toEqual([
      "imagebutton",
      "imagebutton",
      "imagebutton",
      "imagebutton",
      "imagebutton",
    ]);
    expect(
      nativeCards.map(
        (card: ReactTestInstance) => card.props.accessibilityState,
      ),
    ).toEqual([
      { selected: false },
      { selected: true },
      { selected: false },
      { selected: false },
      { selected: false },
    ]);
    expect(
      nativeCards.map(
        (card: ReactTestInstance) => card.props.accessibilityLabel,
      ),
    ).toEqual([
      "Cover",
      "Photo 1 of 4, selected",
      "Photo 2 of 4",
      "Photo 3 of 4",
      "Photo 4 of 4",
    ]);
    expect(
      nativeCards.every(
        (card: ReactTestInstance) => card.props.role === undefined,
      ),
    ).toBe(true);
  });

  it("H-7 keeps empty and video-cover behavior unchanged", async () => {
    setPlatform("web");
    const empty = await mountRow({ items: [] });
    expect(empty.toJSON()).toBeNull();

    const video = await mountRow({ coverType: "video" });
    const buttons = hostButtons(video.root);
    expect(buttons[0]?.props["aria-label"]).toBe("Cover, video");
    expect(video.root.findAllByProps({ testID: "cover-play-badge" })).not.toHaveLength(0);
  });
});
