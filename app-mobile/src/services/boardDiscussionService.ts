/**
 * @deprecated ORCH-0898 [Consumer collab session → Friends-tab group chat] migrated the
 * collab Discussions tab chat substrate from `board_messages` to the unified `messages`
 * table (linked via `conversations.session_id`). This module is RETAINED for 1 release as
 * a read-only legacy adapter for any pre-ORCH-0898 reader code that hasn't migrated yet.
 *
 * The new canonical service is `messagingService.ts`. The new canonical hook is the
 * post-ORCH-0898 `useSessionDiscussion.ts` which reads from `messages` via `messagingService`.
 *
 * AFTER ORCH-0902 [board* services consolidation] CLOSES, this file will be deleted.
 *
 * Write methods (sendMessage, toggleReaction, markMessagesAsRead, uploadMessageImage) are
 * BLOCKED post-ORCH-0898 — they would write to board_messages which is no longer the
 * canonical store and would cause split-brain across the two substrates. New writes go
 * through `messagingService.sendMessage` + `toggleDirectMessageReaction` + `markAsRead`
 * targeting the unified messages table.
 *
 * Reads STILL WORK during the dual-read window — Pass-through reads from board_messages
 * are preserved so the legacy Discussions-tab implementation continues functioning while
 * client code migrates incrementally. Post-ORCH-0902, both reads + types are removed.
 */
import { supabase } from './supabase';

// --- Types ---

export interface BoardMessage {
  id: string;
  session_id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  mentions: string[];
  reply_to_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  user?: { id: string; display_name: string | null; avatar_url: string | null };
  reactions?: BoardMessageReaction[];
  read_by?: BoardMessageRead[];
}

export interface BoardMessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface BoardMessageRead {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string;
}

// --- Queries ---

/** Fetch messages for a session, paginated, newest first. */
export async function fetchSessionMessages(
  sessionId: string,
  cursor?: string,
  limit: number = 30
): Promise<BoardMessage[]> {
  let query = supabase
    .from('board_messages')
    .select(`
      *,
      user:profiles!user_id(id, display_name, avatar_url),
      reactions:board_message_reactions(*),
      read_by:board_message_reads(*)
    `)
    .eq('session_id', sessionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * @deprecated ORCH-0898 BLOCKED: writes to board_messages would create split-brain with the
 * unified messages substrate. Use `messagingService.sendMessage(conversationId, ...)` with
 * the session's group conversation_id (resolve via `messagingService.getOrCreateGroupConversationForSession`).
 */
export async function sendMessage(params: {
  sessionId: string;
  userId: string;
  content: string;
  imageUrl?: string;
  mentions?: string[];
  replyToId?: string;
}): Promise<BoardMessage> {
  throw new Error(
    '[TRANSITIONAL] ORCH-0898 dual-read window: boardDiscussionService.sendMessage is BLOCKED. ' +
    'Writes must go through messagingService.sendMessage targeting the unified messages substrate. ' +
    'Exit condition: ORCH-0902 [board* services consolidation] CLOSE.'
  );
}

/**
 * @deprecated ORCH-0898 BLOCKED: writes to board_message_reactions would create split-brain
 * with the unified messages substrate. Use `messagingService.toggleDirectMessageReaction(messageId, userId, emoji)`
 * targeting the unified `direct_message_reactions` (post-ORCH-0902 will rename to `message_reactions`).
 */
export async function toggleReaction(
  _messageId: string,
  _userId: string,
  _emoji: string,
): Promise<boolean> {
  throw new Error(
    '[TRANSITIONAL] ORCH-0898 dual-read window: boardDiscussionService.toggleReaction is BLOCKED. ' +
    'Use messagingService.toggleDirectMessageReaction targeting the unified substrate. ' +
    'Exit condition: ORCH-0902 [board* services consolidation] CLOSE.'
  );
}

/**
 * @deprecated ORCH-0898 BLOCKED: writes to board_message_reads would create split-brain with
 * the unified messages substrate. Use `messagingService.markAsRead(messageIds, userId)`
 * targeting `message_reads`.
 */
export async function markMessagesAsRead(
  _messageIds: string[],
  _userId: string,
): Promise<void> {
  throw new Error(
    '[TRANSITIONAL] ORCH-0898 dual-read window: boardDiscussionService.markMessagesAsRead is BLOCKED. ' +
    'Use messagingService.markAsRead targeting the unified substrate. ' +
    'Exit condition: ORCH-0902 [board* services consolidation] CLOSE.'
  );
}

/**
 * @deprecated ORCH-0898 BLOCKED: image uploads must go through the new unified path. The
 * board-attachments storage bucket is being retired in favor of a unified chat-attachments
 * bucket (ORCH-0902 scope). Until then, callers must use the existing messagingService
 * file-upload paths.
 */
export async function uploadMessageImage(
  _sessionId: string,
  _messageId: string,
  _uri: string,
  _mimeType: string = 'image/jpeg',
): Promise<string> {
  throw new Error(
    '[TRANSITIONAL] ORCH-0898 dual-read window: boardDiscussionService.uploadMessageImage is BLOCKED. ' +
    'New image attachments must flow through the unified messagingService path. ' +
    'Exit condition: ORCH-0902 [board* services consolidation] CLOSE.'
  );
}

// Legacy uploadMessageImage tail preserved as a noop reference (unreachable):
async function _orch_0898_legacy_upload_noop_dead_code() {
  const sessionId = '', messageId = '', uri = '', mimeType = '';
  const extension = mimeType.split('/')[1] || 'jpg';
  const filePath = `${sessionId}/${messageId}/image.${extension}`;

  const response = await fetch(uri);
  const blob = await response.blob();

  const { error } = await supabase.storage
    .from('board-attachments')
    .upload(filePath, blob, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) throw new Error(error.message);

  const { data: signedData } = await supabase.storage
    .from('board-attachments')
    .createSignedUrl(filePath, 365 * 24 * 60 * 60);

  if (!signedData?.signedUrl) {
    throw new Error('Failed to generate signed URL for uploaded image');
  }
  return signedData.signedUrl;
}
