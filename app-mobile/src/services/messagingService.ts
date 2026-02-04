import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { blockService } from './blockService';

export interface DirectMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
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
  created_by: string;
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
          const enrichedMessage = await this.enrichMessage(payload.new as any, userId);
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
          const enrichedMessage = await this.enrichMessage(payload.new as any, userId);
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
   * Enrich message with sender name and read status
   */
  private async enrichMessage(message: any, userId: string): Promise<DirectMessage> {
    // Get sender profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, username, first_name, last_name')
      .eq('id', message.sender_id)
      .single();

    const senderName = profile?.display_name || 
      (profile?.first_name && profile?.last_name ? `${profile.first_name} ${profile.last_name}` : profile?.username) ||
      'Unknown';

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
   * Send notifications (push and email) to message recipients
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

      // Get sender profile
      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('first_name, last_name, username, email')
        .eq('id', senderId)
        .single();

      const senderName = senderProfile?.first_name && senderProfile?.last_name
        ? `${senderProfile.first_name} ${senderProfile.last_name}`
        : senderProfile?.username || 'Someone';

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

      // Send notifications to each recipient
      for (const participant of participants) {
        const recipientId = participant.user_id;

        // Send push notification
        await this.sendPushNotification(recipientId, senderName, messagePreview, conversationId);

        // Send email notification
        await this.sendEmailNotification(recipientId, senderName, messagePreview, conversationId, senderProfile?.email);
      }
    } catch (error) {
      console.error('Error sending message notifications:', error);
    }
  }

  /**
   * Send push notification to recipient
   */
  private async sendPushNotification(
    recipientId: string,
    senderName: string,
    messagePreview: string,
    conversationId: string
  ): Promise<void> {
    try {
      // Import enhanced notification service dynamically to avoid circular dependencies
      const { enhancedNotificationService } = await import('./enhancedNotificationService');
      
      await enhancedNotificationService.sendPushNotification(recipientId, {
        type: 'session_message',
        title: `New message from ${senderName}`,
        body: messagePreview,
        data: {
          conversationId,
          messageType: 'direct_message',
        },
      });
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  }

  /**
   * Send email notification to recipient
   */
  private async sendEmailNotification(
    recipientId: string,
    senderName: string,
    messagePreview: string,
    conversationId: string,
    senderEmail?: string
  ): Promise<void> {
    try {
      // Get recipient email
      const { data: recipientProfile } = await supabase
        .from('profiles')
        .select('email, first_name')
        .eq('id', recipientId)
        .single();

      if (!recipientProfile?.email) {
        console.warn('No email found for recipient:', recipientId);
        return;
      }

      // Call Supabase Edge Function to send email
      // If Edge Function doesn't exist, this will fail gracefully
      const { error } = await supabase.functions.invoke('send-message-email', {
        body: {
          recipientEmail: recipientProfile.email,
          recipientName: recipientProfile.first_name || 'User',
          senderName,
          senderEmail: senderEmail || 'noreply@mingla.app',
          messagePreview,
          conversationId,
        },
      });

      if (error) {
        // Edge Function might not exist yet - log but don't fail
        console.log('Email notification via Edge Function not available:', error.message);
        // Fallback: Could use a database trigger or webhook here
      }
    } catch (error) {
      // Silently fail - email notifications are optional
      console.log('Email notification error (non-critical):', error);
    }
  }
}

export const messagingService = new MessagingService();

