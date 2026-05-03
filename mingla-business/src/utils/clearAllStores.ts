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
import { useEventEditLogStore } from "../store/eventEditLogStore";
import { useGuestStore } from "../store/guestStore";
import { useLiveEventStore } from "../store/liveEventStore";
import { useOrderStore } from "../store/orderStore";

export const clearAllStores = (): void => {
  useCurrentBrandStore.getState().reset();
  useDraftEventStore.getState().reset();
  useLiveEventStore.getState().reset(); // NEW Cycle 6 — Constitution #6
  useEventEditLogStore.getState().reset(); // NEW ORCH-0704 v2 — Constitution #6
  useOrderStore.getState().reset(); // NEW Cycle 9c — Constitution #6
  useGuestStore.getState().reset(); // NEW Cycle 10 — Constitution #6
};
