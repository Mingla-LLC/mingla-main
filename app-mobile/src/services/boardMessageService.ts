import { supabase } from './supabase';
import { realtimeService } from './realtimeService';

export interface BoardMessage {
  id: string;
  session_id: string;
  user_id: string | null;
  content: string;
  mentions?: string[];
  reply_to_id?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  profiles?: {
    id: string;
    username: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
  reply_to?: BoardMessage;
  read_by?: Array<{
    user_id: string;
    read_at: string;
  }>;
  reactions?: Array<{
    id: string;
    message_id: string;
    user_id: string;
    emoji: string;
    created_at: string;
  }>;
}

export interface CardMessage {
  id: string;
  session_id: string;
  saved_card_id: string;
  user_id: string | null;
  content: string;
  mentions?: string[];
  reply_to_id?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  profiles?: {
    id: string;
    username: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
  reply_to?: CardMessage;
  read_by?: Array<{
    user_id: string;
    read_at: string;
  }>;
}

export interface SendMessageParams {
  sessionId: string;
  content: string;
  mentions?: string[];
  replyToId?: string;
  userId: string;
}

export interface SendCardMessageParams extends SendMessageParams {
  savedCardId: string;
}

export class BoardMessageService {
  /**
   * Get all messages for a board session
   */
  static async getBoardMessages(
    sessionId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ data: BoardMessage[]; error: any }> {
    try {
      // First, fetch messages without profiles join
      const { data: messages, error: messagesError } = await supabase
        .from('board_messages')
        .select('*')
        .eq('session_id', sessionId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);

      if (messagesError) throw messagesError;

      if (!messages || messages.length === 0) {
        return { data: [], error: null };
      }

      // Get unique user IDs from messages (filter out null for deleted users)
      const userIds = [...new Set(messages.map(m => m.user_id).filter(Boolean))] as string[];

      // Fetch profiles separately
      let profileMap = new Map<string, any>();
      if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username, display_name, first_name, last_name, avatar_url')
          .in('id', userIds);

        if (profilesError) {
          console.warn('Error fetching profiles:', profilesError);
        }

        profileMap = new Map((profiles || []).map(p => [p.id, p]));
      }

      // Merge messages with profiles (null user_id = deleted user)
      const messagesWithProfiles = messages.map(message => ({
        ...message,
        profiles: message.user_id ? profileMap.get(message.user_id) || null : null,
      }));

      // Load read receipts, reactions, and reply-to messages
      const messageIds = messages.map(m => m.id);
      const replyToIds = [...new Set(
        messages.map(m => m.reply_to_id).filter(Boolean)
      )] as string[];

      if (messageIds.length > 0) {
        const [{ data: reads }, { data: reactions }] = await Promise.all([
          supabase
            .from('board_message_reads')
            .select('message_id, user_id, read_at')
            .in('message_id', messageIds),
          supabase
            .from('board_message_reactions')
            .select('id, message_id, user_id, emoji, created_at')
            .in('message_id', messageIds),
        ]);

        // Fetch reply-to messages if any exist
        let replyMessages: any[] = [];
        if (replyToIds.length > 0) {
          const { data: replyData } = await supabase
            .from('board_messages')
            .select('id, content, user_id, image_url, deleted_at')
            .in('id', replyToIds);
          replyMessages = replyData || [];
        }

        // Build reply-to lookup map
        const replyMap = new Map<string, any>();
        for (const rm of (replyMessages || [])) {
          replyMap.set(rm.id, rm);
        }

        // Fetch profiles for reply-to authors
        const replyUserIds = [...new Set(
          (replyMessages || []).map((rm: any) => rm.user_id).filter(Boolean)
        )] as string[];
        const missingReplyUserIds = replyUserIds.filter(id => !profileMap.has(id));
        if (missingReplyUserIds.length > 0) {
          const { data: replyProfiles } = await supabase
            .from('profiles')
            .select('id, username, display_name, first_name, last_name, avatar_url')
            .in('id', missingReplyUserIds);
          for (const p of (replyProfiles || [])) {
            profileMap.set(p.id, p);
          }
        }

        // Attach read receipts, reactions, and reply_to to messages
        const messagesWithExtras = messagesWithProfiles.map(message => {
          const replyToMsg = message.reply_to_id ? replyMap.get(message.reply_to_id) : null;
          return {
            ...message,
            read_by: reads?.filter((r: any) => r.message_id === message.id) || [],
            reactions: reactions?.filter((r: any) => r.message_id === message.id) || [],
            reply_to: replyToMsg ? {
              ...replyToMsg,
              profiles: replyToMsg.user_id ? profileMap.get(replyToMsg.user_id) || null : null,
            } : undefined,
          };
        });

        return { data: messagesWithExtras as BoardMessage[], error: null };
      }

      return { data: messagesWithProfiles as BoardMessage[], error: null };
    } catch (err: any) {
      console.error('Error getting board messages:', err);
      return { data: [], error: err };
    }
  }

