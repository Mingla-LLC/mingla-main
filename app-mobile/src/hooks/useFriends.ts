import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "../services/supabase";
import { blockService } from "../services/blockService";

export interface Friend {
  id: string;
  user_id: string;
  friend_user_id: string;
  username: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  status: "accepted" | "pending" | "blocked";
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
    email?: string;
  };
  status: "pending" | "accepted" | "declined" | "cancelled";
  created_at: string;
  type?: "incoming" | "outgoing";
}

export interface BlockedUser {
  id: string;
  name: string;
  username?: string;
  avatar_url?: string;
  blocked_at?: string;
}

export const useFriends = (options?: { autoFetchBlockedUsers?: boolean }) => {
  const { autoFetchBlockedUsers = true } = options || {};
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendCount, setFriendCount] = useState(0);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track previous values via refs to avoid stale closure issues in useCallback
  const prevBlockedUsersJson = useRef('[]');
  const prevFriendsJson = useRef('[]');
  const prevFriendRequestsJson = useRef('[]');
  const prevFriendCount = useRef(0);

  // Fetch blocked users from blocked_users table (new system)
  const fetchBlockedUsers = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // Not authenticated yet, skip silently

      const result = await blockService.getBlockedUsers();
      
      if (result.error) {
        console.error("Error fetching blocked users:", result.error);
        setBlockedUsers([]);
        return;
      }

      const list: BlockedUser[] = result.data.map((b: any) => ({
        id: b.blocked_id,
        name:
          b.profile
            ? [b.profile.first_name, b.profile.last_name].filter(Boolean).join(" ") ||
              b.profile.display_name ||
              b.profile.username ||
              "Unknown"
            : "Unknown",
        username: b.profile?.username,
        avatar_url: undefined, // Profile doesn't include avatar in current query
        blocked_at: b.created_at,
      }));
      const listJson = JSON.stringify(list);
      if (prevBlockedUsersJson.current !== listJson) {
        prevBlockedUsersJson.current = listJson;
        setBlockedUsers(list);
      }
    } catch (error) {
      console.error("Error fetching blocked users:", error);
      if (prevBlockedUsersJson.current !== '[]') {
        prevBlockedUsersJson.current = '[]';
        setBlockedUsers([]);
      }
    }
  }, []);

  // Fetch blocked users when hook is used (e.g. when Profile or Connections screen mounts)
  useEffect(() => {
    if (!autoFetchBlockedUsers) return;
    fetchBlockedUsers();
  }, [fetchBlockedUsers, autoFetchBlockedUsers]);

  // Load friends
  const fetchFriends = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Get friends from both sides in a single query using .or()
      const { data: allRawFriends, error: friendsError } = await supabase
        .from("friends")
        .select("*")
        .eq("status", "accepted")
        .or(`user_id.eq.${user.id},friend_user_id.eq.${user.id}`);

      if (friendsError) throw friendsError;

      // Normalize so friend_user_id always points to the OTHER user
      const allFriendsData = (allRawFriends || []).map((f: any) => {
        if (f.user_id === user.id) return f;
        // Reverse relationship — swap so friend_user_id = the other person
        return {
          ...f,
          user_id: f.friend_user_id,
          friend_user_id: f.user_id,
        };
      });

      // Remove duplicates based on friend_user_id
      const uniqueFriends = allFriendsData.reduce((acc: any[], friend: any) => {
        if (!acc.find((f: any) => f.friend_user_id === friend.friend_user_id)) {
          acc.push(friend);
        }
        return acc;
      }, []);

      // Set count immediately so UI updates fast
      if (prevFriendCount.current !== uniqueFriends.length) {
        prevFriendCount.current = uniqueFriends.length;
        setFriendCount(uniqueFriends.length);
      }

      const friendsData = uniqueFriends;

      // Batch-fetch all profiles in a single query instead of N+1
      const friendUserIds = friendsData.map((f: any) => f.friend_user_id);
      const { data: allProfiles, error: profilesError } = friendUserIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, username, first_name, last_name, avatar_url")
            .in("id", friendUserIds)
        : { data: [], error: null };

      if (profilesError) {
        console.error("Error fetching profiles:", profilesError);
      }

      // Build a lookup map for O(1) access
      const profilesMap = new Map(
        (allProfiles || []).map((p: any) => [p.id, p])
      );

      // Transform friends using the pre-fetched profiles
      const transformedFriends: Friend[] = friendsData.map((friend: any) => {
        const profileData = profilesMap.get(friend.friend_user_id);

        return {
          id: friend.id,
          user_id: friend.user_id,
          friend_user_id: friend.friend_user_id,
          username: profileData?.username || `user_${friend.friend_user_id.substring(0, 8)}`,
          display_name:
            profileData?.first_name && profileData?.last_name
              ? `${profileData.first_name} ${profileData.last_name}`
              : profileData?.username,
          first_name: profileData?.first_name,
          last_name: profileData?.last_name,
          avatar_url: profileData?.avatar_url,
          status: friend.status,
          created_at: friend.created_at,
        };
      });

      const friendsJson = JSON.stringify(transformedFriends);
      if (prevFriendsJson.current !== friendsJson) {
        prevFriendsJson.current = friendsJson;
        setFriends(transformedFriends);
      }
    } catch (err: any) {
      console.error("Error loading friends:", err);
      const errorMessage = err?.message?.includes('network') || err?.message?.includes('Network') || err?.code === 'NETWORK_ERROR'
        ? 'Unable to load friends. Please check your internet connection.'
        : 'Failed to load friends. Please try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load friend requests
  const loadFriendRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Get incoming friend requests
      const { data: incomingRequests, error: incomingError } = await supabase
        .from("friend_requests")
        .select("*")
        .eq("receiver_id", user.id)
        .eq("status", "pending");

      if (incomingError) throw incomingError;

      // Get outgoing friend requests
      const { data: outgoingRequests, error: outgoingError } = await supabase
        .from("friend_requests")
        .select("*")
        .eq("sender_id", user.id)
        .eq("status", "pending");

      if (outgoingError) throw outgoingError;

      // Transform the data
      const transformedRequests: FriendRequest[] = [];

      // Batch-fetch all sender profiles in one query
      const incomingSenderIds = (incomingRequests || []).map((r: any) => r.sender_id);
      const { data: senderProfiles } = incomingSenderIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, username, first_name, last_name, avatar_url, email")
            .in("id", incomingSenderIds)
        : { data: [] };

      const senderProfileMap = new Map(
        (senderProfiles || []).map((p: any) => [p.id, p])
      );

      // Process incoming requests using the pre-fetched profiles
      for (const request of incomingRequests || []) {
        const senderProfile = senderProfileMap.get(request.sender_id);
        transformedRequests.push({
          id: request.id,
          sender_id: request.sender_id,
          receiver_id: request.receiver_id,
          sender: {
            username:
              senderProfile?.username ||
              `user_${request.sender_id.substring(0, 8)}`,
            display_name:
              senderProfile?.first_name && senderProfile?.last_name
                ? `${senderProfile.first_name} ${senderProfile.last_name}`
                : senderProfile?.username,
            first_name: senderProfile?.first_name,
            last_name: senderProfile?.last_name,
            avatar_url: senderProfile?.avatar_url,
            email: senderProfile?.email,
          },
          status: request.status,
          created_at: request.created_at,
          type: "incoming" as const,
        });
      }

      // Batch-fetch all receiver profiles in one query
      const outgoingReceiverIds = (outgoingRequests || []).map((r: any) => r.receiver_id);
      const { data: receiverProfiles } = outgoingReceiverIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, username, first_name, last_name, avatar_url, email")
            .in("id", outgoingReceiverIds)
        : { data: [] };

      const receiverProfileMap = new Map(
        (receiverProfiles || []).map((p: any) => [p.id, p])
      );

      // Process outgoing requests using the pre-fetched profiles
      for (const request of outgoingRequests || []) {
        const receiverProfile = receiverProfileMap.get(request.receiver_id);
        transformedRequests.push({
          id: request.id,
          sender_id: request.sender_id,
          receiver_id: request.receiver_id,
          sender: {
            username:
              receiverProfile?.username ||
              `user_${request.receiver_id.substring(0, 8)}`,
            display_name:
              receiverProfile?.first_name && receiverProfile?.last_name
                ? `${receiverProfile.first_name} ${receiverProfile.last_name}`
                : receiverProfile?.username,
            first_name: receiverProfile?.first_name,
            last_name: receiverProfile?.last_name,
            avatar_url: receiverProfile?.avatar_url,
            email: receiverProfile?.email,
          },
          status: request.status,
          created_at: request.created_at,
          type: "outgoing" as const,
        });
      }

      const requestsJson = JSON.stringify(transformedRequests);
      if (prevFriendRequestsJson.current !== requestsJson) {
        prevFriendRequestsJson.current = requestsJson;
        setFriendRequests(transformedRequests);
      }
    } catch (error) {
      console.error("Error loading friend requests:", error);
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  // Send friend request
  const addFriend = useCallback(
    async (
      friendUserIdOrEmail: string,
      receiverEmail: string,
      receiverUsername?: string
    ) => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("User not authenticated");

        // Get sender's profile info
        const { data: senderProfile } = await supabase
          .from("profiles")
          .select("username, display_name, first_name, last_name")
          .eq("id", user.id)
          .single();

        if (!senderProfile) throw new Error("Sender profile not found");

        const senderUsername = senderProfile.username || "user";
        const senderDisplayName =
          senderProfile.display_name ||
          (senderProfile.first_name && senderProfile.last_name
            ? `${senderProfile.first_name} ${senderProfile.last_name}`
            : senderUsername);

        // Check if user exists in database (by ID or email)
        let receiverId: string | null = null;
        let userExists = false;
        let receiverUsernameFinal = receiverUsername;
        let isUUID = false;

        // Check if friendUserIdOrEmail is a UUID (meaning user was selected from search results)
        if (
          friendUserIdOrEmail.match(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          )
        ) {
          isUUID = true;
          // If it's a UUID, the user was selected from search results, so they definitely exist
          receiverId = friendUserIdOrEmail;
          userExists = true;

          // Get user details to ensure we have correct email and username
          const { data: userById, error: idError } = await supabase
            .from("profiles")
            .select("id, username, email")
            .eq("id", friendUserIdOrEmail)
            .maybeSingle();

          if (idError) {
            console.error("Error fetching user by ID:", idError);
            // Don't fail - we know the user exists from search results
          }

          if (userById) {
            receiverEmail = userById.email || receiverEmail;
            receiverUsernameFinal = userById.username || receiverUsernameFinal;
          } else {
            // This shouldn't happen - user was in search results but not found
            throw new Error("User not found. Please try searching again.");
          }
        } else {
          // Not a UUID - try to find by email (for email-only invites)
          if (receiverEmail) {
            const { data: visibilityData } = await supabase.rpc(
              "resolve_user_visibility_by_identifier",
              { p_identifier: receiverEmail.trim().toLowerCase() }
            );

            const visibility = Array.isArray(visibilityData)
              ? visibilityData[0]
              : visibilityData;

            if (visibility?.user_exists && (visibility?.is_blocked || !visibility?.can_view)) {
              throw new Error("User not found. Please check the email and try again.");
            }

            const { data: userByEmail, error: emailError } = await supabase
              .from("profiles")
              .select("id, username, email")
              .ilike("email", receiverEmail.trim().toLowerCase())
              .maybeSingle();

            if (emailError) {
              console.error("Error searching by email:", emailError);
            }

            if (userByEmail) {
              receiverId = userByEmail.id;
              userExists = true;
              receiverEmail = userByEmail.email || receiverEmail;
              receiverUsernameFinal =
                userByEmail.username || receiverUsernameFinal;
            } else if (visibility?.user_exists && visibility?.can_view && visibility?.profile_id) {
              receiverId = visibility.profile_id;
              userExists = true;
              receiverEmail = visibility.email || receiverEmail;
              receiverUsernameFinal = visibility.username || receiverUsernameFinal;
            }
          }
        }

        let requestId: string | null = null;

        // If user exists, persist friend request to database
        if (userExists && receiverId) {
          // If user was found from search results (UUID), trust that they exist
          // Only verify if we found them by email
          if (!isUUID) {
            // Double-check the receiver exists (only for email-based searches)
            const { data: receiverProfile, error: receiverError } =
              await supabase
                .from("profiles")
                .select("id, email")
                .eq("id", receiverId)
                .maybeSingle();

            if (receiverError) {
              console.error("Error verifying receiver profile:", receiverError);
            }

            if (!receiverProfile) {
              console.warn("Receiver profile not found during verification");
              userExists = false;
              receiverId = null;
            } else {
              receiverEmail = receiverProfile.email || receiverEmail;
            }
          }

          if (userExists && receiverId) {
            // Check if request already exists (any status)
            const { data: existingRequest } = await supabase
              .from("friend_requests")
              .select("id, status")
              .eq("sender_id", user.id)
              .eq("receiver_id", receiverId)
              .single();

            if (existingRequest) {
              if (existingRequest.status === "pending") {
                // Already pending, just use existing
                requestId = existingRequest.id;
              } else {
                // Update existing request to pending (for declined/cancelled requests)
                const { data: updatedRequest, error: updateError } = await supabase
                  .from("friend_requests")
                  .update({ status: "pending", created_at: new Date().toISOString() })
                  .eq("id", existingRequest.id)
                  .select("id")
                  .single();

                if (updateError) {
                  console.error("Error updating friend request:", updateError);
                  throw updateError;
                }
                requestId = updatedRequest.id;
              }
            } else {
              // Create new friend request
              const { data: newRequest, error: insertError } = await supabase
                .from("friend_requests")
                .insert({
                  sender_id: user.id,
                  receiver_id: receiverId,
                  status: "pending",
                })
                .select("id")
                .single();

              if (insertError) {
                // Log the error for debugging
                console.error("Error creating friend request:", insertError);
                // Throw the error - don't silently treat it as "user doesn't exist"
                throw insertError;
              } else {
                requestId = newRequest.id;
              }
            }
          }
        }

        let notificationSent = false;
        try {
          const { data: notifyData, error: notifyError } =
            await supabase.functions.invoke("smart-task", {
              body: {
                senderId: user.id,
                receiverId: receiverId,
                receiverEmail: receiverEmail,
                receiverUsername: receiverUsernameFinal,
                senderUsername: senderUsername,
                senderDisplayName: senderDisplayName,
                requestId: requestId,
                userExists: userExists,
              },
            });

          if (notifyError) {
            console.error("Error calling notification function:", notifyError);
            throw new Error(
              `Failed to send notification: ${notifyError.message || "Unknown error"}`
            );
          } else {
            notificationSent = true;
          }
        } catch (notifyErr: any) {
          console.error("Notification function call failed:", notifyErr);
          throw new Error(
            `Notification failed: ${
              notifyErr.message || "Could not send notification. Please try again."
            }`
          );
        }

        // Reload friend requests if user exists
        if (userExists) {
          await loadFriendRequests();
        }
      } catch (error: any) {
        console.error("Error sending friend request:", error);
        throw error;
      }
    },
    [loadFriendRequests]
  );

  // Accept friend request
  const acceptFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        // Get the friend request
        const { data: request, error: fetchError } = await supabase
          .from("friend_requests")
          .select("*")
          .eq("id", requestId)
          .single();

        if (fetchError) throw fetchError;

        // Update the request status
        const { error: updateError } = await supabase
          .from("friend_requests")
          .update({ status: "accepted" })
          .eq("id", requestId);

        if (updateError) throw updateError;

        // Create friendship records for both users
        const { error: friend1Error } = await supabase.from("friends").insert({
          user_id: request.sender_id,
          friend_user_id: request.receiver_id,
          status: "accepted",
        });

        if (friend1Error) throw friend1Error;

        const { error: friend2Error } = await supabase.from("friends").insert({
          user_id: request.receiver_id,
          friend_user_id: request.sender_id,
          status: "accepted",
        });

        if (friend2Error) throw friend2Error;

        // Reload data
        await Promise.all([fetchFriends(), loadFriendRequests()]);
      } catch (error) {
        console.error("Error accepting friend request:", error);
        throw error;
      }
    },
    [fetchFriends, loadFriendRequests]
  );

  // Decline friend request
  const declineFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        const { error } = await supabase
          .from("friend_requests")
          .update({ status: "declined" })
          .eq("id", requestId);

        if (error) throw error;

        // Reload friend requests
        await loadFriendRequests();
      } catch (error) {
        console.error("Error declining friend request:", error);
        throw error;
      }
    },
    [loadFriendRequests]
  );

  // Remove friend
  const removeFriend = useCallback(
    async (friendUserId: string) => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        // Remove friendship from both sides
        const { error: error1 } = await supabase
          .from("friends")
          .delete()
          .eq("user_id", user.id)
          .eq("friend_user_id", friendUserId);

        if (error1) throw error1;

        const { error: error2 } = await supabase
          .from("friends")
          .delete()
          .eq("user_id", friendUserId)
          .eq("friend_user_id", user.id);

        if (error2) throw error2;

        // Reload friends
        await fetchFriends();
      } catch (error) {
        console.error("Error removing friend:", error);
        throw error;
      }
    },
    [fetchFriends]
  );

  // Block user using new block service
  // This works for any user, not just existing friends
  const blockFriend = useCallback(
    async (userId: string, reason?: "harassment" | "spam" | "inappropriate" | "other") => {
      try {
        const result = await blockService.blockUser(userId, reason);
        
        if (!result.success) {
          throw new Error(result.error || "Failed to block user");
        }

        // Refresh friends list (blocked user will be auto-removed by DB trigger)
        await fetchFriends();
        await fetchBlockedUsers();
      } catch (error) {
        console.error("Error blocking user:", error);
        throw error;
      }
    },
    [fetchFriends, fetchBlockedUsers]
  );

  // Unblock user using new block service
  // Note: This only removes the block, does NOT auto-restore friendship
  const unblockFriend = useCallback(
    async (blockedUserId: string) => {
      try {
        const result = await blockService.unblockUser(blockedUserId);
        
        if (!result.success) {
          throw new Error(result.error || "Failed to unblock user");
        }

        // Refresh blocked users list
        await fetchBlockedUsers();
      } catch (error) {
        console.error("Error unblocking user:", error);
        throw error;
      }
    },
    [fetchBlockedUsers]
  );

  // Cancel friend request (delete from database)
  const cancelFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        const { error } = await supabase
          .from("friend_requests")
          .delete()
          .eq("id", requestId);

        if (error) throw error;

        // Reload friend requests
        await loadFriendRequests();
      } catch (error) {
        console.error("Error cancelling friend request:", error);
        throw error;
      }
    },
    [loadFriendRequests]
  );

  return {
    friends,
    friendCount,
    friendRequests,
    blockedUsers,
    loading,
    requestsLoading,
    error,
    fetchFriends,
    fetchBlockedUsers,
    loadFriendRequests,
    addFriend,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    blockFriend,
    unblockFriend,
    cancelFriendRequest,
  };
};
