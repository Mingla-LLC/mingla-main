/**
 * clearAllStores — central reset utility for client-side persisted state.
 *
 * Call from auth signout chain to satisfy Constitution #6 (logout clears
 * everything). NEW in Cycle 3 — established because draftEventStore was
 * added without an existing centralized signout cleanup utility (the
 * previous AuthContext.signOut() only cleared Supabase + Google sessions
 * and left both currentBrandStore + draftEventStore intact, a pre-existing
 * Constitution #6 gap that Cycle 3 closes).
 *
 * As new persisted Zustand stores land in future cycles, add their
 * `.getState().reset()` calls here. Keep this file as the single
 * choke-point for client-state cleanup.
 *
 * Per Cycle 3 spec §3.11.
 */

import { useCurrentBrandStore } from "../store/currentBrandStore";
import { useDraftEventStore } from "../store/draftEventStore";
import { useLiveEventStore } from "../store/liveEventStore";

export const clearAllStores = (): void => {
  useCurrentBrandStore.getState().reset();
  useDraftEventStore.getState().reset();
  useLiveEventStore.getState().reset(); // NEW Cycle 6 — Constitution #6
};
