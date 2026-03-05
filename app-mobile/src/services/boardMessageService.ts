import { supabase } from './supabase';
import { realtimeService } from './realtimeService';

export interface BoardMessage {
  id: string;
  session_id: string;
  user_id: string;
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
}

export interface CardMessage {
  id: string;
  session_id: string;
  saved_card_id: string;
  user_id: string;
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

      // Get unique user IDs from messages
      const userIds = [...new Set(messages.map(m => m.user_id))];

      // Fetch profiles separately
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, username, display_name, first_name, last_name, avatar_url')
        .in('id', userIds);

      if (profilesError) {
        console.warn('Error fetching profiles:', profilesError);
        // Continue without profiles if there's an error
      }

      // Create a map of user_id to profile
      const profileMap = new Map(
        (profiles || []).map(p => [p.id, p])
      );

      // Merge messages with profiles
      const messagesWithProfiles = messages.map(message => ({
        ...message,
        profiles: profileMap.get(message.user_id) || null,
      }));

      // Load read receipts for messages
      const messageIds = messages.map(m => m.id);
      if (messageIds.length > 0) {
        const { data: reads } = await supabase
          .from('board_message_reads')
          .select('message_id, user_id, read_at')
          .in('message_id', messageIds);

        // Attach read receipts to messages
        const messagesWithReads = messagesWithProfiles.map(message => ({
          ...message,
          read_by: reads?.filter(r => r.message_id === message.id) || [],
        }));

        return { data: messagesWithReads as BoardMessage[], error: null };
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

      // Broadcast message
      realtimeService.sendBoardMessage(sessionId, {
        content: message.content,
        mentions: message.mentions || [],
        replyToId: message.reply_to_id,
      });

      // Mark as read by sender
      await this.markMessageAsRead(message.id, userId);

      // Send notifications (non-blocking)
      this.sendBoardMessageNotifications(sessionId, userId, message, messageWithProfile).catch(err =>
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

      // Get unique user IDs from messages
      const userIds = [...new Set(messages.map(m => m.user_id))];

      // Fetch profiles separately
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, username, display_name, first_name, last_name, avatar_url')
        .in('id', userIds);

      if (profilesError) {
        console.warn('Error fetching profiles:', profilesError);
        // Continue without profiles if there's an error
      }

      // Create a map of user_id to profile
      const profileMap = new Map(
        (profiles || []).map(p => [p.id, p])
      );

      // Merge messages with profiles
      const messagesWithProfiles = messages.map(message => ({
        ...message,
        profiles: profileMap.get(message.user_id) || null,
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
   * Send notifications for board messages
   */
  private static async sendBoardMessageNotifications(
    sessionId: string,
    senderId: string,
    message: any,
    messageWithProfile: BoardMessage
  ): Promise<void> {
    try {
      // Get session participants (excluding sender)
      const { data: participants, error: participantsError } = await supabase
        .from('session_participants')
        .select('user_id')
        .eq('session_id', sessionId)
        .neq('user_id', senderId)
        .eq('has_accepted', true);

      if (participantsError || !participants || participants.length === 0) {
        return;
      }

      // Get sender profile
      const senderName = messageWithProfile.profiles?.display_name ||
        (messageWithProfile.profiles?.first_name && messageWithProfile.profiles?.last_name
          ? `${messageWithProfile.profiles.first_name} ${messageWithProfile.profiles.last_name}`
          : messageWithProfile.profiles?.username || 'Someone');

      // Prepare message preview
      let messagePreview = message.content;
      if (messagePreview.length > 50) {
        messagePreview = messagePreview.substring(0, 50) + '...';
      }

      // Get session name
      const { data: session } = await supabase
        .from('collaboration_sessions')
        .select('name')
        .eq('id', sessionId)
        .single();

      const sessionName = session?.name || 'Board';

      // Send notifications to each participant
      for (const participant of participants) {
        const recipientId = participant.user_id;
        const isMentioned = message.mentions && Array.isArray(message.mentions) && message.mentions.includes(recipientId);

        // Import notification service dynamically
        const { enhancedNotificationService } = await import('./enhancedNotificationService');

        // Send push notification
        await enhancedNotificationService.sendPushNotification(recipientId, {
          type: 'board_update',
          title: isMentioned 
            ? `${senderName} mentioned you in ${sessionName}`
            : `New message in ${sessionName}`,
          body: messagePreview,
          data: {
            sessionId,
            messageId: message.id,
            messageType: 'board_message',
            isMention: isMentioned,
          },
        });

        // Send push notification if mentioned (edge function handles push delivery)
        if (isMentioned) {
          await this.sendMentionEmailNotification(recipientId, senderName, messagePreview, sessionId, sessionName);
        }
      }
    } catch (error) {
      console.error('Error sending board message notifications:', error);
    }
  }

  /**
   * Send push notification for mentions via edge function
   * (Edge function sends push notification — email was removed in auth simplification)
   */
  private static async sendMentionEmailNotification(
    recipientId: string,
    senderName: string,
    messagePreview: string,
    sessionId: string,
    sessionName: string
  ): Promise<void> {
    try {
      // Get recipient email
      const { data: recipientProfile } = await supabase
        .from('profiles')
        .select('email, first_name')
        .eq('id', recipientId)
        .single();

      if (!recipientProfile?.email) {
        return;
      }

      // Call Supabase Edge Function to send push notification
      const { error } = await supabase.functions.invoke('send-message-email', {
        body: {
          recipientId,
          recipientEmail: recipientProfile.email,
          recipientName: recipientProfile.first_name || 'User',
          senderName,
          senderEmail: 'noreply@mingla.app',
          messagePreview: `${senderName} mentioned you: ${messagePreview}`,
          conversationId: sessionId,
          isMention: true,
          sessionName,
        },
      });

      if (error) {
        console.log('Push notification via Edge Function not available:', error.message);
      }
    } catch (error) {
      console.log('Push notification error (non-critical):', error);
    }
  }
}

