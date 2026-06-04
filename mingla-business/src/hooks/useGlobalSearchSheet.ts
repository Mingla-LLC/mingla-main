/**
 * useGlobalSearchSheet — Zustand store for the global search sheet's
 * open/close + query + ephemeral recents.
 *
 * META-ORCH-1073 Sub-A. SPEC §3.4.1 (LOCKED state shape). This is the bridge
 * that lets the TopBar search icon (rendered inside many sub-trees) open the
 * single sheet mounted at the (tabs) root.
 *
 * # Why Zustand (mirrors useCommandPaletteState precedent)
 * The sheet is opened by the TopBar icon (mounted in many screens) and closed
 * by an in-sheet control / Esc / scrim / back; rows inside the sheet also need
 * to close it. Disjoint mount points reading/writing the same state — exactly
 * what Zustand handles cleanly.
 *
 * # Allowed under feedback_zustand_persist_no_server_snapshots
 * Holds ONLY ephemeral UI state (open boolean + query string + in-memory
 * recents). NOT persisted, NOT shared with React Query. `recents` reset on app
 * restart (R-4 — ephemeral; persistence deferred to a later sub-ORCH).
 *
 * COEXIST (R-5): this is a NEW store; useCommandPaletteState + the web-desktop
 * ⌘K marketing palette are UNTOUCHED.
 */

import { create } from "zustand";

import { pushRecent as pushRecentPure } from "../lib/search/sheetState";

const RECENTS_CAP = 6;

export interface GlobalSearchSheetState {
  /** True when the sheet is mounted + visible. */
  isOpen: boolean;
  /** Current search query typed into the sheet input. */
  query: string;
  /** Last N submitted queries, MRU-ordered, ephemeral (resets on restart). */
  recents: string[];
  /** Open the sheet. Resets query for a clean slate (recents preserved). */
  open: () => void;
  /** Close the sheet. Resets query (recents preserved). */
  close: () => void;
  /** Toggle open/closed — used by the web ⌘-K accelerator (if wired). */
  toggle: () => void;
  /** Update query as the operator types. */
  setQuery: (q: string) => void;
  /** Record a submitted query: dedupe + MRU + cap at 6. */
  pushRecent: (q: string) => void;
}

export const useGlobalSearchSheet = create<GlobalSearchSheetState>((set) => ({
  isOpen: false,
  query: "",
  recents: [],
  open: () => set({ isOpen: true, query: "" }),
  close: () => set({ isOpen: false, query: "" }),
  toggle: () =>
    set((state) => ({
      isOpen: !state.isOpen,
      query: state.isOpen ? state.query : "",
    })),
  setQuery: (query) => set({ query }),
  pushRecent: (q) =>
    set((state) => ({ recents: pushRecentPure(state.recents, q, RECENTS_CAP) })),
}));
