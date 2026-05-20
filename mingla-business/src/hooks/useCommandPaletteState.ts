/**
 * useCommandPaletteState — ORCH-0891 M2 Zustand store for the ⌘K
 * command palette open/closed + query state.
 *
 * Per SPEC §3.4.2 + DESIGN_SPEC §5. Ephemeral UI state — open flag +
 * the current text the operator typed into the palette search input.
 * Both reset on close.
 *
 * # Why Zustand (not React Context)
 * The palette is opened by a global ⌘K keydown listener mounted in
 * `(tabs)/_layout.tsx` AND closed by an in-palette button + Esc. Plus
 * actions inside the palette (jump-to-route) need to close it. Three
 * disjoint mount points reading/writing the same state — exactly what
 * Zustand handles cleanly with zero plumbing.
 *
 * # Why this is allowed under feedback_zustand_persist_no_server_snapshots
 * The persist rule restricts Zustand from holding server-fetched data.
 * This store holds ONLY ephemeral UI state (open boolean + query string).
 * NOT persisted, NOT shared with React Query. Approved per ORCH-0891 §3.4.2.
 *
 * Per SPEC_ORCH-0891 §3.4.2.
 */

import { create } from "zustand";

export interface CommandPaletteState {
  /** True when the palette dialog is mounted + visible. */
  isOpen: boolean;
  /** Current search query typed into the palette input. */
  query: string;
  /** Open the palette. Resets query to empty for a clean slate. */
  open: () => void;
  /** Close the palette. Resets query to empty. */
  close: () => void;
  /** Toggle open/closed. Used by the global ⌘K keydown listener. */
  toggle: () => void;
  /** Update query as the operator types. */
  setQuery: (q: string) => void;
}

export const useCommandPalette = create<CommandPaletteState>((set) => ({
  isOpen: false,
  query: "",
  open: () => set({ isOpen: true, query: "" }),
  close: () => set({ isOpen: false, query: "" }),
  toggle: () =>
    set((state) => ({
      isOpen: !state.isOpen,
      query: state.isOpen ? state.query : "",
    })),
  setQuery: (query) => set({ query }),
}));
