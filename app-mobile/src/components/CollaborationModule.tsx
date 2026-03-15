import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Dimensions,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
import SessionsTab from "./collaboration/SessionsTab";
import InvitesTab from "./collaboration/InvitesTab";
import { CreateSessionContent } from "./CreateSessionModal";
import { supabase } from "../services/supabase";
import { useAppStore } from "../store/appStore";
import { useFriends } from "../hooks/useFriends";
import { useSessionCreationGate } from '../hooks/useSessionCreationGate';
import { CustomPaywallScreen } from './CustomPaywallScreen';
import type { GatedFeature } from '../hooks/useFeatureGate';

interface Friend {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  status: "online" | "offline";
  lastActive?: string;
}

interface CollaborationSession {
  id: string;
  name: string;
  status: "pending" | "active" | "archived";
  participants: Friend[];
  createdBy: string;
  createdAt: string;
  lastActivity: string;
  hasCollabPreferences?: boolean;
  pendingParticipants: number;
  totalParticipants: number;
  boardCards: number;
  admins?: string[];
}

// M11 FIX: Typed interfaces replacing pervasive `any[]` usage
interface CollaborationInviteRow {
  id: string;
  session_id: string;
  inviter_id: string;
  invited_user_id: string;
  status: string;
  created_at: string;
  expires_at?: string;
  sessionName?: string;
  collaboration_sessions?: { name: string; status: string } | null;
  profiles?: { id: string; display_name: string | null; email: string | null; avatar_url: string | null } | null;
}

interface CollaborationModuleProps {
  isOpen: boolean;
  onClose: () => void;
  currentMode: "solo" | string;
  onModeChange: (mode: "solo" | string) => void;
  preSelectedFriend?: Friend | null;
  boardsSessions?: CollaborationSession[];
  onUpdateBoardSession?: (updatedBoard: CollaborationSession) => void;
  onCreateSession?: (newSession: { id: string; name: string; status: string; createdBy: string; createdAt: string }) => void;
  onNavigateToBoard?: (board: CollaborationSession, discussionTab?: string) => void;
  availableFriends?: Friend[];
  onRefreshBoards?: () => void; // Callback to refresh boards list
}

