/**
 * #4514 — one small toast owner for the Forms screens, so every failure is
 * shown to the host (never swallowed) and every success is confirmed.
 */

import React, { useCallback, useState } from "react";

import { Toast, type ToastKind } from "../ui/Toast";

export interface FormsToast {
  show: (kind: ToastKind, message: string) => void;
  toast: React.ReactElement;
}

export function useFormsToast(): FormsToast {
  const [state, setState] = useState<{ visible: boolean; kind: ToastKind; message: string }>({
    visible: false,
    kind: "info",
    message: "",
  });
  const show = useCallback((kind: ToastKind, message: string): void => {
    setState({ visible: true, kind, message });
  }, []);
  const toast = (
    <Toast
      visible={state.visible}
      kind={state.kind}
      message={state.message}
      onDismiss={() => setState((prev) => ({ ...prev, visible: false }))}
    />
  );
  return { show, toast };
}

/** The sentence to show for a thrown value. Services throw BrandFormsError. */
export function errorSentence(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0 && error.name === "BrandFormsError") {
    return error.message;
  }
  return fallback;
}
