import { useState, useCallback } from 'react';
import { supabase } from '../services/supabase';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content?: string;
  message_type: 'text' | 'image' | 'file';
  file_url?: string;
  file_name?: string;
  file_size?: number;
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
      const { data: conversationsData, error } = await supabase
        .from('conversations')
        .select(`
          *,
          participants:conversation_participants (
            user_id,
            user:user_id (
              id,
              username,
              display_name,
              first_name,
              last_name,
              avatar_url
            )
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
            created_at,
            is_read,
            sender:sender_id (
              username,
              display_name,
              first_name,
              last_name
            )
          )
        `)
        .contains('participants', [{ user_id: user.id }])
        .order('updated_at', { ascending: false });

      if (error) throw error;

      // Transform the data
      const transformedConversations: Conversation[] = conversationsData?.map(conv => {
        const participants = conv.participants?.map(p => ({
          id: p.user_id,
          username: p.user?.username || 'Unknown',
          display_name: p.user?.display_name,
          first_name: p.user?.first_name,
          last_name: p.user?.last_name,
          avatar_url: p.user?.avatar_url,
          is_online: false, // We'll implement online status later
        })) || [];

        const messages = conv.messages?.map(msg => ({
          id: msg.id,
          conversation_id: msg.conversation_id,
          sender_id: msg.sender_id,
          content: msg.content,
          message_type: msg.message_type,
          file_url: msg.file_url,
          file_name: msg.file_name,
          file_size: msg.file_size,
          created_at: msg.created_at,
          sender_name: msg.sender?.display_name || msg.sender?.username || 'Unknown',
          is_read: msg.is_read,
        })) || [];

        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
        const unreadCount = messages.filter(msg => !msg.is_read && msg.sender_id !== user.id).length;

        return {
          id: conv.id,
          created_by: conv.created_by,
          created_at: conv.created_at,
          participants,
          last_message: lastMessage,
          unread_count: unreadCount,
          messages,
        };
      }) || [];

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
        .select(`
          *,
          sender:sender_id (
            username,
            display_name,
            first_name,
            last_name
          )
        `)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const transformedMessages: Message[] = messagesData?.map(msg => ({
        id: msg.id,
        conversation_id: msg.conversation_id,
        sender_id: msg.sender_id,
        content: msg.content,
        message_type: msg.message_type,
        file_url: msg.file_url,
        file_name: msg.file_name,
        file_size: msg.file_size,
        created_at: msg.created_at,
        sender_name: msg.sender?.display_name || msg.sender?.username || 'Unknown',
        is_read: msg.is_read,
      })) || [];

      // Update the conversation with the loaded messages
      setConversations(prev => prev.map(conv => 
        conv.id === conversationId 
          ? { ...conv, messages: transformedMessages }
          : conv
      ));

      // Mark messages as read
      await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('conversation_id', conversationId)
        .eq('sender_id', '!=', user.id)
        .eq('is_read', false);

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
          is_read: false,
        })
        .select(`
          *,
          sender:sender_id (
            username,
            display_name,
            first_name,
            last_name
          )
        `)
        .single();

      if (error) throw error;

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
        sender_name: messageData.sender?.display_name || messageData.sender?.username || 'Unknown',
        is_read: messageData.is_read,
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
