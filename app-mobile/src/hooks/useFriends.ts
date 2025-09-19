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

      // Get friends with profile information
      const { data: friendsData, error } = await supabase
        .from('friends')
        .select(`
          *,
          friend:friend_user_id (
            id,
            username,
            display_name,
            first_name,
            last_name,
            avatar_url
          )
        `)
        .eq('user_id', user.id)
        .eq('status', 'accepted');

      if (error) throw error;

      // Transform the data to match our interface
      const transformedFriends: Friend[] = friendsData?.map(friend => ({
        id: friend.id,
        user_id: friend.user_id,
        friend_user_id: friend.friend_user_id,
        username: friend.friend?.username || 'Unknown',
        display_name: friend.friend?.display_name,
        first_name: friend.friend?.first_name,
        last_name: friend.friend?.last_name,
        avatar_url: friend.friend?.avatar_url,
        status: friend.status,
        created_at: friend.created_at,
      })) || [];

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
        .select(`
          *,
          sender:sender_id (
            id,
            username,
            display_name,
            first_name,
            last_name,
            avatar_url
          )
        `)
        .eq('receiver_id', user.id)
        .eq('status', 'pending');

      if (incomingError) throw incomingError;

      // Get outgoing friend requests
      const { data: outgoingRequests, error: outgoingError } = await supabase
        .from('friend_requests')
        .select(`
          *,
          receiver:receiver_id (
            id,
            username,
            display_name,
            first_name,
            last_name,
            avatar_url
          )
        `)
        .eq('sender_id', user.id)
        .eq('status', 'pending');

      if (outgoingError) throw outgoingError;

      // Transform the data
      const transformedRequests: FriendRequest[] = [
        ...(incomingRequests?.map(req => ({
          id: req.id,
          sender_id: req.sender_id,
          receiver_id: req.receiver_id,
          sender: {
            username: req.sender?.username || 'Unknown',
            display_name: req.sender?.display_name,
            first_name: req.sender?.first_name,
            last_name: req.sender?.last_name,
            avatar_url: req.sender?.avatar_url,
          },
          status: req.status,
          created_at: req.created_at,
          type: 'incoming' as const,
        })) || []),
        ...(outgoingRequests?.map(req => ({
          id: req.id,
          sender_id: req.sender_id,
          receiver_id: req.receiver_id,
          sender: {
            username: req.receiver?.username || 'Unknown',
            display_name: req.receiver?.display_name,
            first_name: req.receiver?.first_name,
            last_name: req.receiver?.last_name,
            avatar_url: req.receiver?.avatar_url,
          },
          status: req.status,
          created_at: req.created_at,
          type: 'outgoing' as const,
        })) || []),
      ];

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
