import { supabase } from './supabase';
import { getDisplayName } from '../utils/getDisplayName';
import type { CardTagEntry, MentionEntry } from './messagingService';
import type { BusinessEventCard } from '../types/mergedDiscover';

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
  conversationType?: 'direct' | 'group';
  sessionId?: string | null;
  eventId?: string | null;
  linkedEntityType?: 'direct' | 'session' | 'trip' | 'event' | null;
  sessionCreatorId?: string | null;
  eventBrandName?: string | null;
  eventBrandAccountId?: string | null;
  eventCoverMediaUrl?: string | null;
  eventPublicUrl?: string | null;
  eventPublicCard?: BusinessEventCard | null;
  isBroadcastOnly?: boolean;
  isSessionAdmin?: boolean;
  notificationsMuted?: boolean;
  participantCount?: number;
  participants?: {
    id: string;
    name?: string;
    username?: string;
    avatar_url?: string;
    is_online?: boolean;
  }[];
}

export interface Message {
  id: string;
  /** Issue #4114: messages.client_id — the merge key (with id) for every write. */
  clientId?: string;
  /** Issue #4114 Wave 6: messages.conversation_id (a brand channel merges several chats). */
  conversationId?: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'file' | 'card' | 'system';  // ORCH-0667: + 'card'; ORCH-1058B: + 'system'
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
  cardPayload?: any;  // ORCH-0667: CardPayload — typed loosely here to avoid circular import
  mentions?: Array<MentionEntry | string>;
  cardTags?: CardTagEntry[];
  isMe: boolean;
  unread?: boolean;
  failed?: boolean;
  isRead?: boolean;
  replyToId?: string;
  marketingCampaignId?: string | null;
  isSystem?: boolean;
  // ORCH-1058B: structured collab dead-end banner payload (chips + button data).
  // Typed loosely (CollabDeadEndBannerPayload) to avoid a circular import.
  systemPayload?: any;
  /** Issue #4114 Wave 3: direct_message_reactions rows (absent on realtime rows). */
  reactions?: Array<{ user_id: string; emoji: string }>;
  /** Issue #4114 Wave 3: unsent (soft-deleted); hidden from the thread. */
  unsent?: boolean;
  /** Issue #4114 Wave 4: a photo or video each recipient may open once. */
  viewOnce?: boolean;
  /** Issue #4114 Wave 4: the view-once file was deleted from storage. */
  viewOncePurged?: boolean;
  /** Issue #4114 Wave 4: who opened it (message_media_views; absent on realtime rows). */
  mediaViews?: Array<{ user_id: string; viewed_at: string }>;
  /**
   * Issue #4114 Wave 4: the picked file of a media send that has not uploaded
   * yet (this phone only; never persisted, never sent to the server). A retry
   * uploads it again under the same client id.
   */
  localMedia?: {
    uri: string;
    kind: 'image' | 'video' | 'file';
    mimeType?: string | null;
    fileName?: string | null;
    fileSize?: number | null;
    durationMs?: number | null;
    width?: number | null;
    height?: number | null;
  };
  /** Issue #4114 Wave 7: the 480px thumbnail's storage path (ordinary photos and videos). */
  thumbPath?: string;
  /** Issue #4114 Wave 7: a video's length and the media's size (the card's shape). */
  mediaDurationMs?: number;
  mediaWidth?: number;
  mediaHeight?: number;
  /** Issue #4114 Wave 7: photos sent together share this id. */
  mediaAlbumId?: string;
  /** Issue #4114 Wave 7 (D18): the video's full file was removed after 90 days. */
  mediaExpired?: boolean;
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
