/**
 * showAlertWeb — #4420. The web half of `showAlert`, loaded on the first web
 * alert so none of it rides the boot bundle (the eager stub is showAlert.ts).
 *
 *   No buttons, or one button with no handler: a Toast through the existing
 *   toast store (kind defaults to "error"; `{ kind }` picks a success or a
 *   hint). A single button WITH a handler runs it when the toast is dismissed.
 *   Any choice (two or three buttons): the app's ConfirmDialog, drawn by
 *   `WebAlertLayer` (below) under the root `AlertDialogHost`. The layer
 *   lives in THIS module so the toast path and the dialog path share one
 *   on-intent chunk (two chunks importing it would pull it into __common). A destructive button
 *   stays destructive, the cancel button stays the way out, and Cancel /
 *   Discard / Save maps to the dialog's "leave" variant.
 */

import React, { useCallback } from "react";
import { create } from "zustand";

import { ConfirmDialog } from "./ConfirmDialog";

import { requestAlertHost } from "./alertHost";
import type { ShowAlertButton, ShowAlertOptions } from "./alertHost";

import { nextToastEntryId, useToastStore } from "./toastStore";
import type { ToastKind } from "./toastTimings";

type Handler = () => void;

/** What one web alert becomes. Pure; see `planWebAlert`. */
export type WebAlertPlan =
  | { kind: "toast"; toastKind: ToastKind; message: string; onDismiss?: Handler }
  | {
      kind: "dialog";
      variant: "simple";
      title: string;
      description: string;
      cancelLabel: string;
      confirmLabel: string;
      destructive: boolean;
      onCancel?: Handler;
      onConfirm?: Handler;
    }
  | {
      kind: "dialog";
      variant: "leave";
      title: string;
      description: string;
      keepLabel: string;
      discardLabel: string;
      saveLabel: string;
      onKeep?: Handler;
      onDiscard?: Handler;
      onSave?: Handler;
    };

export type WebAlertDialog = Extract<WebAlertPlan, { kind: "dialog" }> & { id: number };

const runner = (button: ShowAlertButton | undefined): Handler | undefined => {
  const onPress = button?.onPress;
  if (onPress === undefined) return undefined;
  return () => {
    void Promise.resolve()
      .then(() => onPress())
      .catch((error: unknown) => {
        console.error("[showAlert] button handler threw:", error);
      });
  };
};

/** "Couldn't save" + "Network down" -> "Couldn't save. Network down". */
export const alertToastMessage = (title: string, message?: string): string => {
  const head = title.trim();
  const body = (message ?? "").trim();
  if (body.length === 0) return head;
  if (head.length === 0) return body;
  return /[.!?…:]$/.test(head) ? `${head} ${body}` : `${head}. ${body}`;
};

/** Map an `Alert.alert` call to what web shows. */
export const planWebAlert = (
  title: string,
  message?: string,
  buttons?: readonly ShowAlertButton[],
  options?: ShowAlertOptions,
): WebAlertPlan => {
  const list = buttons ?? [];
  const toastKind = options?.kind ?? "error";
  if (list.length === 0) {
    return { kind: "toast", toastKind, message: alertToastMessage(title, message) };
  }
  if (list.length === 1) {
    return { kind: "toast", toastKind, message: alertToastMessage(title, message), onDismiss: runner(list[0]) };
  }
  const description = message ?? "";
  const cancelIndex = list.findIndex((b) => b.style === "cancel");
  // No explicit cancel: the first button is the way out (iOS draws it first).
  const cancel = list[cancelIndex === -1 ? 0 : cancelIndex];
  const others = list.filter((b) => b !== cancel);

  if (others.length === 2) {
    const discard = others.find((b) => b.style === "destructive");
    const save = others.find((b) => b !== discard);
    if (discard !== undefined && save !== undefined) {
      return {
        kind: "dialog",
        variant: "leave",
        title,
        description,
        keepLabel: cancel.text ?? "Cancel",
        discardLabel: discard.text ?? "Discard",
        saveLabel: save.text ?? "Save",
        onKeep: runner(cancel),
        onDiscard: runner(discard),
        onSave: runner(save),
      };
    }
  }
  if (others.length > 1) {
    console.warn(`[showAlert] web shows ${others.length} choices as one; kept the last: ${title}`);
  }
  const confirm = others[others.length - 1];
  return {
    kind: "dialog",
    variant: "simple",
    title,
    description,
    cancelLabel: cancel.text ?? "Cancel",
    confirmLabel: confirm.text ?? "OK",
    destructive: confirm.style === "destructive",
    onCancel: runner(cancel),
    onConfirm: runner(confirm),
  };
};

