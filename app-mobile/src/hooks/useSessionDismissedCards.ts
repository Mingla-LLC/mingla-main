import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { realtimeService } from '../services/realtimeService';

/**
 * ORCH-0902 CR-6 (visible-but-not-binding dismissal): server-side source of
 * truth for the DismissedCardsSheet in collab mode. Returns ALL left-swipes
 * for the session by ALL participants, attributed by display name, in swipe
 * order (newest first).
 *
 * Data source: `board_user_swipe_states` table with `swipe_state='swiped_left'`,
 * joined to `profiles` for display_name/avatar attribution. Backed by the
 * partial index `idx_board_user_swipe_states_session_left` so the query is
 * O(log n) regardless of right-swipe volume in the session.
 *
 * Realtime: piggybacks on the existing `board_session:{sessionId}` channel
 * subscription via the new `onSwipeRecorded` callback (added in
 * realtimeService 2026-05-21). On every INSERT into board_user_swipe_states
 * for this session, the React Query cache is invalidated so the sheet
 * refreshes within seconds. The callback fires for BOTH left and right
 * swipes; we filter to left-only client-side (cheaper than refetching for
 * right swipes that don't appear in this sheet anyway).
 *
 * Returns the array directly (`[]` when undefined) so consumers can treat
 * it as a plain list without checking loading/error states. Loading state
 * is rendered by the sheet itself if needed; errors log to console (this
 * sheet is a secondary surface — failures must never block the deck).
 */

export interface CollabDismissalRow {
  experience_id: string;
  card_data: unknown | null;
  swiped_at: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  is_me: boolean;
}

interface RawSwipeRow {
  experience_id: string;
  user_id: string;
  swiped_at: string;
  card_data: unknown | null;
  profiles: {
    display_name: string | null;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
}

function pickDisplayName(p: RawSwipeRow['profiles']): string {
  if (!p) return 'Someone';
  if (p.display_name) return p.display_name;
  if (p.first_name && p.last_name) return `${p.first_name} ${p.last_name}`;
  if (p.first_name) return p.first_name;
  return 'Someone';
}

export function useSessionDismissedCards(
  sessionId: string | null,
  currentUserId: string | null,
): CollabDismissalRow[] {
  const queryClient = useQueryClient();

  const query = useQuery<CollabDismissalRow[]>({
    queryKey: ['session-dismissed-cards', sessionId],
    queryFn: async (): Promise<CollabDismissalRow[]> => {
      if (!sessionId) return [];
      const { data, error } = await supabase
        .from('board_user_swipe_states')
        .select(
          `
            experience_id,
            user_id,
            swiped_at,
            card_data,
            profiles:user_id (
              display_name,
              first_name,
              last_name,
              avatar_url
            )
          `,
        )
        .eq('session_id', sessionId)
        .eq('swipe_state', 'swiped_left')
        .order('swiped_at', { ascending: false });

      if (error) {
        console.warn('[useSessionDismissedCards] query failed', error);
        return [];
      }

      const rows = (data ?? []) as unknown as RawSwipeRow[];
      return rows.map((row) => ({
        experience_id: row.experience_id,
        card_data: row.card_data,
        swiped_at: row.swiped_at,
        user_id: row.user_id,
        display_name: pickDisplayName(row.profiles),
        avatar_url: row.profiles?.avatar_url ?? null,
        is_me: !!currentUserId && row.user_id === currentUserId,
      }));
    },
    enabled: !!sessionId,
    staleTime: 30_000,
  });

  // Realtime: invalidate when a new left-swipe arrives in this session.
  useEffect(() => {
    if (!sessionId) return;

    const callbacks = {
      onSwipeRecorded: (row: { swipe_state?: string; session_id?: string }) => {
        // Defensive: only react to swiped_left rows. Right swipes flow through
        // onCardSaved + match-quorum pathway, not this sheet.
        if (row?.swipe_state !== 'swiped_left') return;
        queryClient.invalidateQueries({
          queryKey: ['session-dismissed-cards', sessionId],
        });
      },
    };

    realtimeService.subscribeToBoardSession(sessionId, callbacks);
    return () => {
      realtimeService.unregisterBoardCallbacks(sessionId, callbacks);
    };
  }, [sessionId, queryClient]);

  return query.data ?? [];
}
