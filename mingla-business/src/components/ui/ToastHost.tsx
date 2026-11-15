/**
 * ToastHost — #4420 (spec §3.3, B4). The layer that draws non-modal toasts.
 *
 * An absolutely positioned `pointerEvents="box-none"` layer: no scrim, no
 * focus capture, no `useAuth` (it is mounted outside AuthProvider and on anon
 * buyer routes). Mount it:
 *   - once at the app root (`app/_layout.tsx`, `layer="root"`, order 0), and
 *   - inside the window of SheetMobile, Modal and ConfirmDialog (`layer="overlay"`,
 *     with `open` = that overlay's visibility).
 * Only the top-most registered host draws toasts (see `toastStore.ts`), so a
 * toast fired while a sheet is open appears ABOVE the sheet, not under it.
 */

import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { ViewStyle } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { space } from "../../constants/designSystem";

import { ToastItem, useToastStacked, useToastTopOffset } from "./Toast";
import { reserveToastLayerOrder, topHostOrder, useToastStore, visibleToasts } from "./toastStore";

export interface ToastHostProps {
  /** `root` = the app-root layer (order 0); `overlay` = inside a Modal window. */
  layer?: "root" | "overlay";
  /** Overlay hosts register only while their overlay is open. Default true. */
  open?: boolean;
  testID?: string;
}

export const ROOT_TOAST_LAYER_ORDER = 0;

/**
 * Register a toast host layer while `open`. The order is reserved during
 * render (parent-first), like `useEscapeLayer`, so an overlay opened later
 * always sits above one opened earlier. Returns this host's order.
 */
export const useToastHostLayer = (layer: "root" | "overlay", open: boolean): number | null => {
  const orderRef = useRef<number | null>(null);
  if (layer === "root") orderRef.current = ROOT_TOAST_LAYER_ORDER;
  else if (open && orderRef.current === null) orderRef.current = reserveToastLayerOrder();
  const registerHost = useToastStore((s) => s.registerHost);
  const unregisterHost = useToastStore((s) => s.unregisterHost);

  useEffect(() => {
    if (!open) return undefined;
    const order = orderRef.current;
    if (order === null) return undefined;
    registerHost(order);
    return (): void => {
      unregisterHost(order);
      if (layer !== "root" && orderRef.current === order) orderRef.current = null;
    };
  }, [layer, open, registerHost, unregisterHost]);

  return open ? orderRef.current : null;
};

// GestureHandlerRootView is REQUIRED here on Android: the app-root root (expo-
// router) does NOT extend into a Modal's separate window, so without this inner
// root the swipe-up dismiss would no-op (or freeze) inside sheets and dialogs.
export const ToastHost: React.FC<ToastHostProps> = ({ layer = "overlay", open = true, testID }) => {
  const order = useToastHostLayer(layer, open);
  const isTop = useToastStore((s) => order !== null && topHostOrder(s.hosts) === order);
  const toasts = useToastStore((s) => s.toasts);
  const stacked = useToastStacked();
  const topOffset = useToastTopOffset();

  if (!isTop || toasts.length === 0) return null;
  const shown = visibleToasts(toasts, stacked);

  return (
    <GestureHandlerRootView
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, Platform.OS === "web" ? webFixed : null]}
      testID={testID ?? `toast-host-${layer}`}
    >
      <View
        pointerEvents="box-none"
        style={stacked ? [styles.stack, Platform.OS === "web" ? webStackBottom : null] : [styles.top, { top: topOffset }]}
      >
        {shown.map((entry) => (
          <ToastItem key={entry.id} entry={entry} placement={stacked ? "stack" : "top"} />
        ))}
      </View>
    </GestureHandlerRootView>
  );
};

const webFixed = {
  position: "fixed",
  zIndex: 2147483647,
} as unknown as ViewStyle;

// I-PRIVACY-BAR-NEVER-OCCLUDES: a bottom-pinned layer sits above the privacy bar.
const webStackBottom = {
  bottom: `calc(var(--mingla-privacy-inset, 0px) + ${space[6]}px)`,
} as unknown as ViewStyle;

const styles = StyleSheet.create({
  top: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: space[4],
    alignItems: "center",
  },
  stack: {
    position: "absolute",
    right: space[6],
    bottom: space[6],
    gap: space[2],
    alignItems: "flex-end",
  },
});

export default ToastHost;
