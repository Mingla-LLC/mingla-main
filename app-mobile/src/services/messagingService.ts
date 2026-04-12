import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { blockService } from './blockService';
import { getDisplayName } from '../utils/getDisplayName';

export interface DirectMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string;
  message_type: 'text' | 'image' | 'video' | 'file';
  file_url?: string;
  file_name?: string;
  file_size?: number;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
  sender_name?: string;
  is_read?: boolean;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_message_at?: string;
  participants: {
    id: string;
    user_id: string;
    joined_at: string;
    last_read_at?: string;
  }[];
  last_message?: DirectMessage;
  unread_count?: number;
}

export class MessagingService {
  private channels: Map<string, RealtimeChannel> = new Map();
  private senderProfileCache: Map<string, { name: string; cachedAt: number }> = new Map();
  private static PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get or create a direct conversation between two users
   */
  async getOrCreateDirectConversation(userId1: string, userId2: string): Promise<{ conversation: Conversation | null; error: string | null }> {
    try {
      // Check if there's a block between users before creating/returning conversation
      const hasBlock = await blockService.hasBlockBetween(userId2);
      if (hasBlock) {
        return { conversation: null, error: 'Cannot message this user' };
      }

      // Check friendship or pairing before allowing conversation.
      // DM is gated to friends and paired users only (ORCH-0356).
      const { data: friendship } = await supabase
        .from('friends')
        .select('id')
        .or(`and(user_id.eq.${userId1},friend_user_id.eq.${userId2}),and(user_id.eq.${userId2},friend_user_id.eq.${userId1})`)
        .eq('status', 'accepted')
        .limit(1);

      const sortedIds = [userId1, userId2].sort();
      const { data: pairing } = await supabase
        .from('pairings')
        .select('id')
        .eq('user_a_id', sortedIds[0])
        .eq('user_b_id', sortedIds[1])
        .limit(1);

      const isFriendOrPaired = (friendship && friendship.length > 0) || (pairing && pairing.length > 0);
      if (!isFriendOrPaired) {
        return { conversation: null, error: 'You must be friends to message this person' };
      }

      // Get all conversations where user1 is a participant
      const { data: user1Conversations, error: user1Error } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId1);

      if (user1Error) throw user1Error;

      if (!user1Conversations || user1Conversations.length === 0) {
        // No conversations for user1, create new one
        return await this.createNewConversation(userId1, userId2);
      }

      const conversationIds = user1Conversations.map(c => c.conversation_id);

      // Check if any of these conversations also has userId2 and is a direct conversation
      const { data: user2Conversations, error: user2Error } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .in('conversation_id', conversationIds)
        .eq('user_id', userId2);

      if (user2Error) throw user2Error;

      // Find conversation that both users participate in and is direct type
      if (user2Conversations && user2Conversations.length > 0) {
        for (const participant of user2Conversations) {
          const { data: conv } = await supabase
            .from('conversations')
            .select('id, type')
            .eq('id', participant.conversation_id)
            .eq('type', 'direct')
            .single();

          if (conv) {
            const conversation = await this.getConversation(conv.id, userId1);
            return conversation;
          }
        }
      }

      // No existing direct conversation found, create new one
      return await this.createNewConversation(userId1, userId2);
    } catch (error: any) {
      console.error('Error getting or creating conversation:', error);
      return { conversation: null, error: error.message };
    }
  }

  /**
   * Create a new conversation between two users
   */
  private async createNewConversation(userId1: string, userId2: string): Promise<{ conversation: Conversation | null; error: string | null }> {
    try {
      const { data: newConversation, error: createError } = await supabase
        .from('conversations')
        .insert({
          type: 'direct',
          created_by: userId1,
        })
        .select()
        .single();

      if (createError) throw createError;

      // Add both participants
      const { error: participantError } = await supabase
        .from('conversation_participants')
        .insert([
          { conversation_id: newConversation.id, user_id: userId1 },
          { conversation_id: newConversation.id, user_id: userId2 },
        ]);

      if (participantError) throw participantError;

      const conversation = await this.getConversation(newConversation.id, userId1);
      return conversation;
    } catch (error: any) {
      console.error('Error creating conversation:', error);
      return { conversation: null, error: error.message };
    }
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(conversationId: string, userId: string): Promise<{ conversation: Conversation | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          participants:conversation_participants(*),
          messages:messages(*)
        `)
        .eq('id', conversationId)
        .single();

      if (error) throw error;

      if (!data) {
        return { conversation: null, error: 'Conversation not found' };
      }

      // Get last message
      const { data: lastMessageData } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Get unread count - messages not sent by user and not read by user
      const { data: unreadMessages } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId)
        .is('deleted_at', null);

      let unreadCount = 0;
      if (unreadMessages && unreadMessages.length > 0) {
        const messageIds = unreadMessages.map(m => m.id);
        const { data: readMessages } = await supabase
          .from('message_reads')
          .select('message_id')
          .in('message_id', messageIds)
          .eq('user_id', userId);

        const readMessageIds = new Set(readMessages?.map(r => r.message_id) || []);
        unreadCount = messageIds.filter(id => !readMessageIds.has(id)).length;
      }

      const conversation: Conversation = {
        ...data,
        last_message: lastMessageData ? await this.enrichMessage(lastMessageData, userId) : undefined,
        unread_count: unreadCount,
      };

      return { conversation, error: null };
    } catch (error: any) {
      console.error('Error getting conversation:', error);
      return { conversation: null, error: error.message };
    }
  }

  /**
   * Get all conversations for a user
   */
  async getConversations(userId: string): Promise<{ conversations: Conversation[]; error: string | null }> {
    try {
      // Get conversation IDs where user is a participant
      const { data: participantData, error: participantError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId);

      if (participantError) throw participantError;

      if (!participantData || participantData.length === 0) {
        return { conversations: [], error: null };
      }

      const conversationIds = participantData.map(p => p.conversation_id);

      // Get conversations with participants and last message
      const { data: conversationsData, error: conversationsError } = await supabase
        .from('conversations')
        .select(`
          *,
          participants:conversation_participants(*)
        `)
        .in('id', conversationIds)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (conversationsError) throw conversationsError;

      // Get last messages for each conversation
      const conversations: Conversation[] = [];
      for (const conv of conversationsData || []) {
        const { data: lastMessage } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        // Get unread count
        const { data: unreadMessages } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conv.id)
          .neq('sender_id', userId)
          .is('deleted_at', null);

        let unreadCount = 0;
        if (unreadMessages && unreadMessages.length > 0) {
          const messageIds = unreadMessages.map(m => m.id);
          const { data: readMessages } = await supabase
            .from('message_reads')
            .select('message_id')
            .in('message_id', messageIds)
            .eq('user_id', userId);

          const readMessageIds = new Set(readMessages?.map(r => r.message_id) || []);
          unreadCount = messageIds.filter(id => !readMessageIds.has(id)).length;
        }

        const enrichedMessage = lastMessage ? await this.enrichMessage(lastMessage, userId) : undefined;

        conversations.push({
          ...conv,
          last_message: enrichedMessage,
          unread_count: unreadCount,
        });
      }

      return { conversations, error: null };
    } catch (error: any) {
      console.error('Error getting conversations:', error);
      return { conversations: [], error: error.message };
    }
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId: string, userId: string, limit: number = 50): Promise<{ messages: DirectMessage[]; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      // Enrich messages with sender names and read status
      const enrichedMessages = await Promise.all(
        (data || []).map(msg => this.enrichMessage(msg, userId))
      );

      return { messages: enrichedMessages.reverse(), error: null };
    } catch (error: any) {
      console.error('Error getting messages:', error);
      return { messages: [], error: error.message };
    }
  }

  /**
   * Send a message
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    content: string,
    messageType: 'text' | 'image' | 'video' | 'file' = 'text',
    fileUrl?: string,
    fileName?: string,
    fileSize?: number
  ): Promise<{ message: DirectMessage | null; error: string | null }> {
    try {
      // Note: Server-side RLS will also enforce block check, but this provides faster feedback
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          content,
          message_type: messageType,
          file_url: fileUrl,
          file_name: fileName,
          file_size: fileSize,
        })
        .select()
        .single();

      if (error) {
        // Check if error is due to blocking (RLS violation)
        if (error.code === '42501' || error.message?.includes('policy')) {
          return { message: null, error: 'Cannot send message to this user' };
        }
        throw error;
      }

      const enrichedMessage = await this.enrichMessage(data, senderId);
      
      // Send notifications to recipients (non-blocking)
      this.sendMessageNotifications(conversationId, senderId, enrichedMessage).catch(err => 
        console.error('Error sending notifications:', err)
      );
      
      return { message: enrichedMessage, error: null };
    } catch (error: any) {
      console.error('Error sending message:', error);
      return { message: null, error: error.message };
    }
  }

  /**
   * Mark messages as read
   */
  async markAsRead(messageIds: string[], userId: string): Promise<{ error: string | null }> {
    try {
      const reads = messageIds.map(messageId => ({
        message_id: messageId,
        user_id: userId,
      }));

      const { error } = await supabase
        .from('message_reads')
        .upsert(reads, { onConflict: 'message_id,user_id' });

      if (error) throw error;

      // Update last_read_at in conversation_participants
      if (messageIds.length > 0) {
        const { data: messages } = await supabase
          .from('messages')
          .select('conversation_id')
          .in('id', messageIds)
          .limit(1)
          .single();

        if (messages) {
          await supabase
            .from('conversation_participants')
            .update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', messages.conversation_id)
            .eq('user_id', userId);
        }
      }

      return { error: null };
    } catch (error: any) {
      console.error('Error marking as read:', error);
      return { error: error.message };
    }
  }

  /**
   * Subscribe to real-time messages for a conversation
   */
  subscribeToConversation(
    conversationId: string,
    userId: string,
    callbacks: {
      onMessage?: (message: DirectMessage) => void;
      onMessageUpdated?: (message: DirectMessage) => void;
      onMessageDeleted?: (messageId: string) => void;
    }
  ): RealtimeChannel {
    const channelName = `conversation:${conversationId}`;

    // Unsubscribe if already subscribed
    if (this.channels.has(channelName)) {
      this.unsubscribeFromConversation(conversationId);
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const enrichedMessage = await this.enrichMessageRealtime(payload.new as any);
          callbacks.onMessage?.(enrichedMessage);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const enrichedMessage = await this.enrichMessageRealtime(payload.new as any);
          callbacks.onMessageUpdated?.(enrichedMessage);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          callbacks.onMessageDeleted?.(payload.old.id);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to conversation: ${conversationId}`);
        }
      });

    this.channels.set(channelName, channel);
    return channel;
  }

  /**
   * Unsubscribe from conversation updates
   */
  unsubscribeFromConversation(conversationId: string): void {
    const channelName = `conversation:${conversationId}`;
    const channel = this.channels.get(channelName);
    if (channel) {
      supabase.removeChannel(channel);
      this.channels.delete(channelName);
    }
  }

  /**
   * Get sender name with caching to avoid N+1 queries
   */
  private async getSenderName(senderId: string | null): Promise<string> {
    if (!senderId) return 'Deleted User';

    const cached = this.senderProfileCache.get(senderId);
    if (cached && Date.now() - cached.cachedAt < MessagingService.PROFILE_CACHE_TTL) {
      return cached.name;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, username, first_name, last_name')
      .eq('id', senderId)
      .single();

    const senderName = getDisplayName(profile, 'Unknown');

    this.senderProfileCache.set(senderId, { name: senderName, cachedAt: Date.now() });
    return senderName;
  }

  /**
   * Enrich message with sender name and read status
   */
  private async enrichMessage(message: any, userId: string): Promise<DirectMessage> {
    const senderName = await this.getSenderName(message.sender_id);

    // Check if message is read by current user
    const { data: readData } = await supabase
      .from('message_reads')
      .select('id')
      .eq('message_id', message.id)
      .eq('user_id', userId)
      .single();

    return {
      ...message,
      sender_name: senderName,
      is_read: !!readData,
    };
  }

  /**
   * Lightweight enrichment for real-time messages — skips read-status query
   * (a message that just arrived is unread by definition)
   */
  private async enrichMessageRealtime(message: any): Promise<DirectMessage> {
    const senderName = await this.getSenderName(message.sender_id);

    return {
      ...message,
      sender_name: senderName,
      is_read: false,
    };
  }

  /**
   * Send notifications to message recipients via the notify-message → notify-dispatch
   * pipeline. This inserts a row into the `notifications` table (powering the in-app
   * notification center via Realtime) AND sends a push notification via OneSignal.
   *
   * Previously this called `send-message-email` which only sent a push — no DB row,
   * no in-app notification, no preference/quiet-hours checks.
   */
  private async sendMessageNotifications(
    conversationId: string,
    senderId: string,
    message: DirectMessage
  ): Promise<void> {
    try {
      // Get conversation participants (excluding sender)
      const { data: participants, error: participantsError } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', senderId);

      if (participantsError || !participants || participants.length === 0) {
        return;
      }

      // Prepare message preview
      let messagePreview = message.content;
      if (message.message_type === 'image') {
        messagePreview = '📷 Photo';
      } else if (message.message_type === 'video') {
        messagePreview = '🎥 Video';
      } else if (message.message_type === 'file') {
        messagePreview = `📄 ${message.file_name || 'Document'}`;
      } else if (messagePreview.length > 50) {
        messagePreview = messagePreview.substring(0, 50) + '...';
      }

      // Send notification to each recipient via the full pipeline.
      // notify-message → notify-dispatch handles:
      //   1. Insert into `notifications` table (in-app notification via Realtime)
      //   2. Push notification via OneSignal (with deepLink for tap-to-navigate)
      //   3. Notification preference checks + quiet hours
      //   4. Idempotency (2-min bucket prevents duplicate notifications)
      for (const participant of participants) {
        supabase.functions.invoke('notify-message', {
          body: {
            type: 'direct_message',
            senderId,
            conversationId,
            recipientId: participant.user_id,
            messagePreview,
          },
        }).catch((err) =>
          console.log('DM notification error (non-critical):', err)
        );
      }
    } catch (error) {
      console.error('Error sending message notifications:', error);
    }
  }

  /**
   * Toggle a reaction on a direct message (add if not exists, remove if exists).
   */
  async toggleDirectMessageReaction(
    messageId: string,
    userId: string,
    emoji: string
  ): Promise<{ added: boolean; error: any }> {
    try {
      const { data: existing } = await supabase
        .from('direct_message_reactions')
        .select('id')
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .eq('emoji', emoji)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('direct_message_reactions')
          .delete()
          .eq('id', existing.id);
        if (error) throw error;
        return { added: false, error: null };
      } else {
        const { error } = await supabase
          .from('direct_message_reactions')
          .insert({ message_id: messageId, user_id: userId, emoji });
        if (error) throw error;
        return { added: true, error: null };
      }
    } catch (err: any) {
      console.error('Error toggling DM reaction:', err);
      return { added: false, error: err };
    }
  }
}

export const messagingService = new MessagingService();

