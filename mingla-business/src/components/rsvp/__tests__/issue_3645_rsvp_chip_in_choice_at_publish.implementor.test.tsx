/**
 * issue #3645 — an RSVP with chip-ins on and no bank gets a CHOICE at Publish.
 *
 * Before: the draft save was refused by the server, and a publish that reached
 * the server was answered with a toast and an unannounced trip to bank setup.
 *
 * After: the draft saves (migration 20270824003645). At Publish the host
 * chooses "Connect bank, then publish" or "Publish without chip-ins for now";
 * the second switches chip-ins off on the draft and carries on into the normal
 * publish. The callout on the Setup step says the draft saves either way and
 * offers "Connect bank".
 *
 * The dialog is MOUNTED here (real component, host-element stubs for the UI
 * kit). How the wizard is WIRED to it (the choice before the publish dialog, a
 * server refusal opening the same choice, chip-ins switched off before the
 * publish continues, the Setup step callout, the truthful save-refusal copy)
 * is enforced by the strict-grep gate
 * .github/scripts/strict-grep/issue-3645-paid-drafts-stop-at-publish.mjs, group C.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("react-native", () => ({
  Platform: {
    OS: "ios",
    select: <T,>(options: { ios?: T; default?: T }): T | undefined =>
      options.ios ?? options.default,
  },
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: "Text",
  View: "View",
}));
jest.mock("../../ui/Modal", () => ({
  Modal: (props: {
    visible: boolean;
    onClose: () => void;
    children: React.ReactNode;
    testID?: string;
  }): React.ReactElement | null =>
    props.visible
      ? React.createElement(
          "ModalProbe",
          { testID: props.testID, onClose: props.onClose },
          props.children,
        )
      : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>): React.ReactElement =>
    React.createElement("ButtonProbe", props),
}));

import {
  RSVP_CHIP_IN_BANK_CHOICE_COPY,
  RsvpChipInBankChoiceDialog,
} from "../RsvpChipInBankChoiceDialog";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
interface Node {
  type: string;
  props: Record<string, unknown>;
  children: (Node | string)[];
}
interface Tree {
  root: {
    findAll: (predicate: (node: Node) => boolean) => Node[];
    findAllByType: (type: string) => Node[];
  };
  toJSON: () => unknown;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (action: () => void | Promise<void>) => Promise<void>;
};

async function mount(
  props: Partial<React.ComponentProps<typeof RsvpChipInBankChoiceDialog>> = {},
): Promise<{
  tree: Tree;
  onClose: jest.Mock;
  onConnectBank: jest.Mock;
  onPublishWithoutChipIns: jest.Mock;
}> {
  const onClose = jest.fn();
  const onConnectBank = jest.fn();
  const onPublishWithoutChipIns = jest.fn();
  let tree: Tree | null = null;
  await renderer.act(async () => {
    tree = renderer.create(
      <RsvpChipInBankChoiceDialog
        visible
        onClose={onClose}
        onConnectBank={onConnectBank}
        onPublishWithoutChipIns={onPublishWithoutChipIns}
        {...props}
      />,
    );
  });
  return {
    tree: tree as unknown as Tree,
    onClose,
    onConnectBank,
    onPublishWithoutChipIns,
  };
}

const texts = (tree: Tree): string[] =>
  tree.root
    .findAllByType("Text")
    .map((node) => node.children.filter((c) => typeof c === "string").join(""));
const button = (tree: Tree, label: string): Node => {
  const found = tree.root
    .findAllByType("ButtonProbe")
    .filter((node) => node.props.label === label);
  expect(found).toHaveLength(1);
  return found[0];
};

describe("#3645 — the chip-in bank choice dialog", () => {
  test("the approved copy, word for word", () => {
    expect(RSVP_CHIP_IN_BANK_CHOICE_COPY).toEqual({
      title: "Chip-ins need a bank",
      body: "Your RSVP is free and can go live now. Guests can only chip in once a bank is connected.",
      primary: "Connect bank, then publish",
      secondary: "Publish without chip-ins for now",
      footnote:
        "Without chip-ins, no money is taken from any guest. You can switch them on later.",
      dismiss: "Not now",
    });
    for (const value of Object.values(RSVP_CHIP_IN_BANK_CHOICE_COPY)) {
      expect(value).not.toMatch(/stripe|paystack/i);
    }
  });

  test("renders the title, the body and the footnote", async () => {
    const { tree } = await mount();
    const shown = texts(tree);
    expect(shown).toContain(RSVP_CHIP_IN_BANK_CHOICE_COPY.title);
    expect(shown).toContain(RSVP_CHIP_IN_BANK_CHOICE_COPY.body);
    expect(shown).toContain(RSVP_CHIP_IN_BANK_CHOICE_COPY.footnote);
    tree.unmount();
  });

  test("renders nothing while closed", async () => {
    const { tree } = await mount({ visible: false });
    expect(tree.toJSON()).toBeNull();
    tree.unmount();
  });

  test("primary connects a bank; it does not publish", async () => {
    const { tree, onConnectBank, onPublishWithoutChipIns, onClose } = await mount();
    const primary = button(tree, "Connect bank, then publish");
    expect(primary.props.variant).toBe("primary");
    await renderer.act(async () => {
      (primary.props.onPress as () => void)();
    });
    expect(onConnectBank).toHaveBeenCalledTimes(1);
    expect(onPublishWithoutChipIns).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    tree.unmount();
  });

  test("secondary publishes without chip-ins; it does not open bank setup", async () => {
    const { tree, onConnectBank, onPublishWithoutChipIns } = await mount();
    const secondary = button(tree, "Publish without chip-ins for now");
    expect(secondary.props.variant).toBe("secondary");
    await renderer.act(async () => {
      (secondary.props.onPress as () => void)();
    });
    expect(onPublishWithoutChipIns).toHaveBeenCalledTimes(1);
    expect(onConnectBank).not.toHaveBeenCalled();
    tree.unmount();
  });

  test("dismissing (button, scrim or Escape) publishes nothing and changes nothing", async () => {
    const { tree, onClose, onConnectBank, onPublishWithoutChipIns } = await mount();
    await renderer.act(async () => {
      (button(tree, "Not now").props.onPress as () => void)();
    });
    const modal = tree.root.findAllByType("ModalProbe")[0];
    await renderer.act(async () => {
      (modal.props.onClose as () => void)();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConnectBank).not.toHaveBeenCalled();
    expect(onPublishWithoutChipIns).not.toHaveBeenCalled();
    tree.unmount();
  });

  test("while it is working every action is disabled and it cannot be dismissed", async () => {
    const { tree, onClose } = await mount({ working: true });
    for (const label of [
      "Connect bank, then publish",
      "Publish without chip-ins for now",
      "Not now",
    ]) {
      expect(button(tree, label).props.disabled).toBe(true);
    }
    const modal = tree.root.findAllByType("ModalProbe")[0];
    await renderer.act(async () => {
      (modal.props.onClose as () => void)();
    });
    expect(onClose).not.toHaveBeenCalled();
    tree.unmount();
  });

  test("a failure is announced inside the dialog", async () => {
    const { tree } = await mount({ errorMessage: "We couldn't publish this RSVP. Try again." });
    const alert = tree.root.findAll(
      (node) => node.props.accessibilityRole === "alert",
    );
    expect(alert).toHaveLength(1);
    expect(alert[0].props["aria-live"]).toBe("assertive");
    tree.unmount();
  });
});
