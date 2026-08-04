/**
 * The public venue page's tab + reservation-sheet state machine.
 *
 * #1559 [shared-venue-screen] — MOVED here from
 * `mingla-business/src/components/venue/publicVenueReservationUiState.ts`
 * unchanged (that path is now a thin re-export). The reducer is pure and has
 * always been platform-free; it moved because the screen that drives it now
 * lives in this package and a package may not import app `src/`
 * (I-MOR-0827-PACKAGE-ISOLATION).
 *
 * Original contract, untouched: #1380/#1383 — the Reserve CTA opens the sheet
 * AND selects the Reservations tab in one transition; closing the sheet leaves
 * the tab selected; a hidden Menu tab can never stay active.
 */
import type { PublicVenueTab } from "./publicVenueTabState";

export interface PublicVenueReservationUiState {
  activeTab: PublicVenueTab;
  reservationSheetOpen: boolean;
}

export interface PublicVenueReservationUiContext {
  hasMenu: boolean;
  canOpenReservationSheet: boolean;
}

export type PublicVenueReservationUiAction =
  | {
      type: "RESERVE_CTA_PRESSED";
      context: PublicVenueReservationUiContext;
    }
  | {
      type: "RESERVATION_SHEET_CLOSED";
      context: PublicVenueReservationUiContext;
    }
  | {
      type: "TAB_SELECTED";
      tab: PublicVenueTab;
      context: PublicVenueReservationUiContext;
    }
  | {
      type: "INITIAL_TAB_CHANGED";
      tab: PublicVenueTab;
      context: PublicVenueReservationUiContext;
    }
  | {
      type: "ENVIRONMENT_CHANGED";
      context: PublicVenueReservationUiContext;
    };

export function safePublicVenueTab(
  tab: PublicVenueTab,
  hasMenu: boolean,
): PublicVenueTab {
  return tab === "menu" && !hasMenu ? "overview" : tab;
}

export function normalizePublicVenueReservationUiState(
  state: PublicVenueReservationUiState,
  context: PublicVenueReservationUiContext,
): PublicVenueReservationUiState {
  const activeTab = safePublicVenueTab(state.activeTab, context.hasMenu);
  return {
    activeTab,
    reservationSheetOpen:
      state.reservationSheetOpen &&
      activeTab === "reservations" &&
      context.canOpenReservationSheet,
  };
}

export function createPublicVenueReservationUiState(
  initialTab: PublicVenueTab,
  context: PublicVenueReservationUiContext,
): PublicVenueReservationUiState {
  return normalizePublicVenueReservationUiState(
    {
      activeTab: safePublicVenueTab(initialTab, context.hasMenu),
      reservationSheetOpen: false,
    },
    context,
  );
}

export function publicVenueReservationUiReducer(
  state: PublicVenueReservationUiState,
  action: PublicVenueReservationUiAction,
): PublicVenueReservationUiState {
  switch (action.type) {
    case "RESERVE_CTA_PRESSED":
      return normalizePublicVenueReservationUiState(
        action.context.canOpenReservationSheet
          ? { activeTab: "reservations", reservationSheetOpen: true }
          : state,
        action.context,
      );
    case "RESERVATION_SHEET_CLOSED":
      return normalizePublicVenueReservationUiState(
        { activeTab: "reservations", reservationSheetOpen: false },
        action.context,
      );
    case "TAB_SELECTED":
    case "INITIAL_TAB_CHANGED":
      return normalizePublicVenueReservationUiState(
        {
          activeTab: safePublicVenueTab(action.tab, action.context.hasMenu),
          reservationSheetOpen: false,
        },
        action.context,
      );
    case "ENVIRONMENT_CHANGED":
      return normalizePublicVenueReservationUiState(state, action.context);
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