  /**
   * Send a message to board session
   */
  static async sendBoardMessage({
    sessionId,
    content,
    mentions = [],
    replyToId,
    userId,
  }: SendMessageParams): Promise<{ data: BoardMessage | null; error: any }> {
    try {
      const { data: message, error: insertError } = await supabase
        .from('board_messages')
        .insert({
          session_id: sessionId,
          user_id: userId,
          content: content.trim(),
          mentions: mentions.length > 0 ? mentions : null,
          reply_to_id: replyToId || null,
        })
        .select('*')
        .single();

      if (insertError) throw insertError;

      // Fetch profile separately
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, display_name, first_name, last_name, avatar_url')
        .eq('id', userId)
        .single();

      const messageWithProfile = {
        ...message,
        profiles: profile || null,
      };

      // Broadcast full message so other participants see it instantly
      realtimeService.sendBoardMessage(sessionId, {
        id: message.id,
        session_id: message.session_id,
        user_id: message.user_id,
        content: message.content,
        mentions: message.mentions || null,
        reply_to_id: message.reply_to_id || null,
        created_at: message.created_at,
        updated_at: message.updated_at,
      });

      // Mark as read by sender
      await this.markMessageAsRead(message.id, userId);

      // Send notifications (non-blocking) — include reply-to author
      const replyToUserId = message.reply_to_id ? await this.getMessageAuthor(message.reply_to_id) : null;
      this.sendBoardMessageNotifications(sessionId, userId, message, messageWithProfile, replyToUserId).catch(err =>
        console.error('Error sending board message notifications:', err)
      );

      return { data: messageWithProfile as BoardMessage, error: null };
    } catch (err: any) {
      console.error('Error sending board message:', err);
      return { data: null, error: err };
    }
  }

