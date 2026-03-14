import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, trackedInvoke } from "../services/supabase";
import { blockService } from "../services/blockService";
import { useAppStore } from "../store/appStore";
import {
  useFriendsList,
  useFriendRequests as useFriendRequestsQuery,
  useBlockedUsers,
  friendsKeys,
} from "./useFriendsQuery";

// Re-export types from service so existing imports work
export type { Friend, FriendRequest, BlockedUser } from "../services/friendsService";

export const useFriends = (options?: { autoFetchBlockedUsers?: boolean }) => {
  const { autoFetchBlockedUsers = true } = options || {};
  const queryClient = useQueryClient();

  // Get userId synchronously from Zustand store (set by useAuthSimple on login)
  const userId = useAppStore((s) => s.user?.id);

  // ── React Query hooks ──
  const friendsQuery = useFriendsList(userId);
  const requestsQuery = useFriendRequestsQuery(userId);
  const blockedQuery = useBlockedUsers(userId, autoFetchBlockedUsers);

  // ── Derived values (backwards-compatible) ──
  const friends = friendsQuery.data ?? [];
  const friendCount = friends.length;
  const friendRequests = requestsQuery.data ?? [];
  const blockedUsers = blockedQuery.data ?? [];
  const loading = friendsQuery.isLoading;
  const requestsLoading = requestsQuery.isLoading;
  const error = friendsQuery.error?.message ?? null;

  // ── Refetch functions (backwards-compatible) ──
  const fetchFriends = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: friendsKeys.list(userId ?? "") });
  }, [queryClient, userId]);

  const loadFriendRequests = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: friendsKeys.requests(userId ?? "") });
  }, [queryClient, userId]);

  const fetchBlockedUsers = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: friendsKeys.blocked(userId ?? "") });
  }, [queryClient, userId]);

  // ── Mutations ──

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

        let receiverId: string | null = null;
        let userExists = false;
        let receiverUsernameFinal = receiverUsername;
        let isUUID = false;

        if (
          friendUserIdOrEmail.match(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          )
        ) {
          isUUID = true;
          receiverId = friendUserIdOrEmail;
          userExists = true;

          const { data: userById, error: idError } = await supabase
            .from("profiles")
            .select("id, username, email")
            .eq("id", friendUserIdOrEmail)
            .maybeSingle();

          if (idError) {
            console.error("Error fetching user by ID:", idError);
          }

          if (userById) {
            receiverEmail = userById.email || receiverEmail;
            receiverUsernameFinal = userById.username || receiverUsernameFinal;
          } else {
            throw new Error("User not found. Please try searching again.");
          }
        } else {
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

        if (userExists && receiverId) {
          if (!isUUID) {
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
            const { data: existingRequest } = await supabase
              .from("friend_requests")
              .select("id, status")
              .eq("sender_id", user.id)
              .eq("receiver_id", receiverId)
              .single();

            if (existingRequest) {
              if (existingRequest.status === "pending") {
                requestId = existingRequest.id;
              } else {
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
                console.error("Error creating friend request:", insertError);
                throw insertError;
              } else {
                requestId = newRequest.id;
              }
            }
          }
        }

        // Notifications are side effects — DB write already succeeded.
        try {
          const { error: notifyError } =
            await trackedInvoke("send-friend-request-email", {
              body: {
                senderId: user.id,
                receiverId: receiverId,
                receiverUsername: receiverUsernameFinal,
                senderUsername: senderUsername,
                senderDisplayName: senderDisplayName,
                requestId: requestId,
                userExists: userExists,
              },
            });

          if (notifyError) {
            console.warn("[useFriends] Notification failed (non-critical):", notifyError);
          }
        } catch (notifyErr: any) {
          console.warn("[useFriends] Notification failed (non-critical):", notifyErr);
        }

        // Invalidate friend requests cache
        if (userExists) {
          await queryClient.invalidateQueries({ queryKey: friendsKeys.requests(userId ?? "") });
        }
      } catch (error: any) {
        console.error("Error sending friend request:", error);
        throw error;
      }
    },
    [queryClient, userId]
  );

  const acceptFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        // Single atomic RPC call replaces 3 separate operations:
        // 1. UPDATE friend_requests SET status='accepted'
        // 2. UPSERT friends (sender → receiver)
        // 3. UPSERT friends (receiver → sender)
        // All three succeed or all three roll back — no split state possible.
        const { data, error } = await supabase.rpc('accept_friend_request_atomic', {
          p_request_id: requestId,
        });

        if (error) throw error;

        const result = data as {
          success: boolean;
          error?: string;
          sender_id?: string;
          receiver_id?: string;
          revealed_invite_ids?: Array<{
            id: string;
            session_id: string;
            inviter_id: string;
            invited_user_id: string;
            session_name: string;
          }>;
        };

        if (!result.success) {
          throw new Error(result.error || 'Failed to accept friend request');
        }

        // Notify the original sender that their friend request was accepted.
        // Best-effort — log but don't fail the accept.
        if (result.sender_id) {
          try {
            await trackedInvoke('send-friend-accepted-notification', {
              body: {
                accepterId: userId,
                senderId: result.sender_id,
                requestId,
              },
            });
          } catch (notifyErr) {
            console.warn('[useFriends] Failed to send friend accepted notification:', notifyErr);
          }
        }

        // Send push notifications for revealed collaboration invites.
        // The RPC returns the exact invite IDs that were just revealed —
        // no timing window, no race condition, no 10-second guesswork.
        if (result.revealed_invite_ids && result.revealed_invite_ids.length > 0) {
          for (const invite of result.revealed_invite_ids) {
            try {
              await trackedInvoke('send-collaboration-invite', {
                body: {
                  inviterId: invite.inviter_id,
                  invitedUserId: invite.invited_user_id,
                  sessionId: invite.session_id,
                  sessionName: invite.session_name,
                  inviteId: invite.id,
                },
              });
            } catch (notifyErr) {
              // Push is best-effort; log but don't fail the accept
              console.warn('[useFriends] Failed to notify for revealed invite:', notifyErr);
            }
          }
        }

        // Invalidate all friends caches (friends list + requests)
        await queryClient.invalidateQueries({ queryKey: friendsKeys.all });
      } catch (error) {
        console.error("Error accepting friend request:", error);
        throw error;
      }
    },
    [queryClient, userId]
  );

  const declineFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        const { error } = await supabase
          .from("friend_requests")
          .update({ status: "declined" })
          .eq("id", requestId);

        if (error) throw error;

        await queryClient.invalidateQueries({ queryKey: friendsKeys.requests(userId ?? "") });
      } catch (error) {
        console.error("Error declining friend request:", error);
        throw error;
      }
    },
    [queryClient, userId]
  );

  const removeFriend = useCallback(
    async (friendUserId: string) => {
      try {
        const { data, error } = await supabase.rpc('remove_friend_atomic', {
          p_friend_user_id: friendUserId,
        });

        if (error) throw error;

        const result = data as { success: boolean; error?: string };
        if (!result.success) {
          throw new Error(result.error || 'Failed to remove friend');
        }

        await queryClient.invalidateQueries({ queryKey: friendsKeys.all });
      } catch (error) {
        console.error("Error removing friend:", error);
        throw error;
      }
    },
    [queryClient]
  );

  const blockFriend = useCallback(
    async (blockUserId: string, reason?: "harassment" | "spam" | "inappropriate" | "other") => {
      try {
        const result = await blockService.blockUser(blockUserId, reason);

        if (!result.success) {
          throw new Error(result.error || "Failed to block user");
        }

        // Invalidate all friends caches (friends list + blocked list)
        await queryClient.invalidateQueries({ queryKey: friendsKeys.all });
      } catch (error) {
        console.error("Error blocking user:", error);
        throw error;
      }
    },
    [queryClient]
  );

  const unblockFriend = useCallback(
    async (blockedUserId: string) => {
      try {
        const result = await blockService.unblockUser(blockedUserId);

        if (!result.success) {
          throw new Error(result.error || "Failed to unblock user");
        }

        await queryClient.invalidateQueries({ queryKey: friendsKeys.blocked(userId ?? "") });
      } catch (error) {
        console.error("Error unblocking user:", error);
        throw error;
      }
    },
    [queryClient, userId]
  );

  const cancelFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        const { error } = await supabase
          .from("friend_requests")
          .delete()
          .eq("id", requestId);

        if (error) throw error;

        await queryClient.invalidateQueries({ queryKey: friendsKeys.requests(userId ?? "") });
      } catch (error) {
        console.error("Error cancelling friend request:", error);
        throw error;
      }
    },
    [queryClient, userId]
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
