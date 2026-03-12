import { supabase } from './supabase';

// --- Types ---

export interface ConversationPresenceRecord {
  user_id: string;
  is_online: boolean;
  last_seen_at: string;
  updated_at: string;
}

// --- Presence ---

/**
 * Upsert presence for a user in a conversation.
 * Non-critical — errors are logged, never thrown.
 */
export async function upsertPresence(
  conversationId: string,
  userId: string,
  isOnline: boolean
): Promise<void> {
  try {
    const { error } = await supabase
      .from('conversation_presence')
      .upsert(
        {
          conversation_id: conversationId,
          user_id: userId,
          is_online: isOnline,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'conversation_id,user_id' }
      );

    if (error) {
      console.error('Error upserting presence:', error);
    }
  } catch (err) {
    console.error('Error upserting presence:', err);
  }
}

/**
 * Mark all conversations offline for a user.
 * Fire-and-forget — called on app background/close.
 */
export async function markAllConversationsOffline(userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('conversation_presence')
      .update({
        is_online: false,
        last_seen_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('is_online', true);

    if (error) {
      console.error('Error marking all offline:', error);
    }
  } catch (err) {
    console.error('Error marking all offline:', err);
  }
}

/**
 * Get presence records for all participants in a conversation.
 */
export async function getConversationPresence(
  conversationId: string
): Promise<ConversationPresenceRecord[]> {
  try {
    const { data, error } = await supabase
      .from('conversation_presence')
      .select('user_id, is_online, last_seen_at, updated_at')
      .eq('conversation_id', conversationId);

    if (error) {
      console.error('Error fetching presence:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Error fetching presence:', err);
    return [];
  }
}

// --- Typing ---

/**
 * Broadcast typing indicator via a Supabase Realtime channel.
 * No DB write — typing is ephemeral, broadcast-only.
 *
 * IMPORTANT: The channel must already be subscribed to for broadcast to work.
 * This function uses supabase.channel() which returns an existing channel if
 * one with the same name is already subscribed.
 */
export function broadcastTyping(
  conversationId: string,
  userId: string,
  isTyping: boolean
): void {
  try {
    const channelName = `presence:${conversationId}`;
    const channel = supabase.channel(channelName);
    channel.send({
      type: 'broadcast',
      event: isTyping ? 'typing_start' : 'typing_stop',
      payload: {
        userId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    // Typing is non-critical — never throw
    console.error('Error broadcasting typing:', err);
  }
}
