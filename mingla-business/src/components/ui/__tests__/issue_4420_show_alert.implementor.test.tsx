/**
 * #4420 — showAlert: no silent alerts on Host web (Constitution 3).
 *
 * react-native-web implements Alert.alert as a no-op, so ~60 Host alerts
 * (errors, hints, destructive confirms) showed nothing on web. showAlert keeps
 * the Alert.alert call shape: native calls Alert.alert unchanged; web shows a
 * Toast for information and the shared ConfirmDialog (via AlertDialogHost)
 * for choices. The web half (showAlertWeb + WebAlertLayer) loads on first use.
 *
 * WHAT THIS FILE PROVES (behaviour, both platforms)
 *   SA-1 native: Alert.alert gets the same title, message and buttons; no toast, no dialog.
 *   SA-2 web: a button-less alert becomes one error toast carrying title + message.
 *   SA-3 web: `{ kind }` picks the toast kind (a success stays a success).
 *   SA-4 web: Cancel + destructive Delete opens ConfirmDialog with both buttons;
 *        Delete runs only the destructive handler and closes the dialog first.
 *   SA-5 web: Cancel runs only the cancel handler; the destructive one never runs.
 *   SA-6 web: Cancel / Discard / Save opens the dialog's leave variant.
 *   SA-7 web: a second alert waits until the first one is answered.
 *   SA-8 web: a single OK button with a handler runs it when the toast is dismissed.
 *
 * FAILS ON REVERT: make showAlert call Alert.alert on web too and SA-2..SA-8 go red.
 * The I-4420-NO-RAW-ALERT strict-grep rule keeps new raw calls out.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

jest.mock("../ConfirmDialog", () => {
  const { Text, View } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
    View: React.ComponentType<Record<string, unknown>>;
  };
  const Btn = (props: { label: string; onPress: () => void; testID?: string }) => (
    <View accessibilityRole="button" testID={props.testID} onPress={props.onPress}>
      <Text>{props.label}</Text>
    </View>
  );
  // A stand-in with the real props contract: simple = Cancel + Confirm, leave = Save / Discard / Keep.
  const ConfirmDialog = (p: Record<string, any>) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
    <View testID={p.testID} visible={p.visible} variant={p.variant} destructive={p.destructive}>
      <Text>{p.title}</Text>
      <Text>{p.description}</Text>
      {p.variant === "leave" ? (
        <>
          <Btn label={p.saveLabel} onPress={p.onSave} testID={p.saveTestID} />
          <Btn label={p.discardLabel} onPress={p.onDiscard ?? p.onConfirm} testID={p.discardTestID} />
          <Btn label={p.keepLabel} onPress={p.onClose} testID={p.keepTestID} />
        </>
      ) : (
        <>
          <Btn label={p.cancelLabel} onPress={p.onClose} testID={p.cancelTestID} />
          <Btn label={p.confirmLabel} onPress={p.onConfirm} testID={p.confirmTestID} />
        </>
      )}
    </View>
  );
  return { __esModule: true, ConfirmDialog, default: ConfirmDialog };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (work: () => void | Promise<void>) => Promise<void> | void;
};
const RN = require("react-native") as typeof import("react-native");
const { showAlert } = require("../showAlert") as typeof import("../showAlert");
const { resetWebAlertStoreForTest, useWebAlertStore } = require("../showAlertWeb") as typeof import("../showAlertWeb");
const { AlertDialogHost } = require("../AlertDialogHost") as typeof import("../AlertDialogHost");
const { useToastStore, resetToastStoreForTest } = require("../toastStore") as typeof import("../toastStore");

const originalOS = RN.Platform.OS;
const setOS = (os: string): void => {
  Object.defineProperty(RN.Platform, "OS", { configurable: true, get: () => os });
};
let alertSpy: ReturnType<typeof jest.spyOn>;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

async function mountHost(): Promise<Tree> {
  let tree: Tree | undefined;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<AlertDialogHost />);
  });
  return tree as Tree;
}
const byTestID = (tree: Tree, id: string): Node[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === id);
async function press(tree: Tree, id: string): Promise<void> {
  const [node] = byTestID(tree, id);
  expect(node).toBeDefined();
  await TestRenderer.act(async () => {
    node.props.onPress();
    await flush();
  });
}
async function settle(): Promise<void> {
  // The web module and the React.lazy layer resolve on later ticks.
  for (let i = 0; i < 3; i += 1) {
    await TestRenderer.act(async () => {
      await flush();
    });
  }
}

beforeEach(() => {
  resetToastStoreForTest();
  resetWebAlertStoreForTest();
  alertSpy = jest.spyOn(RN.Alert, "alert").mockImplementation(() => undefined);
});
afterEach(() => {
  alertSpy.mockRestore();
  setOS(originalOS);
});

describe("native", () => {
  test("SA-1 calls Alert.alert unchanged", () => {
    setOS("ios");
    const onDelete = jest.fn<() => void>();
    const buttons = [
      { text: "Cancel", style: "cancel" as const },
      { text: "Delete", style: "destructive" as const, onPress: onDelete },
    ];
    showAlert("Delete this template?", "This can't be undone.", buttons);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, passed] = alertSpy.mock.calls[0] as [string, string, typeof buttons];
    expect(title).toBe("Delete this template?");
    expect(message).toBe("This can't be undone.");
    expect(passed).toEqual(buttons);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(useWebAlertStore.getState().queue).toHaveLength(0);
  });

  test("SA-1b native never mounts the web dialog layer", async () => {
    setOS("android");
    const tree = await mountHost();
    showAlert("Disconnect bank?", "Payouts stop.", [{ text: "Cancel", style: "cancel" }, { text: "Disconnect", style: "destructive" }]);
    await settle();
    expect(byTestID(tree, "show-alert-dialog")).toHaveLength(0);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    await TestRenderer.act(() => tree.unmount());
  });
});

describe("web", () => {
  beforeEach(() => setOS("web"));

  test("SA-2 a button-less alert is one error toast with title and message", async () => {
    showAlert("Couldn't cancel", "This send has already started, so it can't be cancelled now.");
    await flush();
    expect(alertSpy).not.toHaveBeenCalled();
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe("error");
    expect(toasts[0].message).toBe("Couldn't cancel. This send has already started, so it can't be cancelled now.");
    toasts[0].onDismiss();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  test("SA-3 the kind option picks the toast kind", async () => {
    showAlert("Saved", "Your preferences are updated.", undefined, { kind: "success" });
    showAlert("Too many photos");
    await flush();
    const [saved, hint] = useToastStore.getState().toasts;
    expect(saved.kind).toBe("success");
    expect(saved.message).toBe("Saved. Your preferences are updated.");
    expect(hint.message).toBe("Too many photos");
  });

  test("SA-4 a destructive confirm keeps two buttons and runs only Delete", async () => {
    const onCancel = jest.fn<() => void>();
    const onDelete = jest.fn<() => void>();
    const tree = await mountHost();
    await TestRenderer.act(() => {
      showAlert("Delete this template?", "This can't be undone.", [
        { text: "Cancel", style: "cancel", onPress: onCancel },
        { text: "Delete", style: "destructive", onPress: onDelete },
      ]);
    });
    await settle();
    const [dialog] = byTestID(tree, "show-alert-dialog");
    expect(dialog.props.visible).toBe(true);
    expect(dialog.props.destructive).toBe(true);
    expect(byTestID(tree, "show-alert-cancel")).toHaveLength(1);
    expect(byTestID(tree, "show-alert-confirm")).toHaveLength(1);
    expect(alertSpy).not.toHaveBeenCalled();

    let openWhenDeleteRan: number | null = null;
    onDelete.mockImplementation(() => {
      openWhenDeleteRan = useWebAlertStore.getState().queue.length;
    });
    await press(tree, "show-alert-confirm");
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(openWhenDeleteRan).toBe(0);
    expect(byTestID(tree, "show-alert-dialog")).toHaveLength(0);
    await TestRenderer.act(() => tree.unmount());
  });

  test("SA-5 Cancel runs only the cancel handler", async () => {
    const onKeep = jest.fn<() => void>();
    const onRevoke = jest.fn<() => void>();
    const tree = await mountHost();
    await TestRenderer.act(() => {
      showAlert("Revoke VIP?", "Nobody can use this link any more.", [
        { text: "Keep link", style: "cancel", onPress: onKeep },
        { text: "Revoke link", style: "destructive", onPress: onRevoke },
      ]);
    });
    await settle();
    await press(tree, "show-alert-cancel");
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onRevoke).not.toHaveBeenCalled();
    expect(byTestID(tree, "show-alert-dialog")).toHaveLength(0);
    await TestRenderer.act(() => tree.unmount());
  });

  test("SA-6 Cancel / Discard / Save is the leave dialog", async () => {
    const onDiscard = jest.fn<() => void>();
    const onSave = jest.fn<() => void>();
    const tree = await mountHost();
    await TestRenderer.act(() => {
      showAlert("Save changes?", "You've edited this template.", [
        { text: "Cancel", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: onDiscard },
        { text: "Save", onPress: onSave },
      ]);
    });
    await settle();
    expect(byTestID(tree, "show-alert-dialog")[0].props.variant).toBe("leave");
    await press(tree, "show-alert-save");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    await TestRenderer.act(() => tree.unmount());
  });

  test("SA-7 a second alert waits for the first", async () => {
    const first = jest.fn<() => void>();
    const second = jest.fn<() => void>();
    const tree = await mountHost();
    await TestRenderer.act(() => {
      showAlert("First?", "", [{ text: "No", style: "cancel" }, { text: "Yes", onPress: first }]);
      showAlert("Second?", "", [{ text: "No", style: "cancel" }, { text: "Yes", onPress: second }]);
    });
    await settle();
    expect(byTestID(tree, "show-alert-dialog")).toHaveLength(1);
    await press(tree, "show-alert-confirm");
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    expect(byTestID(tree, "show-alert-dialog")).toHaveLength(1);
    await press(tree, "show-alert-confirm");
    expect(second).toHaveBeenCalledTimes(1);
    expect(byTestID(tree, "show-alert-dialog")).toHaveLength(0);
    await TestRenderer.act(() => tree.unmount());
  });

  test("SA-8 a single OK with a handler runs it when the toast is dismissed", async () => {
    const onOk = jest.fn<() => void>();
    showAlert("Signed out", undefined, [{ text: "OK", onPress: onOk }]);
    await flush();
    expect(useWebAlertStore.getState().queue).toHaveLength(0);
    const [toast] = useToastStore.getState().toasts;
    expect(onOk).not.toHaveBeenCalled();
    toast.onDismiss();
    await flush();
    expect(onOk).toHaveBeenCalledTimes(1);
  });
});
