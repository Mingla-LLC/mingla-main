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
      const { data, error } = await supabase
        .from('board_messages')
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
        .eq('session_id', sessionId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Load read receipts for messages
      const messageIds = (data || []).map(m => m.id);
      if (messageIds.length > 0) {
        const { data: reads } = await supabase
          .from('board_message_reads')
          .select('message_id, user_id, read_at')
          .in('message_id', messageIds);

        // Attach read receipts to messages
        const messagesWithReads = (data || []).map(message => ({
          ...message,
          read_by: reads?.filter(r => r.message_id === message.id) || [],
        }));

        return { data: messagesWithReads as BoardMessage[], error: null };
      }

      return { data: (data || []) as BoardMessage[], error: null };
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
      const { data, error } = await supabase
        .from('board_messages')
        .insert({
          session_id: sessionId,
          user_id: userId,
          content: content.trim(),
          mentions: mentions.length > 0 ? mentions : null,
          reply_to_id: replyToId || null,
        })
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
        .single();

      if (error) throw error;

      // Broadcast message
      realtimeService.sendBoardMessage(sessionId, {
        content: data.content,
        mentions: data.mentions || [],
        replyToId: data.reply_to_id,
      });

      // Mark as read by sender
      await this.markMessageAsRead(data.id, userId);

      return { data: data as BoardMessage, error: null };
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
      const { data, error } = await supabase
        .from('board_messages')
        .update({
          content: content.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId)
        .eq('user_id', userId)
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
        .single();

      if (error) throw error;

      return { data: data as BoardMessage, error: null };
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
      const { data, error } = await supabase
        .from('board_card_messages')
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
        .eq('session_id', sessionId)
        .eq('saved_card_id', savedCardId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Load read receipts
      const messageIds = (data || []).map(m => m.id);
      if (messageIds.length > 0) {
        const { data: reads } = await supabase
          .from('board_card_message_reads')
          .select('message_id, user_id, read_at')
          .in('message_id', messageIds);

        const messagesWithReads = (data || []).map(message => ({
          ...message,
          read_by: reads?.filter(r => r.message_id === message.id) || [],
        }));

        return { data: messagesWithReads as CardMessage[], error: null };
      }

      return { data: (data || []) as CardMessage[], error: null };
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
      const { data, error } = await supabase
        .from('board_card_messages')
        .insert({
          session_id: sessionId,
          saved_card_id: savedCardId,
          user_id: userId,
          content: content.trim(),
          mentions: mentions.length > 0 ? mentions : null,
          reply_to_id: replyToId || null,
        })
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
        .single();

      if (error) throw error;

      // Broadcast message
      realtimeService.sendCardMessage(sessionId, savedCardId, {
        content: data.content,
        mentions: data.mentions || [],
        replyToId: data.reply_to_id,
      });

      // Mark as read by sender
      await this.markCardMessageAsRead(data.id, userId);

      return { data: data as CardMessage, error: null };
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
      const { data, error } = await supabase
        .from('board_card_messages')
        .update({
          content: content.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId)
        .eq('user_id', userId)
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
        .single();

      if (error) throw error;

      return { data: data as CardMessage, error: null };
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
}