interface WebAlertStoreState {
  queue: WebAlertDialog[];
  push: (dialog: WebAlertDialog) => void;
  /** Close the front dialog. */
  shift: () => void;
}

export const useWebAlertStore = create<WebAlertStoreState>((set) => ({
  queue: [],
  push: (dialog) => set((state) => ({ queue: [...state.queue, dialog] })),
  shift: () => set((state) => (state.queue.length === 0 ? state : { queue: state.queue.slice(1) })),
}));

let nextDialogId = 1;

/** Test seam. */
export const resetWebAlertStoreForTest = (): void => {
  useWebAlertStore.setState({ queue: [] });
  nextDialogId = 1;
};

/** Show one alert on web. Called by the `showAlert` stub after this module loads. */
export function showWebAlert(
  title: string,
  message?: string,
  buttons?: readonly ShowAlertButton[],
  options?: ShowAlertOptions,
): void {
  const plan = planWebAlert(title, message, buttons, options);
  if (plan.kind === "toast") {
    const store = useToastStore.getState();
    const id = nextToastEntryId();
    const after = plan.onDismiss;
    store.upsert({
      id,
      kind: plan.toastKind,
      message: plan.message,
      testID: "show-alert-toast",
      onDismiss: () => {
        useToastStore.getState().remove(id);
        after?.();
      },
    });
    return;
  }
  const id = nextDialogId;
  nextDialogId += 1;
  useWebAlertStore.getState().push({ ...plan, id });
  requestAlertHost();
}

// ---- The dialog layer (mounted on intent by AlertDialogHost) ----
// The dialog closes BEFORE the chosen button's handler runs, as a native
// alert does; a second alert waits for the first.
const noop = (): void => undefined;

export const WebAlertLayer: React.FC = () => {
  const dialog = useWebAlertStore((s) => s.queue[0] ?? null);
  const shift = useWebAlertStore((s) => s.shift);

  const choose = useCallback(
    (handler: (() => void) | undefined) => (): void => {
      shift();
      handler?.();
    },
    [shift],
  );

  if (dialog === null) return null;
  return <AlertDialogBody key={dialog.id} dialog={dialog} choose={choose} />;
};

const AlertDialogBody: React.FC<{
  dialog: WebAlertDialog;
  choose: (handler: (() => void) | undefined) => () => void;
}> = ({ dialog, choose }) => {
  if (dialog.variant === "leave") {
    return (
      <ConfirmDialog
        visible
        variant="leave"
        title={dialog.title}
        description={dialog.description}
        onClose={choose(dialog.onKeep)}
        onConfirm={choose(dialog.onDiscard)}
        onDiscard={choose(dialog.onDiscard)}
        onSave={choose(dialog.onSave)}
        keepLabel={dialog.keepLabel}
        discardLabel={dialog.discardLabel}
        saveLabel={dialog.saveLabel}
        testID="show-alert-dialog"
        keepTestID="show-alert-keep"
        discardTestID="show-alert-discard"
        saveTestID="show-alert-save"
      />
    );
  }
  return (
    <ConfirmDialog
      visible
      variant="simple"
      title={dialog.title}
      description={dialog.description}
      cancelLabel={dialog.cancelLabel}
      confirmLabel={dialog.confirmLabel}
      destructive={dialog.destructive}
      onClose={choose(dialog.onCancel)}
      onConfirm={choose(dialog.onConfirm ?? noop)}
      testID="show-alert-dialog"
      cancelTestID="show-alert-cancel"
      confirmTestID="show-alert-confirm"
    />
  );
};


export default WebAlertLayer;