  /**
   * Update a message
   */
  static async updateMessage(
    messageId: string,
    content: string,
    userId: string
  ): Promise<{ data: BoardMessage | null; error: any }> {
    try {
      const { data: message, error: updateError } = await supabase
        .from('board_messages')
        .update({
          content: content.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (updateError) throw updateError;

      // Fetch profile separately
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, display_name, first_name, last_name, avatar_url')
        .eq('id', userId)
        .single();

      const messageWithProfile = {
        ...message,
        profiles: profile || null,
      };

      return { data: messageWithProfile as BoardMessage, error: null };
    } catch (err: any) {
      console.error('Error updating message:', err);
      return { data: null, error: err };
    }
  }

  /**
   * Delete a message (soft delete)
   */
  static async deleteMessage(
    messageId: string,
    userId: string
  ): Promise<{ error: any }> {
    try {
      const { error } = await supabase
        .from('board_messages')
        .update({
          deleted_at: new Date().toISOString(),
        })
        .eq('id', messageId)
        .eq('user_id', userId);

      if (error) throw error;

      return { error: null };
    } catch (err: any) {
      console.error('Error deleting message:', err);
      return { error: err };
    }
  }

  /**
   * Mark message as read
   */
  static async markMessageAsRead(
    messageId: string,
    userId: string
  ): Promise<{ error: any }> {
    try {
      const { error } = await supabase
        .from('board_message_reads')
        .upsert(
          {
            message_id: messageId,
            user_id: userId,
            read_at: new Date().toISOString(),
          },
          {
            onConflict: 'message_id,user_id',
          }
        );

      if (error) throw error;

      return { error: null };
    } catch (err: any) {
      console.error('Error marking message as read:', err);
      return { error: err };
    }
  }

  /**
   * Mark all messages in session as read
   */
  static async markAllMessagesAsRead(
    sessionId: string,
    userId: string
  ): Promise<{ error: any }> {
    try {
      // Get all unread message IDs
      const { data: unreadMessages } = await supabase
        .from('board_messages')
        .select('id')
        .eq('session_id', sessionId)
        .neq('user_id', userId)
        .is('deleted_at', null);

      if (!unreadMessages || unreadMessages.length === 0) {
        return { error: null };
      }

      const messageIds = unreadMessages.map(m => m.id);

      // Get already read messages
      const { data: readMessages } = await supabase
        .from('board_message_reads')
        .select('message_id')
        .eq('user_id', userId)
        .in('message_id', messageIds);

      const readMessageIds = new Set(readMessages?.map(r => r.message_id) || []);
      const unreadMessageIds = messageIds.filter(id => !readMessageIds.has(id));

      if (unreadMessageIds.length === 0) {
        return { error: null };
      }

      // Insert read receipts for unread messages
      const readReceipts = unreadMessageIds.map(messageId => ({
        message_id: messageId,
        user_id: userId,
        read_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('board_message_reads')
        .insert(readReceipts);

      if (error) throw error;

      return { error: null };
    } catch (err: any) {
      console.error('Error marking all messages as read:', err);
      return { error: err };
    }
  }

  /**
   * Toggle an emoji reaction on a message (add if not present, remove if already added)
   */
  static async toggleReaction(
    messageId: string,
    userId: string,
    emoji: string
  ): Promise<{ added: boolean; error: any }> {
    try {
      const { data: existing } = await supabase
        .from('board_message_reactions')
        .select('id')
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .eq('emoji', emoji)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('board_message_reactions')
          .delete()
          .eq('id', existing.id);
        if (error) throw error;
        return { added: false, error: null };
      } else {
        const { error } = await supabase
          .from('board_message_reactions')
          .insert({ message_id: messageId, user_id: userId, emoji });
        if (error) throw error;

        // Notify the message author (non-blocking)
        this.sendReactionNotification(messageId, userId, emoji).catch((err) =>
          console.warn('Reaction notification failed (non-critical):', err)
        );

        return { added: true, error: null };
      }
    } catch (err: any) {
      console.error('Error toggling reaction:', err);
      return { added: false, error: err };
    }
  }

  /**
   * Send a push notification to the message author when someone reacts.
   */
  private static async sendReactionNotification(
    messageId: string,
    reactorId: string,
    emoji: string
  ): Promise<void> {
    // Get the message author
    const authorId = await this.getMessageAuthor(messageId);
    if (!authorId || authorId === reactorId) return; // Don't notify self

    // Get the message content for preview
    const { data: message } = await supabase
      .from('board_messages')
      .select('content, session_id')
      .eq('id', messageId)
      .single();

    if (!message) return;

    // Get session name
    const { data: session } = await supabase
      .from('collaboration_sessions')
      .select('name')
      .eq('id', message.session_id)
      .single();

    let messagePreview = message.content || '';
    if (messagePreview.length > 50) {
      messagePreview = messagePreview.substring(0, 49) + '\u2026';
    }

    await supabase.functions.invoke('notify-message', {
      body: {
        type: 'board_mention',
        senderId: reactorId,
        sessionId: message.session_id,
        sessionName: session?.name || 'Board',
        messageId,
        messagePreview: `${emoji} "${messagePreview}"`,
        mentionedUserIds: [authorId],
      },
    });
  }

  // ===========================================
  // CARD-SPECIFIC MESSAGES
  // ===========================================

  /**
   * Get messages for a specific card
   */
  static async getCardMessages(
    sessionId: string,
    savedCardId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ data: CardMessage[]; error: any }> {
    try {
      // First, fetch messages without profiles join
      const { data: messages, error: messagesError } = await supabase
        .from('board_card_messages')
        .select('*')
        .eq('session_id', sessionId)
        .eq('saved_card_id', savedCardId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);

      if (messagesError) throw messagesError;

      if (!messages || messages.length === 0) {
        return { data: [], error: null };
      }

      // Get unique user IDs from messages (filter out null for deleted users)
      const userIds = [...new Set(messages.map(m => m.user_id).filter(Boolean))] as string[];

      // Fetch profiles separately
      let profileMap = new Map<string, any>();
      if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username, display_name, first_name, last_name, avatar_url')
          .in('id', userIds);

        if (profilesError) {
          console.warn('Error fetching profiles:', profilesError);
        }

        profileMap = new Map((profiles || []).map(p => [p.id, p]));
      }

      // Merge messages with profiles (null user_id = deleted user)
      const messagesWithProfiles = messages.map(message => ({
        ...message,
        profiles: message.user_id ? profileMap.get(message.user_id) || null : null,
      }));

      // Load read receipts
      const messageIds = messages.map(m => m.id);
      if (messageIds.length > 0) {
        const { data: reads } = await supabase
          .from('board_card_message_reads')
          .select('message_id, user_id, read_at')
          .in('message_id', messageIds);

        const messagesWithReads = messagesWithProfiles.map(message => ({
          ...message,
          read_by: reads?.filter(r => r.message_id === message.id) || [],
        }));

        return { data: messagesWithReads as CardMessage[], error: null };
      }

      return { data: messagesWithProfiles as CardMessage[], error: null };
    } catch (err: any) {
      console.error('Error getting card messages:', err);
      return { data: [], error: err };
    }
  }

  /**
   * Send a message to card-specific discussion
   */
  static async sendCardMessage({
    sessionId,
    savedCardId,
    content,
    mentions = [],
    replyToId,
    userId,
  }: SendCardMessageParams): Promise<{ data: CardMessage | null; error: any }> {
    try {
      const { data: message, error: insertError } = await supabase
        .from('board_card_messages')
        .insert({
          session_id: sessionId,
          saved_card_id: savedCardId,
          user_id: userId,
          content: content.trim(),
          mentions: mentions.length > 0 ? mentions : null,
          reply_to_id: replyToId || null,
        })
        .select('*')
        .single();

      if (insertError) throw insertError;

      // Fetch profile separately
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, display_name, first_name, last_name, avatar_url')
        .eq('id', userId)
        .single();

      const messageWithProfile = {
        ...message,
        profiles: profile || null,
      };

      // Broadcast message
      realtimeService.sendCardMessage(sessionId, savedCardId, {
        content: message.content,
        mentions: message.mentions || [],
        replyToId: message.reply_to_id,
      });

      // Mark as read by sender
      await this.markCardMessageAsRead(message.id, userId);

      return { data: messageWithProfile as CardMessage, error: null };
    } catch (err: any) {
      console.error('Error sending card message:', err);
      return { data: null, error: err };
    }
  }

  /**
   * Mark card message as read
   */
  static async markCardMessageAsRead(
    messageId: string,
    userId: string
  ): Promise<{ error: any }> {
    try {
      const { error } = await supabase
        .from('board_card_message_reads')
        .upsert(
          {
            message_id: messageId,
            user_id: userId,
            read_at: new Date().toISOString(),
          },
          {
            onConflict: 'message_id,user_id',
          }
        );

      if (error) throw error;

      return { error: null };
    } catch (err: any) {
      console.error('Error marking card message as read:', err);
      return { error: err };
    }
  }

  /**
   * Update card message
   */
  static async updateCardMessage(
    messageId: string,
    content: string,
    userId: string
  ): Promise<{ data: CardMessage | null; error: any }> {
    try {
      const { data: message, error: updateError } = await supabase
        .from('board_card_messages')
        .update({
          content: content.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (updateError) throw updateError;

      // Fetch profile separately
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, display_name, first_name, last_name, avatar_url')
        .eq('id', userId)
        .single();

      const messageWithProfile = {
        ...message,
        profiles: profile || null,
      };

      return { data: messageWithProfile as CardMessage, error: null };
    } catch (err: any) {
      console.error('Error updating card message:', err);
      return { data: null, error: err };
    }
  }

  /**
   * Delete card message
   */
  static async deleteCardMessage(
    messageId: string,
    userId: string
  ): Promise<{ error: any }> {
    try {
      const { error } = await supabase
        .from('board_card_messages')
        .update({
          deleted_at: new Date().toISOString(),
        })
        .eq('id', messageId)
        .eq('user_id', userId);

      if (error) throw error;

      return { error: null };
    } catch (err: any) {
      console.error('Error deleting card message:', err);
      return { error: err };
    }
  }

  /**
   * Get total unread board messages count for a user across all sessions
   */
  static async getTotalUnreadBoardMessages(
    userId: string
  ): Promise<{ count: number; error: any }> {
    try {
      // Get all sessions where user is a participant
      const { data: sessions, error: sessionsError } = await supabase
        .from('session_participants')
        .select('session_id')
        .eq('user_id', userId)
        .eq('has_accepted', true);

      if (sessionsError || !sessions || sessions.length === 0) {
        return { count: 0, error: null };
      }

      const sessionIds = sessions.map(s => s.session_id);

      // Get all unread messages in these sessions
      const { data: unreadMessages, error: messagesError } = await supabase
        .from('board_messages')
        .select('id')
        .in('session_id', sessionIds)
        .neq('user_id', userId) // Exclude messages sent by the user
        .is('deleted_at', null);

      if (messagesError || !unreadMessages || unreadMessages.length === 0) {
        return { count: 0, error: null };
      }

      const messageIds = unreadMessages.map(m => m.id);

      // Get read receipts for these messages
      const { data: readMessages } = await supabase
        .from('board_message_reads')
        .select('message_id')
        .eq('user_id', userId)
        .in('message_id', messageIds);

      const readMessageIds = new Set(readMessages?.map(r => r.message_id) || []);
      const unreadCount = messageIds.filter(id => !readMessageIds.has(id)).length;

      return { count: unreadCount, error: null };
    } catch (err: any) {
      console.error('Error getting total unread board messages:', err);
      return { count: 0, error: err };
    }
  }

  /**
   * Get unread messages count for a specific board session
   */
  static async getUnreadBoardMessagesCount(
    sessionId: string,
    userId: string
  ): Promise<{ count: number; error: any }> {
    try {
      // Get all unread messages in this session
      const { data: unreadMessages, error: messagesError } = await supabase
        .from('board_messages')
        .select('id')
        .eq('session_id', sessionId)
        .neq('user_id', userId) // Exclude messages sent by the user
        .is('deleted_at', null);

      if (messagesError || !unreadMessages || unreadMessages.length === 0) {
        return { count: 0, error: null };
      }

      const messageIds = unreadMessages.map(m => m.id);

      // Get read receipts for these messages
      const { data: readMessages } = await supabase
        .from('board_message_reads')
        .select('message_id')
        .eq('user_id', userId)
        .in('message_id', messageIds);

      const readMessageIds = new Set(readMessages?.map(r => r.message_id) || []);
      const unreadCount = messageIds.filter(id => !readMessageIds.has(id)).length;

      return { count: unreadCount, error: null };
    } catch (err: any) {
      console.error('Error getting unread board messages count:', err);
      return { count: 0, error: err };
    }
  }

  /**
   * Look up the author of a message by ID.
   */
  private static async getMessageAuthor(messageId: string): Promise<string | null> {
    try {
      const { data } = await supabase
        .from('board_messages')
        .select('user_id')
        .eq('id', messageId)
        .single();
      return data?.user_id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Send notifications for mentions and replies via the notify-message → notify-dispatch pipeline.
   * Fires for @mentioned users AND the author of the replied-to message.
   */
  private static async sendBoardMessageNotifications(
    sessionId: string,
    senderId: string,
    message: { id: string; content: string; mentions?: string[] | null },
    _messageWithProfile: BoardMessage,
    replyToUserId?: string | null
  ): Promise<void> {
    try {
      const notifySet = new Set<string>(
        Array.isArray(message.mentions) ? message.mentions : []
      );
      // Also notify the person being replied to
      if (replyToUserId) {
        notifySet.add(replyToUserId);
      }
      // Never notify the sender themselves
      notifySet.delete(senderId);

      const mentionedUserIds = Array.from(notifySet);
      if (mentionedUserIds.length === 0) return;

      // Get session name for the notification copy
      const { data: session } = await supabase
        .from('collaboration_sessions')
        .select('name')
        .eq('id', sessionId)
        .single();

      const sessionName = session?.name || 'Board';

      // Truncate preview client-side to avoid sending huge payloads
      let messagePreview = message.content || '';
      if (messagePreview.length > 100) {
        messagePreview = messagePreview.substring(0, 99) + '\u2026';
      }

      // Single call to notify-message with board_mention type.
      // The edge function resolves sender profile, dispatches to notify-dispatch
      // per mentioned user, which handles: in-app record, preferences, quiet hours,
      // rate limiting, idempotency, and push delivery via OneSignal.
      const { error } = await supabase.functions.invoke('notify-message', {
        body: {
          type: 'board_mention',
          senderId,
          sessionId,
          sessionName,
          messageId: message.id,
          messagePreview,
          mentionedUserIds,
        },
      });

      if (error) {
        console.warn('notify-message (board_mention) failed:', error.message || error);
      }
    } catch (error) {
      console.warn('Board mention notification error (non-critical):', error);
    }
  }
}

