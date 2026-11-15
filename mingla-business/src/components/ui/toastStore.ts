/**
 * toastStore — #4420 (spec §3.3, B4). The non-modal toast registry.
 *
 * WHY. Before #4420 every `<Toast>` rendered its own native `<Modal>`. On iOS a
 * Modal window captures every touch until it dismisses, so a 2.6s success
 * toast froze the screen under it ("the screen freezes" bug). Now `<Toast>`
 * keeps its exact props (75 call sites unchanged), registers them here, and
 * renders nothing; a `ToastHost` layer draws it with `pointerEvents="box-none"`.
 *
 * LAYERING. iOS draws native Modal windows ABOVE the root window, so a
 * root-only host would put a toast UNDER an open sheet. A host is mounted at
 * the root AND inside the window of SheetMobile, Modal and ConfirmDialog. Each
 * host registers a layer with an order from `reserveToastLayerOrder` — the
 * same "taken at first open render, opened later = on top" rule as
 * `escapeLayerStack` — and the root host is order 0. A toast shows ONLY in the
 * top-most registered host. The layers live here, NOT in the Escape set, so a
 * toast host never changes which overlay Escape closes (#3645).
 *
 * Web: the root host is `position: fixed` at the top z-index, above
 * react-native-web's Modal portals, so the web-only desktop sheet
 * (`Sheet.web.tsx`) needs no host of its own.
 *
 * No auth, no data, no persistence: safe on anon buyer routes.
 */

import { create } from "zustand";

import type { ToastKind } from "./toastTimings";

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
  testID?: string;
  autoDismissMs?: number | null;
  action?: ToastAction;
  onPresented?: () => void;
  /** Web recovery mode (kept from the modal era): announce as an alert. */
  announce?: boolean;
}

interface ToastStoreState {
  toasts: ToastEntry[];
  /** Registered host layers, by order (root = 0). */
  hosts: number[];
  upsert: (entry: ToastEntry) => void;
  remove: (id: number) => void;
  registerHost: (order: number) => void;
  unregisterHost: (order: number) => void;
}

export const useToastStore = create<ToastStoreState>((set) => ({
  toasts: [],
  hosts: [],
  upsert: (entry) =>
    set((state) => {
      const index = state.toasts.findIndex((t) => t.id === entry.id);
      if (index === -1) return { toasts: [...state.toasts, entry] };
      const next = state.toasts.slice();
      next[index] = entry;
      return { toasts: next };
    }),
  remove: (id) =>
    set((state) =>
      state.toasts.some((t) => t.id === id) ? { toasts: state.toasts.filter((t) => t.id !== id) } : state,
    ),
  registerHost: (order) =>
    set((state) => (state.hosts.includes(order) ? state : { hosts: [...state.hosts, order] })),
  unregisterHost: (order) =>
    set((state) => (state.hosts.includes(order) ? { hosts: state.hosts.filter((h) => h !== order) } : state)),
}));

let nextLayerOrder = 1;
/** Reserve the next toast layer position above every layer opened so far. */
export const reserveToastLayerOrder = (): number => {
  const order = nextLayerOrder;
  nextLayerOrder += 1;
  return order;
};

let nextToastId = 1;
export const nextToastEntryId = (): number => {
  const id = nextToastId;
  nextToastId += 1;
  return id;
};

/** The order of the host that draws toasts, or null when no host is mounted. */
export const topHostOrder = (hosts: readonly number[]): number | null =>
  hosts.length === 0 ? null : Math.max(...hosts);

/** Phone shows the newest toast only; desktop stacks up to this many. */
export const MAX_DESKTOP_TOASTS = 3;

/** The toasts one host draws: newest last, capped. */
export const visibleToasts = (toasts: readonly ToastEntry[], stacked: boolean): ToastEntry[] =>
  stacked ? toasts.slice(-MAX_DESKTOP_TOASTS) : toasts.slice(-1);

/** Test seam. */
export const resetToastStoreForTest = (): void => {
  useToastStore.setState({ toasts: [], hosts: [] });
  nextToastId = 1;
  nextLayerOrder = 1;
};
