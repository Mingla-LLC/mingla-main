import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface Friend {
  id: string;
  user_id: string;
  friend_user_id: string;
  username: string;
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
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  created_at: string;
}

export const useFriends = () => {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(false);

  // Load friends
  const loadFriends = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get friends with profile information
      const { data: friendsData, error } = await supabase
        .from('friends')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'accepted');

      if (error) {
        console.error('Error loading friends:', error);
        return;
      }

      const formattedFriends: Friend[] = [];
      
      for (const f of friendsData || []) {
        // Get friend's profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, first_name, last_name')
          .eq('id', f.friend_user_id)
          .single();

        formattedFriends.push({
          id: f.id,
          user_id: f.user_id,
          friend_user_id: f.friend_user_id,
          username: profile?.username || 'Unknown',
          first_name: profile?.first_name,
          last_name: profile?.last_name,
          avatar_url: undefined,
          status: f.status as 'accepted' | 'pending' | 'blocked',
          created_at: f.created_at,
        });
      }

      setFriends(formattedFriends);
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
      const { data: requestsData, error } = await supabase
        .from('friend_requests')
        .select('*')
        .eq('receiver_id', user.id)
        .eq('status', 'pending');

      if (error) {
        console.error('Error loading friend requests:', error);
        return;
      }

      const formattedRequests: FriendRequest[] = [];
      
      for (const r of requestsData || []) {
        // Get sender's profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, first_name, last_name')
          .eq('id', r.sender_id)
          .single();

        formattedRequests.push({
          id: r.id,
          sender_id: r.sender_id,
          receiver_id: r.receiver_id,
          sender: {
            username: profile?.username || 'Unknown',
            first_name: profile?.first_name,
            last_name: profile?.last_name,
            avatar_url: undefined,
          },
          status: r.status as 'pending' | 'accepted' | 'declined' | 'cancelled',
          created_at: r.created_at,
        });
      }

      setFriendRequests(formattedRequests);
    } catch (error) {
      console.error('Error loading friend requests:', error);
    }
  }, []);

  // Send friend request
  const sendFriendRequest = useCallback(async (usernameOrEmail: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: "Authentication required",
          description: "You must be logged in to send friend requests",
          variant: "destructive"
        });
        return false;
      }

      // Find user by username
      const { data: targetUser, error: userError } = await supabase
        .from('profiles')
        .select('id, username')
        .eq('username', usernameOrEmail.trim())
        .maybeSingle();

      if (userError || !targetUser) {
        toast({
          title: "User not found",
          description: "No user found with that username",
          variant: "destructive"
        });
        return false;
      }

      if (targetUser.id === user.id) {
        toast({
          title: "Invalid request",
          description: "You cannot send a friend request to yourself",
          variant: "destructive"
        });
        return false;
      }

      // Check if already friends
      const { data: existingFriend } = await supabase
        .from('friends')
        .select('id')
        .eq('user_id', user.id)
        .eq('friend_user_id', targetUser.id)
        .maybeSingle();

      if (existingFriend) {
        toast({
          title: "Already friends",
          description: "You are already friends with this user",
          variant: "destructive"
        });
        return false;
      }

      // Check if request already exists
      const { data: existingRequest } = await supabase
        .from('friend_requests')
        .select('id, status')
        .eq('sender_id', user.id)
        .eq('receiver_id', targetUser.id)
        .maybeSingle();

      if (existingRequest) {
        if (existingRequest.status === 'pending') {
          toast({
            title: "Request already sent",
            description: "You have already sent a friend request to this user",
            variant: "destructive"
          });
          return false;
        }
        // If declined, allow new request by updating existing one
        const { error: updateError } = await supabase
          .from('friend_requests')
          .update({ status: 'pending' })
          .eq('id', existingRequest.id);

        if (updateError) throw updateError;
      } else {
        // Create new friend request
        const { error: insertError } = await supabase
          .from('friend_requests')
          .insert({
            sender_id: user.id,
            receiver_id: targetUser.id,
            status: 'pending'
          });

        if (insertError) throw insertError;
      }

      toast({
        title: "Friend request sent",
        description: `Friend request sent to @${targetUser.username}`,
      });
      return true;
    } catch (error) {
      console.error('Error sending friend request:', error);
      toast({
        title: "Error",
        description: "Failed to send friend request",
        variant: "destructive"
      });
      return false;
    }
  }, []);

  // Accept friend request
  const acceptFriendRequest = useCallback(async (requestId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // Get the request details
      const { data: request, error: requestError } = await supabase
        .from('friend_requests')
        .select('sender_id, receiver_id')
        .eq('id', requestId)
        .eq('receiver_id', user.id)
        .eq('status', 'pending')
        .single();

      if (requestError || !request) {
        toast({
          title: "Error",
          description: "Friend request not found",
          variant: "destructive"
        });
        return false;
      }

      // Create friendship (both directions)
      const { error: friendError } = await supabase
        .from('friends')
        .insert([
          {
            user_id: request.sender_id,
            friend_user_id: request.receiver_id,
            status: 'accepted'
          },
          {
            user_id: request.receiver_id,
            friend_user_id: request.sender_id,
            status: 'accepted'
          }
        ]);

      if (friendError) throw friendError;

      // Update request status
      const { error: updateError } = await supabase
        .from('friend_requests')
        .update({ status: 'accepted' })
        .eq('id', requestId);

      if (updateError) throw updateError;

      toast({
        title: "Friend request accepted",
        description: "You are now friends!",
      });

      // Reload data
      await Promise.all([loadFriends(), loadFriendRequests()]);
      return true;
    } catch (error) {
      console.error('Error accepting friend request:', error);
      toast({
        title: "Error",
        description: "Failed to accept friend request",
        variant: "destructive"
      });
      return false;
    }
  }, [loadFriends, loadFriendRequests]);

  // Decline friend request
  const declineFriendRequest = useCallback(async (requestId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { error } = await supabase
        .from('friend_requests')
        .update({ status: 'declined' })
        .eq('id', requestId)
        .eq('receiver_id', user.id);

      if (error) throw error;

      toast({
        title: "Friend request declined",
      });

      await loadFriendRequests();
      return true;
    } catch (error) {
      console.error('Error declining friend request:', error);
      toast({
        title: "Error",
        description: "Failed to decline friend request",
        variant: "destructive"
      });
      return false;
    }
  }, [loadFriendRequests]);

  // Remove friend
  const removeFriend = useCallback(async (friendUserId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // Remove both directions of friendship
      const { error } = await supabase
        .from('friends')
        .delete()
        .or(`and(user_id.eq.${user.id},friend_user_id.eq.${friendUserId}),and(user_id.eq.${friendUserId},friend_user_id.eq.${user.id})`);

      if (error) throw error;

      toast({
        title: "Friend removed",
        description: "Friend has been removed from your friends list",
      });

      await loadFriends();
      return true;
    } catch (error) {
      console.error('Error removing friend:', error);
      toast({
        title: "Error",
        description: "Failed to remove friend",
        variant: "destructive"
      });
      return false;
    }
  }, [loadFriends]);

  // Cancel friend request
  const cancelFriendRequest = useCallback(async (requestId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { error } = await supabase
        .from('friend_requests')
        .update({ status: 'cancelled' })
        .eq('id', requestId)
        .eq('sender_id', user.id);

      if (error) throw error;

      toast({
        title: "Friend request cancelled",
      });

      return true;
    } catch (error) {
      console.error('Error cancelling friend request:', error);
      toast({
        title: "Error",
        description: "Failed to cancel friend request",
        variant: "destructive"
      });
      return false;
    }
  }, []);

  // Set up real-time subscriptions
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;

      // Subscribe to friend requests
      const requestsChannel = supabase
        .channel('friend-requests-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'friend_requests',
            filter: `receiver_id=eq.${user.id}`
          },
          () => {
            loadFriendRequests();
          }
        )
        .subscribe();

      // Subscribe to friends changes
      const friendsChannel = supabase
        .channel('friends-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'friends',
            filter: `user_id=eq.${user.id}`
          },
          () => {
            loadFriends();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(requestsChannel);
        supabase.removeChannel(friendsChannel);
      };
    });
  }, [loadFriends, loadFriendRequests]);

  return {
    friends,
    friendRequests,
    loading,
    loadFriends,
    loadFriendRequests,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    cancelFriendRequest
  };
};