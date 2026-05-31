import { create } from "zustand";

/**
 * ORCH-1016 — global, ref-counted "hide the floating GlassBottomNav" flag.
 *
 * WHY: full detail/checkout bottom sheets (trip detail, the ticket/reserve sheet,
 * the cart, place/event detail) extend to the screen bottom, and the app-level
 * floating GlassBottomNav is a HIGHER-Z sibling that paints OVER the sheet's
 * bottom strip — so the Buy/Reserve CTA sits behind the nav no matter how the
 * sheet scrolls. The robust fix is to bring the sheet "forward" by HIDING the nav
 * while such a sheet is open (a bottom-sheet detail view legitimately covers the
 * tab bar), instead of fragile scroll-padding that tries to push content out from
 * under the nav. (Codex's earlier RN-Modal carrier attempt at this broke Android
 * gestures + didn't fix scroll — so we hide via state, not a Modal.)
 *
 * Ref-counted so overlapping sheets (e.g. trip detail + its reserve sheet + cart)
 * each hold the nav hidden until the LAST one closes.
 */
interface BottomNavState {
  hideCount: number;
  pushHide: () => void;
  popHide: () => void;
}

export const useBottomNavStore = create<BottomNavState>((set) => ({
  hideCount: 0,
  pushHide: () => set((s) => ({ hideCount: s.hideCount + 1 })),
  popHide: () => set((s) => ({ hideCount: Math.max(0, s.hideCount - 1) })),
}));

/** Subscribe to whether the floating bottom nav should be hidden. */
export const useBottomNavHidden = (): boolean =>
  useBottomNavStore((s) => s.hideCount > 0);

/** Imperative helpers (safe to call from effects without subscribing). */
export const pushHideBottomNav = (): void =>
  useBottomNavStore.getState().pushHide();
export const popHideBottomNav = (): void =>
  useBottomNavStore.getState().popHide();
