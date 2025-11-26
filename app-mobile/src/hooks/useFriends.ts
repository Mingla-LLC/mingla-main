import { useState, useCallback } from 'react';
import { supabase } from '../services/supabase';

export interface Friend {
  id: string;
  user_id: string;
  friend_user_id: string;
  username: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  status: 'accepted' | 'pending' | 'blocked';
  created_at: string;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  sender: {
    username: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  created_at: string;
  type?: 'incoming' | 'outgoing';
}

export const useFriends = () => {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(false);

  // Load friends
  const fetchFriends = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get friends
      const { data: friendsData, error } = await supabase
        .from('friends')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'accepted');

      if (error) throw error;

      // Get profile information for each friend
      const transformedFriends: Friend[] = [];
      for (const friend of friendsData || []) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, username, first_name, last_name, avatar_url')
          .eq('id', friend.friend_user_id)
          .single();

        // If profile doesn't exist, create a basic one
        if (profileError && profileError.code === 'PGRST116') {
          
          // Create a basic profile for this user
          const { data: newProfile, error: createError } = await supabase
            .from('profiles')
            .insert({
              id: friend.friend_user_id,
              username: `user_${friend.friend_user_id.substring(0, 8)}`,
            })
            .select('id, username, first_name, last_name, avatar_url')
            .single();

          if (createError) {
            console.error('Error creating profile:', createError);
            // Use fallback data
            transformedFriends.push({
              id: friend.id,
              user_id: friend.user_id,
              friend_user_id: friend.friend_user_id,
              username: `user_${friend.friend_user_id.substring(0, 8)}`,
              display_name: null,
              first_name: null,
              last_name: null,
              avatar_url: null,
              status: friend.status,
              created_at: friend.created_at,
            });
          } else {
            transformedFriends.push({
              id: friend.id,
              user_id: friend.user_id,
              friend_user_id: friend.friend_user_id,
              username: newProfile?.username || 'Unknown',
              display_name: newProfile?.first_name && newProfile?.last_name 
                ? `${newProfile.first_name} ${newProfile.last_name}` 
                : newProfile?.username,
              first_name: newProfile?.first_name,
              last_name: newProfile?.last_name,
              avatar_url: newProfile?.avatar_url,
              status: friend.status,
              created_at: friend.created_at,
            });
          }
        } else if (profileError) {
          console.error('Error fetching profile:', profileError);
          // Use fallback data
          transformedFriends.push({
            id: friend.id,
            user_id: friend.user_id,
            friend_user_id: friend.friend_user_id,
            username: `user_${friend.friend_user_id.substring(0, 8)}`,
            display_name: null,
            first_name: null,
            last_name: null,
            avatar_url: null,
            status: friend.status,
            created_at: friend.created_at,
          });
        } else {
          transformedFriends.push({
            id: friend.id,
            user_id: friend.user_id,
            friend_user_id: friend.friend_user_id,
            username: profileData?.username || 'Unknown',
            display_name: profileData?.first_name && profileData?.last_name 
              ? `${profileData.first_name} ${profileData.last_name}` 
              : profileData?.username,
            first_name: profileData?.first_name,
            last_name: profileData?.last_name,
            avatar_url: profileData?.avatar_url,
            status: friend.status,
            created_at: friend.created_at,
          });
        }
      }

      setFriends(transformedFriends);
    } catch (error) {
      console.error('Error loading friends:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load friend requests
  const loadFriendRequests = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get incoming friend requests
      const { data: incomingRequests, error: incomingError } = await supabase
        .from('friend_requests')
        .select('*')
        .eq('receiver_id', user.id)
        .eq('status', 'pending');

      if (incomingError) throw incomingError;

      // Get outgoing friend requests
      const { data: outgoingRequests, error: outgoingError } = await supabase
        .from('friend_requests')
        .select('*')
        .eq('sender_id', user.id)
        .eq('status', 'pending');

      if (outgoingError) throw outgoingError;

      // Transform the data
      const transformedRequests: FriendRequest[] = [];

      // Process incoming requests
      for (const request of incomingRequests || []) {
        const { data: senderProfile, error: senderError } = await supabase
          .from('profiles')
          .select('id, username, first_name, last_name, avatar_url')
          .eq('id', request.sender_id)
          .single();

        // If profile doesn't exist, create a basic one
        if (senderError && senderError.code === 'PGRST116') {
          const { data: newProfile } = await supabase
            .from('profiles')
            .insert({
              id: request.sender_id,
              username: `user_${request.sender_id.substring(0, 8)}`,
            })
            .select('id, username, first_name, last_name, avatar_url')
            .single();

          transformedRequests.push({
            id: request.id,
            sender_id: request.sender_id,
            receiver_id: request.receiver_id,
            sender: {
              username: newProfile?.username || `user_${request.sender_id.substring(0, 8)}`,
              display_name: newProfile?.first_name && newProfile?.last_name 
                ? `${newProfile.first_name} ${newProfile.last_name}` 
                : newProfile?.username,
              first_name: newProfile?.first_name,
              last_name: newProfile?.last_name,
              avatar_url: newProfile?.avatar_url,
            },
            status: request.status,
            created_at: request.created_at,
            type: 'incoming' as const,
          });
        } else {
          transformedRequests.push({
            id: request.id,
            sender_id: request.sender_id,
            receiver_id: request.receiver_id,
            sender: {
              username: senderProfile?.username || `user_${request.sender_id.substring(0, 8)}`,
              display_name: senderProfile?.first_name && senderProfile?.last_name 
                ? `${senderProfile.first_name} ${senderProfile.last_name}` 
                : senderProfile?.username,
              first_name: senderProfile?.first_name,
              last_name: senderProfile?.last_name,
              avatar_url: senderProfile?.avatar_url,
            },
            status: request.status,
            created_at: request.created_at,
            type: 'incoming' as const,
          });
        }
      }

      // Process outgoing requests
      for (const request of outgoingRequests || []) {
        const { data: receiverProfile, error: receiverError } = await supabase
          .from('profiles')
          .select('id, username, first_name, last_name, avatar_url')
          .eq('id', request.receiver_id)
          .single();

        // If profile doesn't exist, create a basic one
        if (receiverError && receiverError.code === 'PGRST116') {
          const { data: newProfile } = await supabase
            .from('profiles')
            .insert({
              id: request.receiver_id,
              username: `user_${request.receiver_id.substring(0, 8)}`,
            })
            .select('id, username, first_name, last_name, avatar_url')
            .single();

          transformedRequests.push({
            id: request.id,
            sender_id: request.sender_id,
            receiver_id: request.receiver_id,
            sender: {
              username: newProfile?.username || `user_${request.receiver_id.substring(0, 8)}`,
              display_name: newProfile?.first_name && newProfile?.last_name 
                ? `${newProfile.first_name} ${newProfile.last_name}` 
                : newProfile?.username,
              first_name: newProfile?.first_name,
              last_name: newProfile?.last_name,
              avatar_url: newProfile?.avatar_url,
            },
            status: request.status,
            created_at: request.created_at,
            type: 'outgoing' as const,
          });
        } else {
          transformedRequests.push({
            id: request.id,
            sender_id: request.sender_id,
            receiver_id: request.receiver_id,
            sender: {
              username: receiverProfile?.username || `user_${request.receiver_id.substring(0, 8)}`,
              display_name: receiverProfile?.first_name && receiverProfile?.last_name 
                ? `${receiverProfile.first_name} ${receiverProfile.last_name}` 
                : receiverProfile?.username,
              first_name: receiverProfile?.first_name,
              last_name: receiverProfile?.last_name,
              avatar_url: receiverProfile?.avatar_url,
            },
            status: request.status,
            created_at: request.created_at,
            type: 'outgoing' as const,
          });
        }
      }

      setFriendRequests(transformedRequests);
    } catch (error) {
      console.error('Error loading friend requests:', error);
    }
  }, []);

  // Send friend request
  const addFriend = useCallback(async (friendUserId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('friend_requests')
        .insert({
          sender_id: user.id,
          receiver_id: friendUserId,
          status: 'pending',
        });

      if (error) throw error;

      // Reload friend requests
      await loadFriendRequests();
    } catch (error) {
      console.error('Error sending friend request:', error);
      throw error;
    }
  }, [loadFriendRequests]);

  // Accept friend request
  const acceptFriendRequest = useCallback(async (requestId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get the friend request
      const { data: request, error: fetchError } = await supabase
        .from('friend_requests')
        .select('*')
        .eq('id', requestId)
        .single();

      if (fetchError) throw fetchError;

      // Update the request status
      const { error: updateError } = await supabase
        .from('friend_requests')
        .update({ status: 'accepted' })
        .eq('id', requestId);

      if (updateError) throw updateError;

      // Create friendship records for both users
      const { error: friend1Error } = await supabase
        .from('friends')
        .insert({
          user_id: request.sender_id,
          friend_user_id: request.receiver_id,
          status: 'accepted',
        });

      if (friend1Error) throw friend1Error;

      const { error: friend2Error } = await supabase
        .from('friends')
        .insert({
          user_id: request.receiver_id,
          friend_user_id: request.sender_id,
          status: 'accepted',
        });

      if (friend2Error) throw friend2Error;

      // Reload data
      await Promise.all([fetchFriends(), loadFriendRequests()]);
    } catch (error) {
      console.error('Error accepting friend request:', error);
      throw error;
    }
  }, [fetchFriends, loadFriendRequests]);

  // Decline friend request
  const declineFriendRequest = useCallback(async (requestId: string) => {
    try {
      const { error } = await supabase
        .from('friend_requests')
        .update({ status: 'declined' })
        .eq('id', requestId);

      if (error) throw error;

      // Reload friend requests
      await loadFriendRequests();
    } catch (error) {
      console.error('Error declining friend request:', error);
      throw error;
    }
  }, [loadFriendRequests]);

  // Remove friend
  const removeFriend = useCallback(async (friendUserId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Remove friendship from both sides
      const { error: error1 } = await supabase
        .from('friends')
        .delete()
        .eq('user_id', user.id)
        .eq('friend_user_id', friendUserId);

      if (error1) throw error1;

      const { error: error2 } = await supabase
        .from('friends')
        .delete()
        .eq('user_id', friendUserId)
        .eq('friend_user_id', user.id);

      if (error2) throw error2;

      // Reload friends
      await fetchFriends();
    } catch (error) {
      console.error('Error removing friend:', error);
      throw error;
    }
  }, [fetchFriends]);

  // Cancel friend request
  const cancelFriendRequest = useCallback(async (requestId: string) => {
    try {
      const { error } = await supabase
        .from('friend_requests')
        .update({ status: 'cancelled' })
        .eq('id', requestId);

      if (error) throw error;

      // Reload friend requests
      await loadFriendRequests();
    } catch (error) {
      console.error('Error cancelling friend request:', error);
      throw error;
    }
  }, [loadFriendRequests]);

  return {
    friends,
    friendRequests,
    loading,
    fetchFriends,
    loadFriendRequests,
    addFriend,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    cancelFriendRequest,
  };
};
