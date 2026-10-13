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
 * kit). The wizard wiring is pinned by source assertions, per the repo's
 * node-jest convention for RN components.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

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

// ---------------------------------------------------------------------------
// Wizard wiring (source).
// ---------------------------------------------------------------------------

const read = (relative: string): string =>
  readFileSync(path.join(process.cwd(), relative), "utf8");
const WIZARD = read("src/components/rsvp/RsvpCreatorWizard.tsx");
const SETUP = read("src/components/rsvp/RsvpStep5Setup.tsx");
const ROUTE = read("app/rsvp/[id]/edit.tsx");

const between = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(to, start + from.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("#3645 — Publish opens the choice instead of refusing", () => {
  const tap = between(
    WIZARD,
    "const handlePublishTap = useCallback(async (): Promise<void> => {",
    "const handleCloseChipInChoice = useCallback(",
  );

  test("chip-ins on + brand known not to collect → the choice, before any publish dialog", () => {
    const choice = tap.indexOf("openChipInChoice();");
    const confirm = tap.indexOf("setPublishConfirmVisible(true);");
    expect(choice).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(choice);
    expect(tap).toContain("liveDraft.rsvpContributionEnabled &&");
    expect(tap).toContain("chipInReadinessKnown &&");
    expect(tap).toContain("!chipInPayoutReady");
  });

  test("validation errors still come first", () => {
    expect(tap.indexOf("validateRsvpPublish(liveDraft)")).toBeLessThan(
      tap.indexOf("openChipInChoice();"),
    );
  });

  test("readiness is only trusted once it has loaded without error", () => {
    expect(WIZARD).toContain("!chipInStripeStatus.isLoading &&");
    expect(WIZARD).toContain("!chipInStripeStatus.isError;");
  });

  test("a server refusal for chip-ins opens the same choice, not a toast and a trip to bank setup", () => {
    const publish = between(
      WIZARD,
      "const handleConfirmPublish = useCallback(async (): Promise<void> => {",
      "const handleFixJump = useCallback(",
    );
    const refusal = publish.indexOf(
      'detectPaidPublishGuardReason(code) === "stripe_charges_disabled"',
    );
    const legacy = publish.indexOf(
      'guardCopy !== null && guardCopy.action === "stripe_onboarding"',
    );
    expect(refusal).toBeGreaterThan(-1);
    // Checked BEFORE the legacy money-setup branch, which toasts and navigates.
    expect(legacy).toBeGreaterThan(refusal);
    const block = publish.slice(refusal, legacy);
    expect(block).toContain("setPublishConfirmVisible(false);");
    expect(block).toContain(
      "setTimeout(openChipInChoice, CHIP_IN_CHOICE_SETTLE_MS);",
    );
    expect(block).toContain("return;");
    expect(block).not.toContain("handleShowToast");
    expect(block).not.toContain("onOpenStripeOnboard");
    // The reason is read with the plain-object-safe reader.
    expect(publish).toContain("const code = readRpcFailureMessage(error);");
  });

  test("the dialog is loaded on first opening and wired to the three handlers", () => {
    expect(WIZARD).toContain('() => import("./RsvpChipInBankChoiceDialog"),');
    expect(WIZARD).not.toContain('from "./RsvpChipInBankChoiceDialog"');
    expect(WIZARD).toContain("{chipInChoiceLoaded ? (");
    expect(WIZARD).toContain("<LazyRsvpChipInBankChoiceDialog");
    expect(WIZARD).toContain("visible={chipInChoiceVisible}");
    expect(WIZARD).toContain("onClose={handleCloseChipInChoice}");
    expect(WIZARD).toContain("onConnectBank={handleChipInChoiceConnectBank}");
    expect(WIZARD).toContain(
      "onPublishWithoutChipIns={handleChipInChoicePublishWithout}",
    );
  });
});

describe("#3645 — the two choices", () => {
  test("Connect bank: closes the dialog and opens bank setup with the current step", () => {
    const body = between(
      WIZARD,
      "const handleChipInChoiceConnectBank = useCallback((): void => {",
      "}, [onOpenStripeOnboard, currentStep]);",
    );
    expect(body).toContain("setChipInChoiceVisible(false);");
    expect(body).toContain("onOpenStripeOnboard?.(currentStep);");
    expect(body).not.toContain("rsvpContributionEnabled");
  });

  test("Publish without chip-ins: chip-ins off on the draft FIRST, then the normal publish", () => {
    const body = between(
      WIZARD,
      "const handleChipInChoicePublishWithout = useCallback((): void => {",
      "}, [handleUpdate]);",
    );
    const off = body.indexOf("handleUpdate({ rsvpContributionEnabled: false });");
    const resume = body.indexOf("resumePublishRef.current()");
    expect(off).toBeGreaterThan(-1);
    expect(resume).toBeGreaterThan(off);
    // It resumes the wizard's own publish (confirmation and invite checks
    // included) once this dialog has finished dismissing.
    expect(body).toContain("CHIP_IN_CHOICE_SETTLE_MS");
    expect(WIZARD).toContain("void handlePublishTap();");
  });

  test("the publish that follows uses the draft AFTER chip-ins were switched off", () => {
    expect(WIZARD).toContain("const draftToPublish = latestDraftRef.current;");
    const update = between(
      WIZARD,
      "const handleUpdate = useCallback(",
      "[draftId, markDraftDirty, queueAutosave, updateDraft],",
    );
    expect(update).toContain("latestDraftRef.current = nextDraft;");
  });

  test("the settle delay equals deferAfterDismiss's", () => {
    const value = /export const CHIP_IN_CHOICE_SETTLE_MS = (\d+);/.exec(WIZARD);
    expect(value).not.toBeNull();
    const sheet = /export const UNMOUNT_DELAY_MS\s*=\s*(\d+)/.exec(
      read("src/components/ui/SheetMobile.tsx"),
    ) as RegExpExecArray;
    const modal = /export const UNMOUNT_DELAY_MS\s*=\s*(\d+)/.exec(
      read("src/components/ui/Modal.tsx"),
    ) as RegExpExecArray;
    const margin = /const SETTLE_MARGIN_MS\s*=\s*(\d+)/.exec(
      read("src/utils/deferAfterDismiss.ts"),
    ) as RegExpExecArray;
    expect(Number((value as RegExpExecArray)[1])).toBe(
      Math.max(Number(sheet[1]), Number(modal[1])) + Number(margin[1]),
    );
  });
});

describe("#3645 — the Setup step callout", () => {
  test("draft wizard: says the draft saves either way and offers Connect bank", () => {
    expect(SETUP).toContain(
      '"Your draft saves either way. Connect now, or choose when you publish.";',
    );
    expect(SETUP).toContain("{onConnectChipInBank !== undefined ? (");
    expect(SETUP).toContain("onPress={onConnectChipInBank}");
    expect(SETUP).toContain('accessibilityLabel="Connect bank"');
    expect(SETUP).toContain('testID="rsvp-contribution-connect-bank"');
  });

  test("the published-RSVP edit screen keeps the original callout (no draft claim)", () => {
    expect(SETUP).toContain("you'll be prompted to finish setup when");
    const edit = read("src/components/event/EditPublishedScreen.tsx");
    expect(edit).not.toContain("onConnectChipInBank");
  });

  test("only the Setup step receives the action, so the other steps' props stay stable", () => {
    const step = between(WIZARD, "<RsvpStep5Setup", "/>");
    expect(step).toContain("onConnectChipInBank={");
    const base = between(WIZARD, "const baseProps = {", "};");
    expect(base).not.toContain("onConnectChipInBank");
  });
});

describe("#3645 — a refused RSVP save says why", () => {
  test("the route maps the refusal to truthful copy on both save paths", () => {
    expect(ROUTE).toContain("message: rsvpDraftSaveFailureCopy(error),");
    expect(ROUTE).toContain("if (!isRsvpChipInBankRefusal(autosaveLastError)) return;");
    expect(ROUTE).toContain(
      "setToast({ visible: true, message: RSVP_CHIP_IN_SAVE_REFUSED_COPY });",
    );
  });

  test("the autosave hook exposes the failure it already tracked", () => {
    const hook = read("src/hooks/useServerDraftEvents.ts");
    expect(hook).toContain("lastError: hasError ? mutation.error ?? null : null,");
  });
});
