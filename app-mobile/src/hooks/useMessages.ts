/**
 * @deprecated This hook is NOT used by any active component in the app.
 * ConnectionsPage uses messagingService directly for conversation loading.
 *
 * WARNING — DO NOT CALL THIS HOOK FROM ANY COMPONENT:
 * fetchMessages() runs 2 sequential Supabase queries per message (profile + read status)
 * inside a for loop — 60+ serial round-trips for a user with 3 conversations × 10 messages.
 * It has no timeout. Importing this hook will cause an unrecoverable performance regression
 * and an infinite spinner under any network latency.
 *
 * The Conversation and Message types exported here are used by ConnectionsPage.tsx and
 * ChatListItem.tsx — do NOT delete this file until those imports are migrated to a shared
 * types/messaging.ts file. See §S2 in FEATURE_CHAT_SPINNER_AND_POOL_STABILITY_SPEC.md.
 */
import { useState, useCallback } from 'react';
import { getDisplayName } from '../utils/getDisplayName';
import { supabase } from '../services/supabase';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content?: string;
  message_type: 'text' | 'image' | 'video' | 'file' | 'card';  // ORCH-0667: + 'video','card'
  file_url?: string;
  file_name?: string;
  file_size?: number;
  card_payload?: any;  // ORCH-0667: CardPayload — typed loosely to avoid circular import
  created_at: string;
  sender_name?: string;
  is_read: boolean;
}

export interface Conversation {
  id: string;
  created_by: string;
  created_at: string;
  participants: {
    id: string;
    username: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
    is_online?: boolean;
  }[];
  last_message?: Message;
  unread_count: number;
  messages: Message[];
}

