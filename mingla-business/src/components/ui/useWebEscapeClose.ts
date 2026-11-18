/**
 * #4453 m11 rework (tester P3-4) — Escape closes an overlay built on React
 * Native's own `Modal` on web. React Native Web only hears Escape while focus
 * is inside the modal; after a tap on the button that opened it, focus stays
 * on the page behind, so Escape did nothing. This listens on the document
 * while the overlay is open and, like the shared Modal (#3645), only the
 * top-most open overlay acts on it. Native has no Escape key: a no-op there.
 */
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useEscapeLayer } from "./escapeLayerStack";

type KeyTarget = {
  addEventListener: (type: string, listener: (event: { key: string }) => void) => void;
  removeEventListener: (type: string, listener: (event: { key: string }) => void) => void;
};

export function useWebEscapeClose(visible: boolean, onClose: () => void): void {
  const isTop = useEscapeLayer(Platform.OS === "web" && visible);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (Platform.OS !== "web" || !visible) return undefined;
    const doc = (globalThis as unknown as { document?: KeyTarget }).document;
    if (doc === undefined) return undefined;
    const handler = (event: { key: string }): void => {
      if (event.key === "Escape" && isTop()) closeRef.current();
    };
    doc.addEventListener("keydown", handler);
    return (): void => doc.removeEventListener("keydown", handler);
  }, [isTop, visible]);
}
