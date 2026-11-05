/**
 * The collab chat's shared hooks: the matched saved cards (header haptic and
 * realtime refresh), the sheet-to-card handoff and the one plan-card state.
 *
 * Issue #4261: the Matches and Plans sheets that lived here
 * (SavedToSessionCardsSheet, ScheduleSheet) were replaced in the chat by
 * PlanMatchesSheet and PlansSheet, which read the chat's plan list.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { realtimeService } from "../../services/realtimeService";
import { supabase } from "../../services/supabase";
import type { ExpansionTarget } from "../../types/expansion";
// ORCH-1054 [matches-expanded-card-parity]: canonical deck-parity mapper still
// used inside expansionTargetFromSavedPayload for places/curated.
import { expansionTargetFromSavedPayload } from "../../utils/expansionTargetFromSavedPayload";
import {
  initialSheetCardState,
  sheetCardReducer,
  SHEET_DISMISS_WATCHDOG_MS,
  type SheetCardEvent,
  type SheetCardState,
} from "./sheetCardHandoff";

export interface SavedSessionCard {
  id: string;
  saved_card_id?: string;
  session_id: string;
  saved_by: string;
  saved_at: string;
  experience_id?: string | null;
  saved_experience_id?: string | null;
  card_data?: any;
  experience_data?: any;
}

const SAVED_CARDS_PAGE_SIZE = 20;

export function useSessionSavedCardsForSheet(
  sessionId: string | null | undefined,
  options?: {
    /**
     * Issue #4114 Wave 3 (D9): told when a match lands, so the chat header can
     * open its strip and fire a light haptic. Rides the existing board-session
     * callback set; no new subscription or query.
     */
    onMatchPromoted?: () => void;
  },
): {
  savedCards: SavedSessionCard[];
  isLoading: boolean;
} {
  const queryClient = useQueryClient();
  const onMatchPromotedRef = useRef(options?.onMatchPromoted);
  onMatchPromotedRef.current = options?.onMatchPromoted;

  const query = useQuery<SavedSessionCard[]>({
    queryKey: ["savedCards", sessionId],
    enabled: !!sessionId,
    staleTime: 15_000,
    queryFn: async () => {
      if (!sessionId) return [];

      const { data, error } = await supabase
        .from("board_saved_cards")
        .select("*")
        .eq("session_id", sessionId)
        .eq("is_locked", false)
        .order("saved_at", { ascending: false })
        .range(0, SAVED_CARDS_PAGE_SIZE - 1);

      if (error) throw error;
      return (data ?? []) as SavedSessionCard[];
    },
  });

  const invalidateSavedCards = useCallback(() => {
    if (!sessionId) return;
    queryClient.invalidateQueries({ queryKey: ["savedCards", sessionId] });
  }, [queryClient, sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    let matchPromotedRefetchTimer: ReturnType<typeof setTimeout> | null = null;
    const callbacks = {
      onCardSaved: invalidateSavedCards,
      onCardLocked: invalidateSavedCards,
      onMatchPromoted: () => {
        onMatchPromotedRef.current?.();
        if (matchPromotedRefetchTimer) return;
        matchPromotedRefetchTimer = setTimeout(() => {
          matchPromotedRefetchTimer = null;
          invalidateSavedCards();
        }, 1000);
      },
    };

    realtimeService.subscribeToBoardSession(sessionId, callbacks);
    return () => {
      realtimeService.unregisterBoardCallbacks(sessionId, callbacks);
      if (matchPromotedRefetchTimer) clearTimeout(matchPromotedRefetchTimer);
    };
  }, [invalidateSavedCards, sessionId]);

  return {
    savedCards: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/** The two fields a plan's card opens from (a Plans row, or a plan row in the thread). */
export interface CollabPlanCardSource {
  savedCardId: string;
  cardData: Record<string, unknown> | null;
}

export interface SheetCard<T> {
  /** The card on screen; ExpandedCardModal is `visible={!!modalTarget}`. */
  modalTarget: T | null;
  /** Open with no sheet up (header strip, thread). */
  open: (target: T) => void;
  /** Open from a sheet row: the caller closes the sheet; the card shows once it has dismissed. */
  openFromSheet: (target: T) => void;
  /** Wire to the sheet's onNativeDismiss. */
  onSheetDismissed: () => void;
  /** The card closed. Clears every bit of card state so the next open presents. */
  close: () => void;
}

/**
 * Issue #4114 QA run 3: the sheet-to-card handoff (see `sheetCardHandoff.ts`).
 * iOS refuses a card presented over its still-open sheet, so a sheet row holds
 * the card until the sheet's native window dismisses; an open while a card is
 * still set clears it and re-presents next frame.
 */
export function useSheetCard<T>(): SheetCard<T> {
  const [state, dispatch] = useReducer(
    (current: SheetCardState<T>, event: SheetCardEvent<T>) => sheetCardReducer(current, event),
    undefined,
    () => initialSheetCardState<T>(),
  );

  useEffect(() => {
    if (state.waitFor === "frame") {
      const frame = requestAnimationFrame(() => dispatch({ type: "frame" }));
      return () => cancelAnimationFrame(frame);
    }
    if (state.waitFor === "sheetDismissed") {
      // If the native dismiss never arrives, show the card rather than leave a dead tap.
      const watchdog = setTimeout(() => dispatch({ type: "sheetDismissed" }), SHEET_DISMISS_WATCHDOG_MS);
      return () => clearTimeout(watchdog);
    }
    return undefined;
  }, [state.waitFor]);

  const open = useCallback((target: T) => dispatch({ type: "open", target }), []);
  const openFromSheet = useCallback((target: T) => dispatch({ type: "openFromSheet", target }), []);
  const onSheetDismissed = useCallback(() => dispatch({ type: "sheetDismissed" }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);
  return { modalTarget: state.shown, open, openFromSheet, onSheetDismissed, close };
}

export interface CollabPlanCard {
  modalTarget: ExpansionTarget | null;
  /** Header strip and thread: no sheet is up. */
  openPlan: (item: CollabPlanCardSource) => void;
  /** A Plans sheet row: the sheet closes, then the card shows. */
  openPlanFromSheet: (item: CollabPlanCardSource) => void;
  onSheetDismissed: () => void;
  closePlan: () => void;
}

function planTarget(item: CollabPlanCardSource): ExpansionTarget | null {
  return expansionTargetFromSavedPayload({
    ...item.cardData,
    sourceScope: 'collaboration',
    sourceRecordId: item.savedCardId,
    savedCardId: item.savedCardId,
  });
}

/**
 * Issue #4114: one plan-card state for the chat. The Plans sheet, the header
 * strip's plan cell and the plan rows in the thread all open a plan through
 * it, and the ONE ExpandedCardModal the Plans sheet renders shows it, so Book,
 * Share and the #1672 / #3281 dismiss rule are identical everywhere.
 */
export function useCollabPlanCard(): CollabPlanCard {
  const card = useSheetCard<ExpansionTarget>();
  const { open, openFromSheet } = card;
  const openPlan = useCallback((item: CollabPlanCardSource) => {
    const target = planTarget(item);
    if (target) open(target);
  }, [open]);
  const openPlanFromSheet = useCallback((item: CollabPlanCardSource) => {
    const target = planTarget(item);
    if (target) openFromSheet(target);
  }, [openFromSheet]);
  return {
    modalTarget: card.modalTarget,
    openPlan,
    openPlanFromSheet,
    onSheetDismissed: card.onSheetDismissed,
    closePlan: card.close,
  };
}
