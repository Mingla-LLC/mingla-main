/**
 * sessionMuteService — per-participant session mute persistence (ORCH-0520).
 *
 * Writes to session_participants.notifications_muted. RLS restricts the UPDATE
 * to the row's own user (auth.uid() = user_id), so a user can only toggle their
 * own mute state.
 *
 * Mute state is read by notify-dispatch before delivering session-scoped push
 * types (SESSION_SCOPED_TYPES set in supabase/functions/notify-dispatch/index.ts).
 * The in-app notification row still inserts regardless of mute — only push is
 * suppressed.
 *
 * Invariant I-SESSION-MUTE-DEFAULT-UNMUTED: the DB column defaults to false.
 * No code path in this service writes true unless explicitly asked by the
 * caller (i.e., the user tapping the bell).
 */
import { supabase } from './supabase';

export interface SetSessionMuteResult {
  success: boolean;
  error?: string;
}

/**
 * Toggle the current user's mute state for a specific session.
 *
 * @returns success: true if the DB UPDATE committed; otherwise success: false with error.
 */
export async function setSessionMute(
  sessionId: string,
  muted: boolean
): Promise<SetSessionMuteResult> {
  if (!sessionId) {
    return { success: false, error: 'Session ID is required' };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { error } = await supabase
    .from('session_participants')
    .update({ notifications_muted: muted })
    .eq('session_id', sessionId)
    .eq('user_id', authData.user.id);

  if (error) {
    console.error('[sessionMuteService] setSessionMute error:', error);
    return { success: false, error: error.message || 'Failed to update mute state' };
  }

  return { success: true };
}
