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

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import * as ToastModule from "./Toast";
import { reserveToastLayerOrder, topHostOrder, useToastStore, visibleToasts } from "./toastStore";

export interface ToastHostProps {
  /** `root` = the app-root layer (order 0); `overlay` = inside a Modal window. */
  layer?: "root" | "overlay";
  /** Overlay hosts register only while their overlay is open. Default true. */
  open?: boolean;
  testID?: string;
}

export const ROOT_TOAST_LAYER_ORDER = 0;

/** Phone placement: the toast's distance from the top edge. */
export const useToastTopOffset = (): number => {
  const insets = useSafeAreaInsets();
  return (insets.top > 0 ? insets.top : space[4]) + space[2];
};

/** True when toasts stack bottom-right (web desktop, via the one desktop gate). */
export const useToastStacked = (): boolean => useResponsiveLayout().isWideDesktop;

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

  // Read at render, not destructured at import: a suite that replaces
  // `./Toast` with a stub (no store writes, so no toasts) must still be able
  // to mount every Sheet / Modal / ConfirmDialog that carries a host.
  const ToastItem = ToastModule.ToastItem;
  if (!isTop || toasts.length === 0 || typeof ToastItem !== "function") return null;
  const shown = visibleToasts(toasts, stacked);

  return (
    <GestureHandlerRootView
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, Platform.OS === "web" ? webFixed : null]}
      testID={testID ?? `toast-host-${layer}`}
    >
      <View
        pointerEvents="box-none"
        style={stacked ? styles.stack : [styles.top, { top: topOffset }]}
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

const styles = StyleSheet.create({
  top: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: space[4],
    alignItems: "center",
  },
  // #4490 N2/N13: the desktop stack sits top-centre. Bottom-right put every
  // success toast on top of the primary button (wizard Continue, sheet footer
  // Add / Save) for its whole four seconds. Top-centre covers no action: page
  // headers keep their buttons at the edges, and sheets open from the right.
  // I-PRIVACY-BAR-NEVER-OCCLUDES (#4420 merge): a top-pinned stack never reaches the
  // privacy strip at the bottom of the app root.
  stack: {
    position: "absolute",
    top: space[6],
    left: 0,
    right: 0,
    gap: space[2],
    alignItems: "center",
  },
});

export default ToastHost;
