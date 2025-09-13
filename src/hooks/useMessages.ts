import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

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
  sender?: {
    username: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
  is_read: boolean;
}

export interface Conversation {
  id: string;
  created_by: string;
  created_at: string;
  participants: {
    id: string;
    username: string;
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
  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get conversations where user is a participant
      const { data: userConversations, error } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id);

      if (error) {
        console.error('Error loading user conversations:', error);
        return;
      }

      const conversationIds = (userConversations || []).map(c => c.conversation_id);
      if (conversationIds.length === 0) return;

      // Get conversation details
      const { data: conversationsData, error: convError } = await supabase
        .from('conversations')
        .select('*')
        .in('id', conversationIds);

      if (convError) {
        console.error('Error loading conversations:', error);
        return;
      }

      const formattedConversations: Conversation[] = [];

      for (const conv of conversationsData || []) {
        // Get all participants except current user
        const { data: participantData, error: participantsError } = await supabase
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', conv.id)
          .neq('user_id', user.id);

        if (participantsError) continue;

        const participants = [];
        for (const p of participantData || []) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id, username, first_name, last_name')
            .eq('id', p.user_id)
            .single();

          if (profile) {
            participants.push({
              id: profile.id,
              username: profile.username,
              first_name: profile.first_name,
              last_name: profile.last_name,
              avatar_url: undefined,
              is_online: false, // TODO: Implement online status
            });
          }
        }

        // Get last message
        const { data: lastMessageData } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        let lastMessage: Message | undefined;
        if (lastMessageData) {
          // Get sender profile
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('username, first_name, last_name')
            .eq('id', lastMessageData.sender_id)
            .single();

          lastMessage = {
            id: lastMessageData.id,
            conversation_id: lastMessageData.conversation_id,
            sender_id: lastMessageData.sender_id,
            content: lastMessageData.content,
            message_type: lastMessageData.message_type as 'text' | 'image' | 'file',
            file_url: lastMessageData.file_url,
            file_name: lastMessageData.file_name,
            file_size: lastMessageData.file_size,
            created_at: lastMessageData.created_at,
            sender: {
              username: senderProfile?.username || 'Unknown',
              first_name: senderProfile?.first_name,
              last_name: senderProfile?.last_name,
              avatar_url: undefined,
            },
            is_read: false, // TODO: Calculate read status
          };
        }

        // Get unread count
        const { count: unreadCount } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .neq('sender_id', user.id)
          .not('id', 'in', `(
            SELECT message_id FROM message_reads WHERE user_id = '${user.id}'
          )`);

