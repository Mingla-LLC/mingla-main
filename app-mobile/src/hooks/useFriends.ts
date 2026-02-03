import { useState, useCallback, useEffect } from "react";
import { supabase } from "../services/supabase";

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
}

export const useFriends = () => {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch blocked users from Supabase (friends where status = 'blocked')
  const fetchBlockedUsers = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setBlockedUsers([]);
        return;
      }

      const { data: blocked1, error: e1 } = await supabase
        .from("friends")
        .select("friend_user_id")
        .eq("user_id", user.id)
        .eq("status", "blocked");

      const { data: blocked2, error: e2 } = await supabase
        .from("friends")
        .select("user_id")
        .eq("friend_user_id", user.id)
        .eq("status", "blocked");

      if (e1 || e2) {
        setBlockedUsers([]);
        return;
      }

      const blockedIds = [
        ...(blocked1 || []).map((r: any) => r.friend_user_id),
        ...(blocked2 || []).map((r: any) => r.user_id),
      ];
      const uniqueBlockedIds = [...new Set(blockedIds)];
      if (uniqueBlockedIds.length === 0) {
        setBlockedUsers([]);
        return;
      }

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, first_name, last_name, avatar_url")
        .in("id", uniqueBlockedIds);

      const list: BlockedUser[] = (profiles || []).map((p: any) => ({
        id: p.id,
        name:
          [p.first_name, p.last_name].filter(Boolean).join(" ") ||
          p.username ||
          "Unknown",
        username: p.username,
        avatar_url: p.avatar_url,
      }));
      setBlockedUsers(list);
    } catch (error) {
      console.error("Error fetching blocked users:", error);
      setBlockedUsers([]);
    }
  }, []);

  // Fetch blocked users when hook is used (e.g. when Profile or Connections screen mounts)
  useEffect(() => {
    fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  // Load friends
  const fetchFriends = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Get friends - check both sides of the friendship relationship
      // Friends where current user is user_id
      const { data: friendsData1, error: error1 } = await supabase
        .from("friends")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "accepted");

      // Friends where current user is friend_user_id (reverse relationship)
      const { data: friendsData2, error: error2 } = await supabase
        .from("friends")
        .select("*")
        .eq("friend_user_id", user.id)
        .eq("status", "accepted");

      if (error1) throw error1;
      if (error2) throw error2;

      // Combine both results, ensuring no duplicates
      const allFriendsData = [
        ...(friendsData1 || []),
        ...(friendsData2 || []).map((f: any) => ({
          ...f,
          // Swap user_id and friend_user_id for reverse relationships
          user_id: f.friend_user_id,
          friend_user_id: f.user_id,
        })),
      ];

      // Remove duplicates based on friend_user_id
      const uniqueFriends = allFriendsData.reduce((acc: any[], friend: any) => {
        if (!acc.find((f: any) => f.friend_user_id === friend.friend_user_id)) {
          acc.push(friend);
        }
        return acc;
      }, []);

      const friendsData = uniqueFriends;

      // Get profile information for each friend
      const transformedFriends: Friend[] = [];
      for (const friend of friendsData || []) {
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("id, username, first_name, last_name, avatar_url")
          .eq("id", friend.friend_user_id)
          .single();

        // If profile doesn't exist, create a basic one
        if (profileError && profileError.code === "PGRST116") {
          // Create a basic profile for this user
          const { data: newProfile, error: createError } = await supabase
            .from("profiles")
            .insert({
              id: friend.friend_user_id,
              username: `user_${friend.friend_user_id.substring(0, 8)}`,
            })
            .select("id, username, first_name, last_name, avatar_url")
            .single();

          if (createError) {
            console.error("Error creating profile:", createError);
            // Use fallback data
            transformedFriends.push({
              id: friend.id,
              user_id: friend.user_id,
              friend_user_id: friend.friend_user_id,
              username: `user_${friend.friend_user_id.substring(0, 8)}`,
              display_name: undefined,
              first_name: undefined,
              last_name: undefined,
              avatar_url: undefined,
              status: friend.status,
              created_at: friend.created_at,
            });
          } else {
            transformedFriends.push({
              id: friend.id,
              user_id: friend.user_id,
              friend_user_id: friend.friend_user_id,
              username: newProfile?.username || "Unknown",
              display_name:
                newProfile?.first_name && newProfile?.last_name
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
          console.error("Error fetching profile:", profileError);
          // Use fallback data
          transformedFriends.push({
            id: friend.id,
            user_id: friend.user_id,
            friend_user_id: friend.friend_user_id,
            username: `user_${friend.friend_user_id.substring(0, 8)}`,
            display_name: undefined,
            first_name: undefined,
            last_name: undefined,
            avatar_url: undefined,
            status: friend.status,
            created_at: friend.created_at,
          });
        } else {
          transformedFriends.push({
            id: friend.id,
            user_id: friend.user_id,
            friend_user_id: friend.friend_user_id,
            username: profileData?.username || "Unknown",
            display_name:
              profileData?.first_name && profileData?.last_name
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

      // Process incoming requests
      for (const request of incomingRequests || []) {
        const { data: senderProfile, error: senderError } = await supabase
          .from("profiles")
          .select("id, username, first_name, last_name, avatar_url")
          .eq("id", request.sender_id)
          .single();

        // If profile doesn't exist, create a basic one
        if (senderError && senderError.code === "PGRST116") {
          const { data: newProfile } = await supabase
            .from("profiles")
            .insert({
              id: request.sender_id,
              username: `user_${request.sender_id.substring(0, 8)}`,
            })
            .select("id, username, first_name, last_name, avatar_url")
            .single();

          transformedRequests.push({
            id: request.id,
            sender_id: request.sender_id,
            receiver_id: request.receiver_id,
            sender: {
              username:
                newProfile?.username ||
                `user_${request.sender_id.substring(0, 8)}`,
              display_name:
                newProfile?.first_name && newProfile?.last_name
                  ? `${newProfile.first_name} ${newProfile.last_name}`
                  : newProfile?.username,
              first_name: newProfile?.first_name,
              last_name: newProfile?.last_name,
              avatar_url: newProfile?.avatar_url,
            },
            status: request.status,
            created_at: request.created_at,
            type: "incoming" as const,
          });
        } else {
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
            },
            status: request.status,
            created_at: request.created_at,
            type: "incoming" as const,
          });
        }
      }

      // Process outgoing requests
      for (const request of outgoingRequests || []) {
        const { data: receiverProfile, error: receiverError } = await supabase
          .from("profiles")
          .select("id, username, first_name, last_name, avatar_url")
          .eq("id", request.receiver_id)
          .single();

        // If profile doesn't exist, create a basic one
        if (receiverError && receiverError.code === "PGRST116") {
          const { data: newProfile } = await supabase
            .from("profiles")
            .insert({
              id: request.receiver_id,
              username: `user_${request.receiver_id.substring(0, 8)}`,
            })
            .select("id, username, first_name, last_name, avatar_url")
            .single();

          transformedRequests.push({
            id: request.id,
            sender_id: request.sender_id,
            receiver_id: request.receiver_id,
            sender: {
              username:
                newProfile?.username ||
                `user_${request.receiver_id.substring(0, 8)}`,
              display_name:
                newProfile?.first_name && newProfile?.last_name
                  ? `${newProfile.first_name} ${newProfile.last_name}`
                  : newProfile?.username,
              first_name: newProfile?.first_name,
              last_name: newProfile?.last_name,
              avatar_url: newProfile?.avatar_url,
            },
            status: request.status,
            created_at: request.created_at,
            type: "outgoing" as const,
          });
        } else {
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
            },
            status: request.status,
            created_at: request.created_at,
            type: "outgoing" as const,
          });
        }
      }

      setFriendRequests(transformedRequests);
    } catch (error) {
      console.error("Error loading friend requests:", error);
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
              console.log("User found by email:", {
                receiverId,
                receiverEmail,
                userExists,
              });
            } else {
              console.log("User not found by email:", receiverEmail);
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
            console.log("Proceeding with friend request:", {
              receiverId,
              receiverEmail,
              userExists,
            });
            // Check if request already exists
            const { data: existingRequest } = await supabase
              .from("friend_requests")
              .select("id")
              .eq("sender_id", user.id)
              .eq("receiver_id", receiverId)
              .eq("status", "pending")
              .single();

            if (existingRequest) {
              requestId = existingRequest.id;
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

        // Call Edge Function to send email (and push notification if user exists)
        // Log the values being sent to help debug
        console.log("Calling Edge Function with:", {
          senderId: user.id,
          receiverId: receiverId,
          receiverEmail: receiverEmail,
          receiverUsername: receiverUsernameFinal,
          senderUsername: senderUsername,
          requestId: requestId,
          userExists: userExists,
        });

        let emailSent = false;
        try {
          const { data: emailData, error: emailError } =
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

          if (emailError) {
            console.error("Error calling email function:", emailError);
            console.error(
              "Function URL:",
              `https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/smart-task`
            );
            throw new Error(
              `Failed to send email: ${emailError.message || "Unknown error"}`
            );
          } else {
            console.log("Email sent successfully:", emailData);
            emailSent = true;
          }
        } catch (emailErr: any) {
          console.error("Email function call failed:", emailErr);
          // Re-throw so the UI knows the email failed
          throw new Error(
            `Email notification failed: ${
              emailErr.message || "Could not send email. Please try again."
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

  // Block friend: set friendship status to 'blocked' in Supabase (both rows)
  const blockFriend = useCallback(
    async (friendUserId: string) => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { error: error1 } = await supabase
          .from("friends")
          .update({ status: "blocked" })
          .eq("user_id", user.id)
          .eq("friend_user_id", friendUserId);

        if (error1) throw error1;

        const { error: error2 } = await supabase
          .from("friends")
          .update({ status: "blocked" })
          .eq("user_id", friendUserId)
          .eq("friend_user_id", user.id);

        if (error2) throw error2;

        await fetchFriends();
        await fetchBlockedUsers();
      } catch (error) {
        console.error("Error blocking friend:", error);
        throw error;
      }
    },
    [fetchFriends, fetchBlockedUsers]
  );

  // Unblock friend: set friendship status back to 'accepted' in Supabase (both rows)
  const unblockFriend = useCallback(
    async (blockedUserId: string) => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { error: error1 } = await supabase
          .from("friends")
          .update({ status: "accepted" })
          .eq("user_id", user.id)
          .eq("friend_user_id", blockedUserId);

        if (error1) throw error1;

        const { error: error2 } = await supabase
          .from("friends")
          .update({ status: "accepted" })
          .eq("user_id", blockedUserId)
          .eq("friend_user_id", user.id);

        if (error2) throw error2;
        console.log("unblocking friend");
        await fetchFriends();
      } catch (error) {
        console.error("Error unblocking friend:", error);
        throw error;
      }
    },
    [fetchFriends]
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
    friendRequests,
    blockedUsers,
    loading,
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