export default function CollaborationModule({
  isOpen,
  onClose,
  currentMode,
  onModeChange,
  preSelectedFriend,
  boardsSessions = [],
  onUpdateBoardSession,
  onCreateSession,
  onNavigateToBoard,
  availableFriends = [],
  onRefreshBoards,
}: CollaborationModuleProps) {
  const insets = useSafeAreaInsets();
  const SHEET_HEIGHT = SCREEN_HEIGHT - insets.top;
  const [activeTab, setActiveTab] = useState<"sessions" | "invites" | "create">(
    "sessions"
  );

  const [invitesTabType, setInvitesTabType] = useState<"sent" | "received">(
    "received"
  );
  const { user } = useAppStore();
  const { canCreateSession, currentSessionCount, maxSessions, isUnlimited } = useSessionCreationGate();
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<GatedFeature>('session_creation');
  const {
    fetchFriends,
    friendRequests,
    loadFriendRequests,
  } = useFriends();
  const [receivedInvites, setReceivedInvites] = useState<CollaborationInviteRow[]>([]);
  const [sentInvites, setSentInvites] = useState<CollaborationInviteRow[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [userSessions, setUserSessions] = useState<CollaborationSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [processingInviteId, setProcessingInviteId] = useState<string | null>(null);

  // Reset create flow when tab changes
  React.useEffect(() => {
    if (activeTab !== "create") {
      // Reset create flow state if needed
    }
  }, [activeTab]);

  // Auto-navigate to create tab if pre-selected friend
  React.useEffect(() => {
    if (preSelectedFriend && isOpen) {
      setActiveTab("create");
    }
  }, [preSelectedFriend, isOpen]);

  // Fetch invites, sessions, and friends from Supabase
  useEffect(() => {
    if (isOpen && user) {
      loadInvites();
      loadUserSessions();
      fetchFriends();
      loadFriendRequests();
    }
  }, [isOpen, user, fetchFriends, loadFriendRequests]);

  // H7 FIX: Realtime subscription for invite changes.
  // Without this, if another user cancels/accepts an invite while InvitesTab is open,
  // the UI shows stale data — user may try to accept an already-cancelled invite.
  useEffect(() => {
    if (!isOpen || !user) return;

    const channel = supabase
      .channel(`collab-invites-live:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_invites',
          filter: `invited_user_id=eq.${user.id}`,
        },
        () => {
          loadInvites();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_invites',
          filter: `inviter_id=eq.${user.id}`,
        },
        () => {
          loadInvites();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, user]);


  const loadInvites = async () => {
    if (!user) return;

    setLoadingInvites(true);
    try {
      // Fetch received invites
      const { data: received, error: receivedError } = await supabase
        .from("collaboration_invites")
        .select(
          `
          *,
          collaboration_sessions!collaboration_invites_session_id_fkey(name, status),
          profiles!collaboration_invites_inviter_id_fkey(id, display_name, email, avatar_url)
        `
        )
        .eq("invited_user_id", user.id)
        .eq("status", "pending")
        .eq("pending_friendship", false)
        .order("created_at", { ascending: false });

      if (receivedError) {
        console.error("Error loading received invites:", receivedError);
        setReceivedInvites([]);
      } else {
        // If we have invites, fetch session names separately if needed
        const sessionIds = (received || [])
          .map((inv) => inv.session_id)
          .filter(Boolean);
        let sessionNamesMap: Record<string, string> = {};

        if (sessionIds.length > 0) {
          // Try to fetch through collaboration_invites join (user has access to their invites)
          const { data: invitesWithSessions } = await supabase
            .from("collaboration_invites")
            .select("session_id, collaboration_sessions!inner(id, name)")
            .in("session_id", sessionIds)
            .eq("invited_user_id", user.id);

          if (invitesWithSessions && invitesWithSessions.length > 0) {
            invitesWithSessions.forEach((inv: { session_id: string; collaboration_sessions: { id: string; name: string } | { id: string; name: string }[] }) => {
              const session = Array.isArray(inv.collaboration_sessions)
                ? inv.collaboration_sessions[0]
                : inv.collaboration_sessions;
              if (session?.id && session?.name) {
                sessionNamesMap[session.id] = session.name;
              }
            });
          }

          // Also try through session_participants if user is already a participant
          if (Object.keys(sessionNamesMap).length < sessionIds.length) {
            const { data: participants } = await supabase
              .from("session_participants")
              .select("session_id, collaboration_sessions!inner(id, name)")
              .in("session_id", sessionIds)
              .eq("user_id", user.id);

            if (participants && participants.length > 0) {
              participants.forEach((p: { session_id: string; collaboration_sessions: { id: string; name: string } | { id: string; name: string }[] }) => {
                const session = Array.isArray(p.collaboration_sessions)
                  ? p.collaboration_sessions[0]
                  : p.collaboration_sessions;
                if (
                  session?.id &&
                  session?.name &&
                  !sessionNamesMap[session.id]
                ) {
                  sessionNamesMap[session.id] = session.name;
                }
              });
            }
          }

          // Last resort: try direct query
          if (Object.keys(sessionNamesMap).length < sessionIds.length) {
            const { data: sessions } = await supabase
              .from("collaboration_sessions")
              .select("id, name")
              .in("id", sessionIds);

            if (sessions && sessions.length > 0) {
              sessions.forEach((session) => {
                if (!sessionNamesMap[session.id]) {
                  sessionNamesMap[session.id] =
                    session.name || "Unnamed Session";
                }
              });
            }
          }
        }

        const formattedReceived = (received || []).map((invite) => {
          // Start with fallback map first (most reliable)
          let sessionName = "Session";

          if (invite.session_id && sessionNamesMap[invite.session_id]) {
            sessionName = sessionNamesMap[invite.session_id];
          } else if (invite.session_id) {
            // Try to find by string matching
            const sessionIdStr = String(invite.session_id);
            const mapKey = Object.keys(sessionNamesMap).find(
              (key) => String(key) === sessionIdStr
            );
            if (mapKey) {
              sessionName = sessionNamesMap[mapKey];
            }
          }

          // Then try the join result as secondary option
          if (sessionName === "Session" && invite.collaboration_sessions) {
            if (Array.isArray(invite.collaboration_sessions)) {
              const sessionData = invite.collaboration_sessions[0];
              if (sessionData?.name) {
                sessionName = sessionData.name;
              }
            } else if (invite.collaboration_sessions.name) {
              sessionName = invite.collaboration_sessions.name;
            }
          }

          // Handle profiles data structure
          let profileData = invite.profiles;
          if (Array.isArray(invite.profiles)) {
            profileData = invite.profiles[0];
          }

          return {
            id: invite.id,
            sessionName: sessionName,
            fromUser: {
              id: profileData?.id || invite.inviter_id,
              name:
                profileData?.display_name || profileData?.email || "Unknown",
              avatar: profileData?.avatar_url,
              status: "online" as const,
            },
            toUser: {
              id: user.id,
              name: user.email || "You",
              status: "online" as const,
            },
            status: invite.status,
            createdAt: invite.created_at, // Keep as ISO string for formatting
            expiresAt: invite.expires_at || undefined, // Keep as ISO string for formatting
          };
        });
        setReceivedInvites(formattedReceived);
      }

      // Fetch sent invites
      const { data: sent, error: sentError } = await supabase
        .from("collaboration_invites")
        .select(
          `
          *,
          collaboration_sessions!inner(name, status),
          profiles!collaboration_invites_invited_user_id_fkey(id, display_name, email, avatar_url)
        `
        )
        .eq("inviter_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (sentError) {
        console.error("Error loading sent invites:", sentError);
      } else {
        const formattedSent = (sent || []).map((invite) => ({
          id: invite.id,
          sessionName: invite.collaboration_sessions?.name || "Session",
          fromUser: {
            id: user.id,
            name: user.email || "You",
            status: "online" as const,
          },
          toUser: {
            id: invite.profiles?.id || invite.invited_user_id,
            name:
              invite.profiles?.display_name ||
              invite.profiles?.email ||
              "Unknown",
            avatar: invite.profiles?.avatar_url,
            status: "online" as const,
          },
          status: invite.status,
          createdAt: invite.created_at, // Keep as ISO string for formatting
          expiresAt: invite.expires_at || undefined, // Keep as ISO string for formatting
        }));
        setSentInvites(formattedSent);
      }
    } catch (error) {
      console.error("Error loading invites:", error);
    } finally {
      setLoadingInvites(false);
    }
  };

  const loadUserSessions = async (showLoader: boolean = true) => {
    if (!user) {
      console.log("No user, skipping session load");
      return;
    }

    if (showLoader) {
      setLoadingSessions(true);
    }
    try {
      console.log("Loading user sessions for user:", user.id);

      // Get all sessions where user is a participant (matching BoardSessionService logic)
      const { data: participations, error: participationError } = await supabase
        .from("session_participants")
        .select("session_id, has_accepted")
        .eq("user_id", user.id)
        .eq("has_accepted", true);

      if (participationError) {
        console.error("Error loading participations:", participationError);
        setUserSessions([]);
        if (showLoader) {
          setLoadingSessions(false);
        }
        return;
      }

      const sessionIdsFromParticipants =
        participations?.map((p) => p.session_id) || [];

      // Only show sessions where user is an active participant (has_accepted = true)
      // Don't include sessions just because user created them - they must be a member
      const allSessionIds = sessionIdsFromParticipants;

      if (allSessionIds.length === 0) {
        setUserSessions([]);
        if (showLoader) {
          setLoadingSessions(false);
        }
        return;
      }

      // Load session details - show ALL non-archived sessions (matching BoardSessionService logic)
      const { data: allSessions, error: sessionsError } = await supabase
        .from("collaboration_sessions")
        .select("*")
        .in("id", allSessionIds)
        .order("created_at", { ascending: false });

      if (sessionsError) {
        console.error("Error loading sessions:", sessionsError);
        setUserSessions([]);
        if (showLoader) {
          setLoadingSessions(false);
        }
        return;
      }

      // Filter out archived/completed sessions (matching BoardSessionService)
      const sessions = (allSessions || []).filter(
        (s) => s.archived_at === null && s.status !== "completed" && s.status !== "archived"
      );

      // Load ALL participants (accepted and pending) for accurate counts
      let allParticipants: { session_id: string; user_id: string; has_accepted: boolean; profiles: { display_name: string | null; email: string | null; avatar_url: string | null } | null }[] = [];
      if (sessions && sessions.length > 0) {
        const { data: participantsData, error: participantsError } =
          await supabase
            .from("session_participants")
            .select(
              `
            session_id,
            user_id,
            has_accepted,
            profiles!session_participants_user_id_fkey(display_name, email, avatar_url)
          `
            )
            .in("session_id", allSessionIds);

        if (!participantsError && participantsData) {
          allParticipants = participantsData;
        }
      }

      // Get card counts for each session
      const sessionCardCounts: Record<string, number> = {};
      if (sessions && sessions.length > 0) {
        const sessionIdsForCards = sessions.map((s) => s.id);
        const { data: cardCounts, error: cardCountsError } = await supabase
          .from("board_saved_cards")
          .select("session_id")
          .in("session_id", sessionIdsForCards);

        if (!cardCountsError && cardCounts) {
          cardCounts.forEach((card) => {
            sessionCardCounts[card.session_id] =
              (sessionCardCounts[card.session_id] || 0) + 1;
          });
        }
      }

      // Format sessions for display
      const formattedSessions = (sessions || []).map((session) => {
        // Get ALL participants for this session (for accurate counts)
        const sessionParticipants = allParticipants.filter(
          (p) => p.session_id === session.id
        );
        // Only show accepted participants in the display list
        const acceptedParticipants = sessionParticipants.filter((p) => p.has_accepted);
        const participants = acceptedParticipants.map((p) => ({
          id: p.user_id,
          name: p.profiles?.display_name || p.profiles?.email || "Unknown",
          avatar: p.profiles?.avatar_url,
          status: "online" as const,
        }));

        return {
          id: session.id,
          name: session.name || "Untitled Session",
          status: session.status,
          participants: participants,
          createdBy: session.created_by,
          createdAt: session.created_at,
          lastActivity: session.updated_at || session.created_at,
          totalParticipants: participants.length,
          pendingParticipants: sessionParticipants.filter(p => !p.has_accepted).length,
          boardCards: sessionCardCounts[session.id] || 0,
          admins: session.admins || [],
        };
      });

      // Only show sessions with 2+ members (active collaborations)
      const sessionsWithMembers = formattedSessions.filter(
        (session) => session.totalParticipants >= 2
      );

      setUserSessions(sessionsWithMembers);
    } catch (error) {
      console.error("Error loading sessions:", error);
    } finally {
      if (showLoader) {
        setLoadingSessions(false);
      }
    }
  };

  const handleAcceptInvite = async (inviteId: string) => {
    if (!user) return;

    setProcessingInviteId(inviteId);
    try {
      // First, fetch the invite details to get session info and inviter ID
      const { data: invite, error: fetchError } = await supabase
        .from("collaboration_invites")
        .select(
          `
          id,
          session_id,
          inviter_id,
          invited_user_id,
          collaboration_sessions!inner(name)
        `
        )
        .eq("id", inviteId)
        .eq("invited_user_id", user.id)
        .single();

      if (fetchError || !invite) {
        throw new Error(fetchError?.message ?? "Invite not found");
      }

      // Get session name from the join
      const sessionData = invite.collaboration_sessions as Record<string, string> | Record<string, string>[] | null;
      const sessionName = Array.isArray(sessionData)
        ? sessionData[0]?.name
        : sessionData?.name || "Session";

      // Update invite status
      const { error } = await supabase
        .from("collaboration_invites")
        .update({ status: "accepted" })
        .eq("id", inviteId)
        .eq("invited_user_id", user.id);

      if (error) {
        throw new Error(error.message);
      }

      // Add user as participant if not already added
      const { error: participantError } = await supabase
        .from("session_participants")
        .upsert(
          {
            session_id: invite.session_id,
            user_id: user.id,
            has_accepted: true,
          },
          {
            onConflict: "session_id,user_id",
          }
        );

      if (participantError) {
        console.error("Error adding participant:", participantError);
      }

      // Check membership count to determine if session should become active
      // Membership count is the source of truth for state transitions
      const { data: allParticipants, error: participantsError } = await supabase
        .from("session_participants")
        .select("has_accepted, user_id")
        .eq("session_id", invite.session_id);

      if (!participantsError && allParticipants) {
        const acceptedMembers = allParticipants.filter(p => p.has_accepted);
        const acceptedCount = acceptedMembers.length;

        // Session becomes active when at least 2 members have accepted
        if (acceptedCount >= 2) {
          // Get session details
          const { data: sessionDetails, error: sessionFetchError } = await supabase
            .from("collaboration_sessions")
            .select("*")
            .eq("id", invite.session_id)
            .single();

          if (!sessionFetchError && sessionDetails) {
            // Check if board already exists (concurrent accept protection)
            let boardId: string | null = sessionDetails.board_id || null;

            if (sessionDetails.board_id) {
              // Board already created by concurrent accept — use existing board
              boardId = sessionDetails.board_id;
            } else {
              // Create board (only if no board exists yet)
              const { data: newBoard, error: boardError } = await supabase
                .from("boards")
                .insert({
                  name: sessionDetails.name,
                  description: `Collaborative board for ${sessionDetails.name}`,
                  created_by: user.id,
                  is_public: false,
                })
                .select("id")
                .single();

              if (boardError) {
                console.error("Error creating board:", boardError);
              } else {
                boardId = newBoard.id;

                // Atomically set board_id only if still NULL (optimistic locking)
                const { data: updateResult } = await supabase
                  .from("collaboration_sessions")
                  .update({
                    status: "active",
                    board_id: boardId,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", invite.session_id)
                  .is("board_id", null)
                  .select("id");

                if (!updateResult || updateResult.length === 0) {
                  // Another accept already set board_id — use theirs, delete our orphan
                  const { data: existing } = await supabase
                    .from("collaboration_sessions")
                    .select("board_id")
                    .eq("id", invite.session_id)
                    .single();

                  if (existing?.board_id && existing.board_id !== boardId) {
                    // Clean up our orphaned board
                    await supabase.from("boards").delete().eq("id", boardId);
                    boardId = existing.board_id;
                  }
                }
              }
            }

            // If session is still pending (no board creation happened), just activate it
            if (!boardId && sessionDetails.status === 'pending') {
              await supabase
                .from("collaboration_sessions")
                .update({ status: "active", updated_at: new Date().toISOString() })
                .eq("id", invite.session_id)
                .eq("status", "pending");
            }

            // Add all accepted participants as board collaborators (idempotent)
            if (boardId) {
              for (const participant of acceptedMembers) {
                await supabase
                  .from("board_collaborators")
                  .upsert({
                    board_id: boardId,
                    user_id: participant.user_id,
                    role: participant.user_id === sessionDetails.created_by ? 'owner' : 'collaborator'
                  }, {
                    onConflict: "board_id,user_id",
                    ignoreDuplicates: true
                  });
              }
            }
          }
        }
      }

      // Copy solo preferences to collaboration preferences (instead of empty defaults)
      const { data: soloPrefs } = await supabase
        .from("preferences")
        .select("categories, intents, price_tiers, budget_min, budget_max, travel_mode, travel_constraint_type, travel_constraint_value, date_option, time_slot, exact_time, datetime_pref, use_gps_location, custom_location")
        .eq("profile_id", user.id)
        .single();

      // M1 FIX: Use upsert instead of insert. Double-accept (race or retry) would
      // cause a unique constraint violation with insert. Upsert is idempotent.
      const { error: preferencesError } = await supabase
        .from("board_session_preferences")
        .upsert({
          session_id: invite.session_id,
          user_id: user.id,
          categories: soloPrefs?.categories ?? [],
          intents: soloPrefs?.intents ?? [],
          price_tiers: soloPrefs?.price_tiers ?? [],
          budget_min: soloPrefs?.budget_min ?? 0,
          budget_max: soloPrefs?.budget_max ?? 1000,
          travel_mode: soloPrefs?.travel_mode ?? "walking",
          travel_constraint_type: "time",
          travel_constraint_value: soloPrefs?.travel_constraint_value ?? 30,
          date_option: soloPrefs?.date_option ?? null,
          time_slot: soloPrefs?.time_slot ?? null,
          exact_time: soloPrefs?.exact_time ?? null,
          datetime_pref: soloPrefs?.datetime_pref ?? null,
          use_gps_location: soloPrefs?.use_gps_location ?? true,
          custom_location: soloPrefs?.custom_location ?? null,
        }, {
          onConflict: "session_id,user_id",
        });

      if (preferencesError) {
        console.error(
          "Error creating preferences for accepting user:",
          preferencesError
        );
      }

      // Call edge function to notify inviter
      try {
        const { data: notifyData, error: notifyError } =
          await supabase.functions.invoke("notify-invite-response", {
            body: {
              inviteId: inviteId,
              response: "accepted",
              inviterId: invite.inviter_id,
              invitedUserId: user.id,
              sessionId: invite.session_id,
              sessionName: sessionName,
            },
          });

        if (notifyError) {
          console.error("Error sending notification:", notifyError);
        }
      } catch (notifyError) {
        console.error("Error sending notification:", notifyError);
        // Don't fail the whole operation if notification fails
      }

      // Reload invites and sessions in parallel
      await Promise.all([loadInvites(), loadUserSessions(false)]);

      // Immediately refresh boards list so the new board appears in Activity Page
      if (onRefreshBoards) {
        onRefreshBoards();
      }
    } catch (error) {
      console.error("Error accepting invite:", error);
      Alert.alert("Error", "Failed to accept invite. Please try again.");
    } finally {
      setProcessingInviteId(null);
    }
  };

  const handleDeclineInvite = async (inviteId: string) => {
    if (!user) return;

    setProcessingInviteId(inviteId);
    try {
      // First, fetch the invite details to get session info and inviter ID
      const { data: invite, error: fetchError } = await supabase
        .from("collaboration_invites")
        .select(
          `
          id,
          session_id,
          inviter_id,
          invited_user_id,
          collaboration_sessions!inner(name)
        `
        )
        .eq("id", inviteId)
        .eq("invited_user_id", user.id)
        .single();

      if (fetchError || !invite) {
        throw new Error(fetchError?.message ?? "Invite not found");
      }

      // Get session name from the join
      const sessionData = invite.collaboration_sessions as Record<string, string> | Record<string, string>[] | null;
      const sessionName = Array.isArray(sessionData)
        ? sessionData[0]?.name
        : sessionData?.name || "Session";

      // Update invite status
      const { error } = await supabase
        .from("collaboration_invites")
        .update({ status: "declined" })
        .eq("id", inviteId)
        .eq("invited_user_id", user.id);

      if (error) {
        throw new Error(error.message);
      }

      // Remove user from session_participants if they were added (even if not accepted)
      // This ensures they don't appear in member counts or participant lists
      const { error: removeParticipantError } = await supabase
        .from("session_participants")
        .delete()
        .eq("session_id", invite.session_id)
        .eq("user_id", user.id);

      if (removeParticipantError) {
        // Log error but don't fail - user might not have been added as participant yet
        console.error("Error removing participant:", removeParticipantError);
      }

      // Call edge function to notify inviter
      try {
        const { data: notifyData, error: notifyError } =
          await supabase.functions.invoke("notify-invite-response", {
            body: {
              inviteId: inviteId,
              response: "declined",
              inviterId: invite.inviter_id,
              invitedUserId: user.id,
              sessionId: invite.session_id,
              sessionName: sessionName,
            },
          });

        if (notifyError) {
          console.error("Error sending notification:", notifyError);
        }
      } catch (notifyError) {
        console.error("Error sending notification:", notifyError);
        // Don't fail the whole operation if notification fails
      }

      // Reload invites and sessions to update UI in parallel
      await Promise.all([loadInvites(), loadUserSessions(false)]);
    } catch (error) {
      console.error("Error declining invite:", error);
      Alert.alert("Error", "Failed to decline invite. Please try again.");
    } finally {
      setProcessingInviteId(null);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("collaboration_invites")
        .update({ status: "cancelled" })
        .eq("id", inviteId)
        .eq("inviter_id", user.id);

      if (error) {
        console.error("Error cancelling invite:", error);
        return;
      }

      // Reload invites
      await loadInvites();
    } catch (error) {
      console.error("Error cancelling invite:", error);
    }
  };

  const handleJoinSession = async (sessionId: string, sessionName: string) => {
    if (!user?.id) {
      console.error("No user logged in");
      return;
    }

    try {
      const sessionServiceModule = await import("../services/sessionService");
      const { SessionService } = sessionServiceModule;
      const result = await SessionService.switchToSession(user.id, sessionId);

      if (result.success && result.session) {
        // Mode is already updated optimistically in SessionsTab
        // Close modal immediately so user sees "Active" state
        onClose();
        // Reload sessions in background without showing loader
        loadUserSessions(false).catch((error) => {
          console.error("Error reloading sessions:", error);
        });
      } else {
        // Revert mode change on error
        onModeChange("solo");
        // Show error to user
        Alert.alert(
          "Failed to Switch Session",
          result.error || "Unable to switch to this session. Please try again."
        );
      }
    } catch (error: unknown) {
      console.error("Error joining session:", error);
      // Revert mode change on error
      onModeChange("solo");
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to switch session. Please try again."
      );
    }
  };

  const handleLeaveSession = async (sessionId: string) => {
    if (!user?.id) return;

    try {
      const sessionServiceModule = await import("../services/sessionService");
      const { SessionService } = sessionServiceModule;
      const result = await SessionService.switchToSolo();

      if (result.success) {
        onModeChange("solo");
        // Reload sessions to reflect the change
        await loadUserSessions();
      } else {
        Alert.alert(
          "Failed to Leave Session",
          result.error || "Unable to leave session. Please try again."
        );
      }
    } catch (error: unknown) {
      console.error("Error leaving session:", error);
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to leave session. Please try again."
      );
    }
  };

  const handleCreateSession = async (sessionData: { id: string; name: string; status: string; createdBy: string; createdAt: string }) => {
    if (!user?.id) {
      console.error("No user logged in");
      return;
    }

    if (onCreateSession) {
      await onCreateSession(sessionData);
    }

    // Reload sessions and invites in parallel
    await Promise.all([loadUserSessions(false), loadInvites()]);

    // Don't close the modal - let user continue working
    // Switch to invites tab and show the "Sent" tab
    setInvitesTabType("sent");
    setActiveTab("invites");
  };

  const handleStartCollaboration = () => {
    setActiveTab("create");
  };

  // Use real sessions from database only
  const activeSessions = userSessions;

  const pendingSessions: CollaborationSession[] = [];

  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.sheetOverlay}>
        {/* Tap backdrop to close */}
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />

        <View style={[styles.sheetContent, { height: SHEET_HEIGHT, paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Drag Handle */}
          <View style={styles.dragHandleContainer}>
            <View style={styles.dragHandle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>Collaboration Mode</Text>
              <Text style={styles.headerSubtitle}>
                {activeTab === "create"
                  ? "Create a new session"
                  : activeTab === "invites"
                  ? "Manage your invites"
                  : "Manage your active sessions"}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              onPress={() => setActiveTab("sessions")}
              style={[styles.tab, activeTab === "sessions" && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "sessions" && styles.tabTextActive,
                ]}
              >
                Sessions
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("invites")}
              style={[styles.tab, activeTab === "invites" && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "invites" && styles.tabTextActive,
                ]}
              >
                Invites
              </Text>
              {receivedInvites.length > 0 && (
                <View style={styles.tabNotificationDot} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("create")}
              style={[styles.tab, activeTab === "create" && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "create" && styles.tabTextActive,
                ]}
              >
                Create
              </Text>
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
            showsVerticalScrollIndicator={false}
            bounces={true}
            keyboardShouldPersistTaps="handled"
          >
            {activeTab === "sessions" && (
              <SessionsTab
                currentMode={currentMode}
                onModeChange={onModeChange}
                onJoinSession={handleJoinSession}
                onLeaveSession={handleLeaveSession}
                onNavigateToBoard={onNavigateToBoard}
                onStartCollaboration={handleStartCollaboration}
                activeSessions={activeSessions}
                pendingSessions={pendingSessions}
                onCreateSession={() => setActiveTab("create")}
                isLoading={loadingSessions}
              />
            )}
            {activeTab === "invites" && (
              <InvitesTab
                sentInvites={sentInvites}
                receivedInvites={receivedInvites}
                onAcceptInvite={handleAcceptInvite}
                onDeclineInvite={handleDeclineInvite}
                onCancelInvite={handleCancelInvite}
                onCreateSession={() => setActiveTab("create")}
                hasActiveSessions={activeSessions.length > 0}
                initialTab={invitesTabType}
                processingInviteId={processingInviteId}
              />
            )}
            {activeTab === "create" && (
              canCreateSession ? (
                <CreateSessionContent
                  isEmbedded={true}
                  preSelectedFriend={preSelectedFriend ? {
                    id: preSelectedFriend.id,
                    name: preSelectedFriend.name,
                    username: preSelectedFriend.username,
                    avatar: preSelectedFriend.avatar,
                  } : null}
                  onCreateSession={handleCreateSession}
                  onNavigateToInvites={() => setActiveTab("invites")}
                />
              ) : (
                <View style={styles.lockedCreateSection}>
                  <Ionicons name="lock-closed" size={48} color="#9CA3AF" />
                  <Text style={styles.lockedTitle}>
                    Session Limit Reached
                  </Text>
                  <Text style={styles.lockedSubtitle}>
                    You've used {currentSessionCount} of {maxSessions} session{maxSessions === 1 ? '' : 's'} on your plan.
                  </Text>
                  <TouchableOpacity
                    style={styles.upgradeButton}
                    onPress={() => {
                      setPaywallFeature('session_creation');
                      setShowPaywall(true);
                    }}
                  >
                    <Text style={styles.upgradeButtonText}>Upgrade for More Sessions</Text>
                  </TouchableOpacity>
                </View>
              )
            )}
          </ScrollView>

          <CustomPaywallScreen
            isVisible={showPaywall}
            onClose={() => setShowPaywall(false)}
            userId={user?.id ?? ''}
            feature={paywallFeature}
            initialTier="pro"
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "flex-end",
  },
  backdropTouch: {
    flex: 1,
  },
  sheetContent: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 24,
  },
  dragHandleContainer: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 2,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  tabsContainer: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  tabActive: {
    backgroundColor: "#eb7825",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#6B7280",
  },
  tabTextActive: {
    color: "#ffffff",
  },
  tabNotificationDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    backgroundColor: "#EF4444",
    borderRadius: 4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingVertical: 16,
    paddingBottom: 40,
  },
  lockedCreateSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  lockedTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginTop: 16,
    marginBottom: 8,
  },
  lockedSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  upgradeButton: {
    backgroundColor: '#f97316',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  upgradeButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