        formattedConversations.push({
          id: conv.id,
          created_by: conv.created_by,
          created_at: conv.created_at,
          participants,
          last_message: lastMessage,
          unread_count: unreadCount || 0,
          messages: [], // Will be loaded separately for the selected conversation
        });
      }

      setConversations(formattedConversations);
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load messages for a conversation
  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: messagesData, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error loading messages:', error);
        return;
      }

      const messages: Message[] = [];
      
      for (const msg of messagesData || []) {
        // Get sender profile
        const { data: senderProfile } = await supabase
          .from('profiles')
          .select('username, first_name, last_name')
          .eq('id', msg.sender_id)
          .single();

        // Check if message is read by current user
        const { data: readStatus } = await supabase
          .from('message_reads')
          .select('user_id')
          .eq('message_id', msg.id)
          .eq('user_id', user.id)
          .maybeSingle();

        messages.push({
          id: msg.id,
          conversation_id: msg.conversation_id,
          sender_id: msg.sender_id,
          content: msg.content,
          message_type: msg.message_type as 'text' | 'image' | 'file',
          file_url: msg.file_url,
          file_name: msg.file_name,
          file_size: msg.file_size,
          created_at: msg.created_at,
          sender: {
            username: senderProfile?.username || 'Unknown',
            first_name: senderProfile?.first_name,
            last_name: senderProfile?.last_name,
            avatar_url: undefined,
          },
          is_read: !!readStatus,
        });
      }

      // Update conversation with messages
      const updatedConversation = conversations.find(c => c.id === conversationId);
      if (updatedConversation) {
        const newConversation = { ...updatedConversation, messages };
        setCurrentConversation(newConversation);
        
        // Update conversations list
        setConversations(prev => prev.map(c => 
          c.id === conversationId ? newConversation : c
        ));
      }

      // Mark messages as read
      const unreadMessages = messages.filter(msg => 
        msg.sender_id !== user.id && !msg.is_read
      );
      
      if (unreadMessages.length > 0) {
        await markMessagesAsRead(unreadMessages.map(msg => msg.id));
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  }, [conversations]);

  // Send message
  const sendMessage = useCallback(async (conversationId: string, content: string, file?: File) => {
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      let fileUrl: string | undefined;
      let fileName: string | undefined;
      let fileSize: number | undefined;
      let messageType: 'text' | 'image' | 'file' = 'text';

      // Handle file upload
      if (file) {
        const fileExt = file.name.split('.').pop();
        const filePath = `${user.id}/${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('message-attachments')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('message-attachments')
          .getPublicUrl(filePath);

        fileUrl = publicUrl;
        fileName = file.name;
        fileSize = file.size;
        messageType = file.type.startsWith('image/') ? 'image' : 'file';
      }

      // Insert message
      const { data: messageData, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          content: content || null,
          message_type: messageType,
          file_url: fileUrl,
          file_name: fileName,
          file_size: fileSize,
        })
        .select()
        .single();

      if (error) throw error;

      // Reload messages for the conversation
      await loadMessages(conversationId);
      
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive"
      });
      return false;
    } finally {
      setSending(false);
    }
  }, [loadMessages]);

  // Create conversation
  const createConversation = useCallback(async (participantId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Check if conversation already exists between these two users
      const { data: userConversations } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id);

      const { data: participantConversations } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', participantId);

      if (userConversations && participantConversations) {
        const userConvIds = userConversations.map(c => c.conversation_id);
        const participantConvIds = participantConversations.map(c => c.conversation_id);
        
        const commonConversations = userConvIds.filter(id => participantConvIds.includes(id));
        
        if (commonConversations.length > 0) {
          // Load the existing conversation
          await loadMessages(commonConversations[0]);
          return commonConversations[0];
        }
      }

      // Create new conversation
      const { data: conversationData, error: convError } = await supabase
        .from('conversations')
        .insert({
          created_by: user.id,
        })
        .select()
        .single();

      if (convError) throw convError;

      // Add participants
      const { error: participantsError } = await supabase
        .from('conversation_participants')
        .insert([
          {
            conversation_id: conversationData.id,
            user_id: user.id,
          },
          {
            conversation_id: conversationData.id,
            user_id: participantId,
          }
        ]);

      if (participantsError) throw participantsError;

      // Reload conversations and load this conversation
      await loadConversations();
      await loadMessages(conversationData.id);
      
      return conversationData.id;
    } catch (error) {
      console.error('Error creating conversation:', error);
      toast({
        title: "Error",
        description: "Failed to create conversation",
        variant: "destructive"
      });
      return null;
    }
  }, [loadConversations, loadMessages]);

  // Mark messages as read
  const markMessagesAsRead = useCallback(async (messageIds: string[]) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const reads = messageIds.map(messageId => ({
        message_id: messageId,
        user_id: user.id,
      }));

      const { error } = await supabase
        .from('message_reads')
        .upsert(reads, { onConflict: 'message_id,user_id' });

      if (error) throw error;
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  }, []);

  // Set up real-time subscriptions
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;

      // Subscribe to new messages
      const messagesChannel = supabase
        .channel('messages-changes')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
          },
          (payload) => {
            // Reload conversations to update last message and unread counts
            loadConversations();
            
            // If viewing the conversation where the message was sent, reload messages
            if (currentConversation && payload.new.conversation_id === currentConversation.id) {
              loadMessages(currentConversation.id);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(messagesChannel);
      };
    });
  }, [loadConversations, loadMessages, currentConversation]);

  return {
    conversations,
    currentConversation,
    loading,
    sending,
    loadConversations,
    loadMessages,
    sendMessage,
    createConversation,
    setCurrentConversation,
    markMessagesAsRead,
  };
};