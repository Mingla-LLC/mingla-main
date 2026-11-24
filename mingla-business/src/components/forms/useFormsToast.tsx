/**
 * #4514 — one small toast owner for the Forms screens, so every failure is
 * shown to the host (never swallowed) and every success is confirmed.
 */

import React, { useCallback, useState } from "react";

import { Toast, type ToastAction, type ToastKind } from "../ui/Toast";

/** #4541 R4.8: an optional action ("Undo") and how long the toast stays. */
export interface FormsToastOptions {
  action?: ToastAction;
  autoDismissMs?: number | null;
}

export interface FormsToast {
  show: (kind: ToastKind, message: string, options?: FormsToastOptions) => void;
  toast: React.ReactElement;
}

export function useFormsToast(): FormsToast {
  const [state, setState] = useState<{ visible: boolean; kind: ToastKind; message: string; options: FormsToastOptions }>({
    visible: false,
    kind: "info",
    message: "",
    options: {},
  });
  const show = useCallback((kind: ToastKind, message: string, options: FormsToastOptions = {}): void => {
    setState({ visible: true, kind, message, options });
  }, []);
  const toast = (
    <Toast
      visible={state.visible}
      kind={state.kind}
      message={state.message}
      action={state.options.action}
      {...(state.options.autoDismissMs !== undefined ? { autoDismissMs: state.options.autoDismissMs } : {})}
      onDismiss={() => setState((prev) => ({ ...prev, visible: false }))}
    />
  );
  return { show, toast };
}

/** The sentence to show for a thrown value. Services throw BrandFormsError. */
export function errorSentence(error: unknown, fallback: string): string {
  if (
    error instanceof Error &&
    error.message.length > 0 &&
    (error.name === "BrandFormsError" || error.name === "FormRequestError")
  ) {
    return error.message;
  }
  return fallback;
}
