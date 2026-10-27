/**
 * Issue #4114 Wave 5 — the one create path for a collab inside a 1:1 chat.
 *
 * `start_dm_collab` (SECURITY DEFINER) checks friendship, blocks, the one live
 * session per chat and the free-plan limit, then creates the session linked to
 * the chat, both participants, the starter's prefs, the invite and the
 * "started" row. The friend's push reuses `send-collaboration-invite`. Joining
 * reuses `acceptCollaborationInvite` (accept_session_with_prefs); declining
 * reuses `declineCollaborationInvite`, and the server ends the collab on decline.
 */
import { supabase } from './supabase';
import {
  DM_COLLAB_LIVE_STATUSES,
  isLiveSessionStatus,
  parseDmCollabStartError,
  type DmCollabSession,
  type DmCollabStartError,
} from '../components/chat/dmCollabModel';

export class DmCollabStartFailure extends Error {
  readonly reason: DmCollabStartError;

  constructor(reason: DmCollabStartError, message: string) {
    super(message);
    this.name = 'DmCollabStartFailure';
    this.reason = reason;
  }
}

export interface StartDmCollabResult {
  sessionId: string;
  inviteId: string;
  sessionName: string;
  friendId: string;
}

interface StartDmCollabRow {
  session_id?: string;
  invite_id?: string;
  session_name?: string;
  friend_id?: string;
}

export async function startDmCollab(params: {
  conversationId: string;
  inviterId: string;
  name?: string | null;
}): Promise<StartDmCollabResult> {
  const { data, error } = await supabase.rpc('start_dm_collab', {
    p_conversation_id: params.conversationId,
    p_name: params.name ?? null,
  });
  if (error) {
    throw new DmCollabStartFailure(parseDmCollabStartError(error.message), error.message);
  }
  const row = (data ?? {}) as StartDmCollabRow;
  if (!row.session_id || !row.invite_id || !row.friend_id) {
    throw new DmCollabStartFailure('unknown', 'start_dm_collab returned no session');
  }
  const result: StartDmCollabResult = {
    sessionId: row.session_id,
    inviteId: row.invite_id,
    sessionName: row.session_name ?? '',
    friendId: row.friend_id,
  };

  // The friend's push, through the same function a group invite uses. The
  // collab already exists and the invite card is in the chat, so a push failure
  // is logged rather than undoing the start.
  const { error: pushError } = await supabase.functions.invoke('send-collaboration-invite', {
    body: {
      inviterId: params.inviterId,
      invitedUserId: result.friendId,
      sessionId: result.sessionId,
      sessionName: result.sessionName,
      inviteId: result.inviteId,
    },
  });
  if (pushError) {
    console.warn('[dmCollabService] invite push failed:', pushError.message);
  }
  return result;
}

export async function endDmCollab(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('end_dm_collab', { p_session_id: sessionId });
  if (error) throw new Error(error.message);
}

interface SessionRow {
  id: string;
  name: string | null;
  status: string | null;
  created_by: string | null;
  created_at: string;
  session_participants?: Array<{ user_id: string; has_accepted: boolean | null }> | null;
}

/** The chat's live collab, newest first, or null. RLS: creator, participant or invitee. */
export async function fetchDmCollabSession(conversationId: string): Promise<DmCollabSession | null> {
  const { data, error } = await supabase
    .from('collaboration_sessions')
    .select('id, name, status, created_by, created_at, session_participants(user_id, has_accepted)')
    .eq('conversation_id', conversationId)
    .in('status', [...DM_COLLAB_LIVE_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as SessionRow | null;
  if (!row || !isLiveSessionStatus(row.status)) return null;
  return {
    id: row.id,
    name: row.name ?? '',
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    participants: (row.session_participants ?? []).map((participant) => ({
      userId: participant.user_id,
      hasAccepted: participant.has_accepted === true,
    })),
  };
}

/** For deep links: the 1:1 chat a session was started from, if any. */
export async function fetchSessionConversationId(sessionId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('collaboration_sessions')
    .select('conversation_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { conversation_id: string | null } | null)?.conversation_id ?? null;
}
