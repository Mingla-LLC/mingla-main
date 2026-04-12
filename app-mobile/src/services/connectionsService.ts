import { supabase } from './supabase';
import { getDisplayName } from '../utils/getDisplayName';

export interface Friend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  avatar_url?: string;
  status?: string;
  isOnline: boolean;
  lastSeen?: string;
  mutualFriends?: number;
  isMuted?: boolean;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'file';
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
  isMe: boolean;
  unread?: boolean;
  failed?: boolean;
  isRead?: boolean;
}

export interface Conversation {
  id: string;
  name: string;
  type: 'direct' | 'group';
  participants: Friend[];
  lastMessage: Message;
  unreadCount: number;
  avatar?: string;
  isOnline?: boolean;
}

export const ConnectionsService = {
  /**
   * Get user's friends list
   */
  async getFriends(userId: string): Promise<Friend[]> {
    try {
      // Check if friends table exists and has the expected columns
      const { data: friendships, error: friendsError } = await supabase
        .from('friends')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'accepted');

      if (friendsError) {
        console.error('Error fetching friendships:', friendsError);
        return [];
      }

      if (!friendships || friendships.length === 0) {
        return [];
      }


      // Try to extract friend IDs from the data
      // The column might be named differently (e.g., 'friend_id', 'friend_user_id', etc.)
      let friendIds: string[] = [];
      
      if (friendships[0].friend_id) {
        friendIds = friendships.map(f => f.friend_id);
      } else if (friendships[0].friend_user_id) {
        friendIds = friendships.map(f => f.friend_user_id);
      } else {
        return [];
      }

      if (friendIds.length === 0) {
        return [];
      }

      // Then get the profile information for those friends
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, display_name, username, first_name, last_name')
        .in('id', friendIds);

      if (profilesError) {
        console.error('Error fetching friend profiles:', profilesError);
        return [];
      }

      return profiles?.map((profile: any) => ({
        id: profile.id,
        name: getDisplayName(profile, 'Unknown'),
        username: profile.username || 'unknown',
        avatar: undefined, // No profile_image column exists
        status: 'offline' as const, // Default status
        isOnline: false, // Default to offline
        mutualFriends: 0 // Default value
      })) || [];
    } catch (error) {
      console.error('Failed to fetch friends:', error);
      return [];
    }
  },

  /**
   * Get user's conversations
   */
  async getConversations(userId: string): Promise<Conversation[]> {
    try {
      // For now, return empty array since conversations table might not exist
      // This is a simplified implementation
      return [];
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
      return [];
    }
  },

  /**
   * Get messages for a specific conversation
   */
  async getMessages(conversationId: string, userId: string): Promise<Message[]> {
    try {
      // For now, return empty array since messages table might not exist
      // This is a simplified implementation
      return [];
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      return [];
    }
  },

  /**
   * Send a message
   */
  async sendMessage(conversationId: string, senderId: string, content: string, type: string = 'text'): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          content,
          type
        });

      if (error) {
        console.error('Error sending message:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  },

  /**
   * Get friend requests (received)
   */
  async getFriendRequests(userId: string): Promise<any[]> {
    try {
      // Check if friends table exists and has the expected columns
      const { data: requests, error: requestsError } = await supabase
        .from('friends')
        .select('*')
        .eq('status', 'pending');

      if (requestsError) {
        console.error('Error fetching friend requests:', requestsError);
        return [];
      }

      if (!requests || requests.length === 0) {
        return [];
      }


      // Try to find requests where the user is the recipient
      // The column might be named differently (e.g., 'friend_id', 'friend_user_id', etc.)
      let userRequests: any[] = [];
      
      if (requests[0].friend_id) {
        userRequests = requests.filter(r => r.friend_id === userId);
      } else if (requests[0].friend_user_id) {
        userRequests = requests.filter(r => r.friend_user_id === userId);
      } else {
        return [];
      }

      if (userRequests.length === 0) {
        return [];
      }

      // Then get the profile information for those users
      const userIds = userRequests.map(r => r.user_id);
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, display_name, username, first_name, last_name')
        .in('id', userIds);

      if (profilesError) {
        console.error('Error fetching requester profiles:', profilesError);
        return [];
      }

      // Combine the data
      return userRequests.map((request: any) => {
        const profile = profiles?.find(p => p.id === request.user_id);
        return {
          id: request.id,
          name: getDisplayName(profile, 'Unknown'),
          username: profile?.username || 'unknown',
          avatar: undefined, // No profile_image column exists
          mutualFriends: 0, // Default value
          requestedAt: request.created_at
        };
      });
    } catch (error) {
      console.error('Failed to fetch friend requests:', error);
      return [];
    }
  },
};
