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
import { useDraftVenueStore } from "../store/draftVenueStore";
import { useEventEditLogStore } from "../store/eventEditLogStore";
import { useGuestStore } from "../store/guestStore";
import { useLiveEventStore } from "../store/liveEventStore";
import { useOrderStore } from "../store/orderStore";
import { useScanStore } from "../store/scanStore";
import { useScannerInvitationsStore } from "../store/scannerInvitationsStore";
import { useDoorSalesStore } from "../store/doorSalesStore";
import { useBrandTeamStore } from "../store/brandTeamStore";
import { useNotificationPrefsStore } from "../store/notificationPrefsStore";
import { useLiveSectionCollapseStore } from "../store/liveSectionCollapseStore";
import { useTodoToggleCollapseStore } from "../store/todoToggleCollapseStore";
import { useAriConversationSelectionStore } from "../store/ariConversationSelectionStore";
import { useBusinessRecentStore } from "../store/businessRecentStore";

export const clearAllStores = (): void => {
  useCurrentBrandStore.getState().reset();
  useDraftEventStore.getState().reset();
  useDraftVenueStore.getState().reset(); // NEW META-ORCH-1009 Sub-E — Constitution #6 (persisted venue draft)
  useLiveEventStore.getState().reset(); // NEW Cycle 6 — Constitution #6
  useEventEditLogStore.getState().reset(); // NEW ORCH-0704 v2 — Constitution #6
  useOrderStore.getState().reset(); // NEW Cycle 9c — Constitution #6
  useGuestStore.getState().reset(); // NEW Cycle 10 — Constitution #6
  useScanStore.getState().reset(); // NEW Cycle 11 — Constitution #6
  useScannerInvitationsStore.getState().reset(); // NEW Cycle 11 — Constitution #6
  useDoorSalesStore.getState().reset(); // NEW Cycle 12 — Constitution #6
  useBrandTeamStore.getState().reset(); // NEW Cycle 13a — Constitution #6
  useNotificationPrefsStore.getState().reset(); // NEW Cycle 14 — Constitution #6
  useLiveSectionCollapseStore.getState().reset(); // NEW ORCH-1143 — Constitution #6 (live-section accordion collapse)
  useTodoToggleCollapseStore.getState().reset(); // NEW #882 — Constitution #6 (todo-toggle position)
  useAriConversationSelectionStore.getState().reset(); // #1985 — account+brand Ari pointer must not survive sign-out
  useBusinessRecentStore.getState().reset(); // #2794 — account+brand Recent pointer queue must not survive sign-out
};