export const useMessages = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Load conversations
  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get conversations where user is a participant
      // First, get conversation IDs where the user is a participant
      const { data: participantData, error: participantError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id);

      if (participantError) throw participantError;

      if (!participantData || participantData.length === 0) {
        setConversations([]);
        return;
      }

      const conversationIds = participantData.map(p => p.conversation_id);

      // Then get conversations with their messages
      const { data: conversationsData, error } = await supabase
        .from('conversations')
        .select(`
          *,
          participants:conversation_participants (
            user_id
          ),
          messages:messages (
            id,
            conversation_id,
            sender_id,
            content,
            message_type,
            file_url,
            file_name,
            file_size,
            created_at
          )
        `)
        .in('id', conversationIds)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      // Transform the data
      const transformedConversations: Conversation[] = [];
      
      for (const conv of conversationsData || []) {
        // Fetch profile data for participants
        const participants = [];
        for (const p of conv.participants || []) {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('id, username, display_name, first_name, last_name, avatar_url')
            .eq('id', p.user_id)
            .single();

          participants.push({
            id: p.user_id,
            username: profileData?.username || 'Unknown',
            display_name: getDisplayName(profileData),
            first_name: profileData?.first_name,
            last_name: profileData?.last_name,
            avatar_url: profileData?.avatar_url,
            is_online: false, // We'll implement online status later
          });
        }

        // Fetch profile data for message senders and read status
        const messages = [];
        for (const msg of conv.messages || []) {
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('username, display_name, first_name, last_name')
            .eq('id', msg.sender_id)
            .single();

          // Check if message has been read by current user
          const { data: readStatus } = await supabase
            .from('message_reads')
            .select('id')
            .eq('message_id', msg.id)
            .eq('user_id', user.id)
            .single();

          messages.push({
            id: msg.id,
            conversation_id: msg.conversation_id,
            sender_id: msg.sender_id,
            content: msg.content,
            message_type: msg.message_type,
            file_url: msg.file_url,
            file_name: msg.file_name,
            file_size: msg.file_size,
            created_at: msg.created_at,
            sender_name: getDisplayName(senderProfile, 'Unknown'),
            is_read: !!readStatus,
          });
        }

        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
        const unreadCount = messages.filter(msg => !msg.is_read && msg.sender_id !== user.id).length;

        transformedConversations.push({
          id: conv.id,
          created_by: conv.created_by,
          created_at: conv.created_at,
          participants,
          last_message: lastMessage,
          unread_count: unreadCount,
          messages,
        });
      }

      setConversations(transformedConversations);
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load messages for a specific conversation
  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: messagesData, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Transform messages with profile data and read status
      const transformedMessages: Message[] = [];
      for (const msg of messagesData || []) {
        const { data: senderProfile } = await supabase
          .from('profiles')
          .select('username, display_name, first_name, last_name')
          .eq('id', msg.sender_id)
          .single();

        // Check if message has been read by current user
        const { data: readStatus } = await supabase
          .from('message_reads')
          .select('id')
          .eq('message_id', msg.id)
          .eq('user_id', user.id)
          .single();

        transformedMessages.push({
          id: msg.id,
          conversation_id: msg.conversation_id,
          sender_id: msg.sender_id,
          content: msg.content,
          message_type: msg.message_type,
          file_url: msg.file_url,
          file_name: msg.file_name,
          file_size: msg.file_size,
          created_at: msg.created_at,
          sender_name: getDisplayName(senderProfile, 'Unknown'),
          is_read: !!readStatus,
        });
      }

      // Update the conversation with the loaded messages
      setConversations(prev => prev.map(conv => 
        conv.id === conversationId 
          ? { ...conv, messages: transformedMessages }
          : conv
      ));

      // Mark messages as read by inserting into message_reads table
      const { data: unreadMessages } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .neq('sender_id', user.id);

      if (unreadMessages && unreadMessages.length > 0) {
        const readRecords = unreadMessages.map(msg => ({
          message_id: msg.id,
          user_id: user.id,
        }));

        await supabase
          .from('message_reads')
          .upsert(readRecords, { onConflict: 'message_id,user_id' });
      }

    } catch (error) {
      console.error('Error loading messages:', error);
    }
  }, []);

  // Send message
  const sendMessage = useCallback(async (conversationId: string, content: string, messageType: 'text' | 'image' | 'file' = 'text', fileUrl?: string, fileName?: string, fileSize?: number) => {
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: messageData, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          content,
          message_type: messageType,
          file_url: fileUrl,
          file_name: fileName,
          file_size: fileSize,
        })
        .select('*')
        .single();

      if (error) throw error;

      // Get sender profile for the new message
      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('username, display_name, first_name, last_name')
        .eq('id', messageData.sender_id)
        .single();

      const newMessage: Message = {
        id: messageData.id,
        conversation_id: messageData.conversation_id,
        sender_id: messageData.sender_id,
        content: messageData.content,
        message_type: messageData.message_type,
        file_url: messageData.file_url,
        file_name: messageData.file_name,
        file_size: messageData.file_size,
        created_at: messageData.created_at,
        sender_name: getDisplayName(senderProfile, 'Unknown'),
        is_read: true, // Messages sent by the current user are considered read
      };

      // Update conversations with the new message
      setConversations(prev => prev.map(conv => 
        conv.id === conversationId 
          ? { 
              ...conv, 
              messages: [...conv.messages, newMessage],
              last_message: newMessage,
              updated_at: new Date().toISOString(),
            }
          : conv
      ));

      // Update current conversation if it's the same
      if (currentConversation?.id === conversationId) {
        setCurrentConversation(prev => prev ? {
          ...prev,
          messages: [...prev.messages, newMessage],
          last_message: newMessage,
        } : null);
      }

      return newMessage;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    } finally {
      setSending(false);
    }
  }, [currentConversation]);

  // Create new conversation
  const createConversation = useCallback(async (participantIds: string[]) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Create conversation
      const { data: conversationData, error: convError } = await supabase
        .from('conversations')
        .insert({
          created_by: user.id,
        })
        .select()
        .single();

      if (convError) throw convError;

      // Add participants
      const participants = [user.id, ...participantIds];
      const { error: participantsError } = await supabase
        .from('conversation_participants')
        .insert(participants.map(participantId => ({
          conversation_id: conversationData.id,
          user_id: participantId,
        })));

      if (participantsError) throw participantsError;

      // Reload conversations
      await fetchMessages();

      return conversationData.id;
    } catch (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }
  }, [fetchMessages]);

  return {
    conversations,
    currentConversation,
    loading,
    sending,
    fetchMessages,
    loadMessages,
    sendMessage,
    createConversation,
    setCurrentConversation,
  };
};
