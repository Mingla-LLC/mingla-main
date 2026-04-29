// ORCH-0558: Collab swipe + match detection service.
//
// PREVIOUS shape (pre-ORCH-0558):
//   - saveCardToBoard: direct INSERT into board_saved_cards bypassing the trigger.
//     Removed. Replaced by the trigger-owned flow below.
//   - trackSwipeState + checkForMatch: two-query pattern. Column-misalignment
//     between checkForMatch's `.eq('experience_id')` and the trigger's
//     dual-column OR-filter produced silent match-misses (INVESTIGATION
//     ORCH-0558 RC-1). Both removed.
//
// CURRENT shape:
//   - recordSwipeAndCheckMatch: single atomic RPC call. Server-authoritative
//     match detection. No client-side board_saved_cards query. See
//     SPEC_ORCH-0558_BULLETPROOF_COLLAB_MATCH §4.3.
//
// DO NOT re-introduce a direct-save path or a client-side match poll.
// The trigger is the only writer; the RPC is the only reader for match state.
// Re-doing that introduces the ORCH-0558 bug class.

import { supabase } from "./supabase";
import { realtimeService } from "./realtimeService";

export interface SwipeAndMatchResult {
  /** True when the trigger promoted (or had previously promoted) this experience. */
  matched: boolean;
  /** Present on match; the board_saved_cards row id. */
  savedCardId?: string;
  /** Card title pulled from saved_card.card_data.title. */
  cardTitle?: string;
  /** User ids of everyone who right-swiped this experience in this session. */
  matchedUserIds?: string[];
  /** Server-reported reason — 'promoted' | 'quorum_not_met' | 'left_swipe' | etc. */
  reason?: string;
  /** Network / auth / validation error, if any. */
  error?: Error;
}

export interface RecordSwipeAndCheckMatchParams {
  sessionId: string;
  experienceId: string;
  userId: string;
  cardData: Record<string, unknown>;
  swipeDirection: "left" | "right";
}

interface RpcRecordSwipeResponse {
  matched: boolean;
  saved_card_id?: string;
  card_title?: string;
  matched_user_ids?: string[];
  reason?: string;
}

export class BoardCardService {
  /**
   * ORCH-0558: Record a swipe and receive match status atomically.
   *
   * Calls the `rpc_record_swipe_and_check_match` SECURITY DEFINER RPC which:
   *   1. Validates auth + session participation
   *   2. Upserts board_user_swipe_states (fires check_mutual_like v3 trigger)
   *   3. Reads the trigger's outcome from board_saved_cards (server-side, same Tx)
   *   4. Returns a fully-shaped match result in one round-trip
   *
   * Replaces the legacy (trackSwipeState + checkForMatch) two-query pattern
   * that suffered from column-alignment bugs and cache-timing races.
   */
  static async recordSwipeAndCheckMatch(
    params: RecordSwipeAndCheckMatchParams,
  ): Promise<SwipeAndMatchResult> {
    const { sessionId, experienceId, userId, cardData, swipeDirection } = params;

    try {
      const { data, error } = await supabase.rpc(
        "rpc_record_swipe_and_check_match",
        {
          p_session_id: sessionId,
          p_experience_id: experienceId,
          p_user_id: userId,
          p_card_data: cardData,
          p_swipe_direction: swipeDirection,
        },
      );

      if (error) {
        console.error(
          "[BoardCardService] recordSwipeAndCheckMatch RPC error:",
          error,
        );
        const err = new Error(error.message || "RPC failed");
        return { matched: false, error: err, reason: "rpc_error" };
      }

      const result = (data ?? {}) as RpcRecordSwipeResponse;

      // Broadcast swipe to realtime channel so other participants see "partner
      // liked too" in near-real-time. Independent from match detection — even
      // if this fails, match state is still correct server-side.
      try {
        realtimeService.broadcastCardSwipe(sessionId, {
          experience_id: experienceId,
          user_id: userId,
          swipe_direction: swipeDirection,
          swiped_at: new Date().toISOString(),
        });
      } catch (broadcastErr) {
        console.warn(
          "[BoardCardService] recordSwipeAndCheckMatch: realtime broadcast failed (non-fatal):",
          broadcastErr,
        );
      }

      return {
        matched: !!result.matched,
        savedCardId: result.saved_card_id,
        cardTitle: result.card_title,
        matchedUserIds: result.matched_user_ids,
        reason: result.reason,
      };
    } catch (err: unknown) {
      console.error(
        "[BoardCardService] recordSwipeAndCheckMatch exception:",
        err,
      );
      const error = err instanceof Error ? err : new Error(String(err));
      return { matched: false, error, reason: "exception" };
    }
  }

  /**
   * Get swipe states for a card in a session (used by UI for "liked by X, Y")
   */
  static async getCardSwipeStates(
    sessionId: string,
    experienceId: string,
  ): Promise<{ data: Array<Record<string, unknown>>; error: unknown }> {
    try {
      const { data, error } = await supabase
        .from("board_user_swipe_states")
        .select(`
          *,
          profiles (
            id,
            username,
            display_name,
            first_name,
            last_name,
            avatar_url
          )
        `)
        .eq("session_id", sessionId)
        .eq("experience_id", experienceId);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (err: unknown) {
      console.error("Error getting swipe states:", err);
      return { data: [], error: err };
    }
  }

  /**
   * Get all saved cards for a session
   */
  static async getSessionSavedCards(
    sessionId: string,
  ): Promise<{ data: Array<Record<string, unknown>>; error: unknown }> {
    try {
      const { data, error } = await supabase
        .from("board_saved_cards")
        .select("*")
        .eq("session_id", sessionId)
        .order("saved_at", { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (err: unknown) {
      console.error("Error getting session saved cards:", err);
      return { data: [], error: err };
    }
  }

  /**
   * Remove a card from a board session
   */
  static async removeCardFromBoard(
    sessionId: string,
    savedCardId: string,
  ): Promise<{ error: unknown }> {
    try {
      const { error } = await supabase
        .from("board_saved_cards")
        .delete()
        .eq("session_id", sessionId)
        .eq("id", savedCardId);

      if (error) throw error;

      realtimeService.broadcastCardSave(sessionId, {
        id: savedCardId,
        session_id: sessionId,
        removed: true,
      });

      return { error: null };
    } catch (err: unknown) {
      console.error("Error removing card from board:", err);
      return { error: err };
    }
  }
}
