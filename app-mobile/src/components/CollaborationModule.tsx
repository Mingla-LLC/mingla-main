import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import SessionsTab from "./collaboration/SessionsTab";
import InvitesTab from "./collaboration/InvitesTab";
import CreateTab from "./collaboration/CreateTab";
import { supabase } from "../services/supabase";
import { useAppStore } from "../store/appStore";
import { useFriends } from "../hooks/useFriends";

interface Friend {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  status: "online" | "offline";
  lastActive?: string;
}

interface CollaborationInvite {
  id: string;
  sessionName: string;
  fromUser: Friend;
  toUser: Friend;
  status: "pending" | "accepted" | "declined" | "canceled";
  createdAt: string;
  expiresAt?: string;
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

interface CollaborationModuleProps {
  isOpen: boolean;
  onClose: () => void;
  currentMode: "solo" | string;
  onModeChange: (mode: "solo" | string) => void;
  preSelectedFriend?: Friend | null;
  boardsSessions?: any[];
  onUpdateBoardSession?: (updatedBoard: any) => void;
  onCreateSession?: (newSession: any) => void;
  onNavigateToBoard?: (board: any, discussionTab?: string) => void;
  availableFriends?: Friend[];
}

// Mock data
const mockFriends: Friend[] = [
  { id: "1", name: "Sarah Chen", status: "online" },
  { id: "2", name: "Marcus Johnson", status: "online" },
  { id: "3", name: "Alex Rivera", status: "offline", lastActive: "2h ago" },
  { id: "4", name: "Jamie Park", status: "online" },
  { id: "5", name: "Taylor Kim", status: "offline", lastActive: "1d ago" },
  { id: "6", name: "Jordan Lee", status: "online" },
];

const mockSentInvites: CollaborationInvite[] = [
  {
    id: "sent-1",
    sessionName: "Weekend Fun Squad",
    fromUser: { id: "me", name: "You", status: "online" },
    toUser: mockFriends[0],
    status: "pending",
    createdAt: "2h ago",
    expiresAt: "22h",
  },
  {
    id: "sent-2",
    sessionName: "Coffee Hunters",
    fromUser: { id: "me", name: "You", status: "online" },
    toUser: mockFriends[2],
    status: "pending",
    createdAt: "1d ago",
    expiresAt: "12h",
  },
];

const mockReceivedInvites: CollaborationInvite[] = [
  {
    id: "recv-1",
    sessionName: "Date Night Planning",
    fromUser: mockFriends[1],
    toUser: { id: "me", name: "You", status: "online" },
    status: "pending",
    createdAt: "30m ago",
  },
  {
    id: "recv-2",
    sessionName: "Adventure Squad",
    fromUser: mockFriends[3],
    toUser: { id: "me", name: "You", status: "online" },
    status: "pending",
    createdAt: "4h ago",
  },
];

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
}: CollaborationModuleProps) {
  const [activeTab, setActiveTab] = useState<"sessions" | "invites" | "create">(
    "sessions"
  );
  const [invitesTabType, setInvitesTabType] = useState<"sent" | "received">("received");
  const { user } = useAppStore();
  const {
    friends: dbFriends,
    fetchFriends,
    friendRequests,
    loadFriendRequests,
  } = useFriends();
  const [receivedInvites, setReceivedInvites] = useState<any[]>([]);
  const [sentInvites, setSentInvites] = useState<any[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [userSessions, setUserSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

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

  // Transform database friends to match CreateTab's Friend interface
  const transformedFriends: Friend[] = React.useMemo(() => {
    return dbFriends.map((friend) => ({
      id: friend.friend_user_id || friend.id,
      name:
        friend.display_name ||
        `${friend.first_name || ""} ${friend.last_name || ""}`.trim() ||
        friend.username ||
        "Unknown",
      username: friend.username,
      avatar: friend.avatar_url,
      status: "offline" as const, // Default to offline, can be enhanced with presence later
      mutualFriends: 0, // Can be calculated later if needed
    }));
  }, [dbFriends]);

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
          profiles!collaboration_invites_invited_by_fkey(id, display_name, email, avatar_url)
        `
        )
        .eq("invited_user_id", user.id)
        .eq("status", "pending")
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
            invitesWithSessions.forEach((inv: any) => {
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
              participants.forEach((p: any) => {
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
              id: profileData?.id || invite.invited_by,
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
        .eq("invited_by", user.id)
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

      // Get all sessions where user is a participant
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

      const sessionIds = participations?.map((p) => p.session_id) || [];

      if (sessionIds.length === 0) {
        setUserSessions([]);
        if (showLoader) {
          setLoadingSessions(false);
        }
        return;
      }

      // Load session details - simplified query first
      const { data: sessions, error: sessionsError } = await supabase
        .from("collaboration_sessions")
        .select("*")
        .in("id", sessionIds)
        .in("status", ["active", "voting", "locked"])
        .order("created_at", { ascending: false });

      if (sessionsError) {
        console.error("Error loading sessions:", sessionsError);
        setUserSessions([]);
        if (showLoader) {
          setLoadingSessions(false);
        }
        return;
      }

      // Load participants separately for better reliability
      // Only load participants who have accepted the invite
      let allParticipants: any[] = [];
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
            .in("session_id", sessionIds)
            .eq("has_accepted", true);

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
        // Get participants for this session
        const sessionParticipants = allParticipants.filter(
          (p) => p.session_id === session.id
        );
        const participants = sessionParticipants.map((p: any) => ({
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
          pendingParticipants: 0,
          boardCards: sessionCardCounts[session.id] || 0,
          admins: session.admins || [],
        };
      });

      setUserSessions(formattedSessions);
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

    try {
      // First, fetch the invite details to get session info and inviter ID
      const { data: invite, error: fetchError } = await supabase
        .from("collaboration_invites")
        .select(
          `
          id,
          session_id,
          invited_by,
          invited_user_id,
          collaboration_sessions!inner(name)
        `
        )
        .eq("id", inviteId)
        .eq("invited_user_id", user.id)
        .single();

      if (fetchError || !invite) {
        console.error("Error fetching invite details:", fetchError);
        return;
      }

      // Get session name from the join
      const sessionData = invite.collaboration_sessions as any;
      const sessionName = Array.isArray(sessionData)
        ? (sessionData[0] as any)?.name
        : (sessionData as any)?.name || "Session";

      // Update invite status
      const { error } = await supabase
        .from("collaboration_invites")
        .update({ status: "accepted" })
        .eq("id", inviteId)
        .eq("invited_user_id", user.id);

      if (error) {
        console.error("Error accepting invite:", error);
        return;
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

      // Create preference record for the accepting user
      const { error: preferencesError } = await supabase
        .from("board_session_preferences")
        .insert({
          session_id: invite.session_id,
          user_id: user.id,
          budget_min: 0,
          budget_max: 1000,
          categories: [],
          travel_mode: "walking",
          travel_constraint_type: "time",
          travel_constraint_value: 30,
        });

      if (preferencesError && preferencesError.code !== "23505") {
        // 23505 is unique violation - preferences might already exist, which is fine
        console.error("Error creating preferences for accepting user:", preferencesError);
        // Don't fail - preferences can be created later when user opens preferences sheet
      }

      // Call edge function to notify inviter
      try {
        const { data: notifyData, error: notifyError } =
          await supabase.functions.invoke("notify-invite-response", {
            body: {
              inviteId: inviteId,
              response: "accepted",
              inviterId: invite.invited_by,
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

      // Reload invites and sessions
      await loadInvites();
      await loadUserSessions();
    } catch (error) {
      console.error("Error accepting invite:", error);
    }
  };

  const handleDeclineInvite = async (inviteId: string) => {
    if (!user) return;

    try {
      // First, fetch the invite details to get session info and inviter ID
      const { data: invite, error: fetchError } = await supabase
        .from("collaboration_invites")
        .select(
          `
          id,
          session_id,
          invited_by,
          invited_user_id,
          collaboration_sessions!inner(name)
        `
        )
        .eq("id", inviteId)
        .eq("invited_user_id", user.id)
        .single();

      if (fetchError || !invite) {
        console.error("Error fetching invite details:", fetchError);
        return;
      }

      // Get session name from the join
      const sessionData = invite.collaboration_sessions as any;
      const sessionName = Array.isArray(sessionData)
        ? (sessionData[0] as any)?.name
        : (sessionData as any)?.name || "Session";

      // Update invite status
      const { error } = await supabase
        .from("collaboration_invites")
        .update({ status: "declined" })
        .eq("id", inviteId)
        .eq("invited_user_id", user.id);

      if (error) {
        console.error("Error declining invite:", error);
        return;
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
              inviterId: invite.invited_by,
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

      // Reload invites and sessions to update UI
      await loadInvites();
      await loadUserSessions();
    } catch (error) {
      console.error("Error declining invite:", error);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("collaboration_invites")
        .update({ status: "cancelled" })
        .eq("id", inviteId)
        .eq("invited_by", user.id);

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
        const { Alert } = await import("react-native");
        Alert.alert(
          "Failed to Switch Session",
          result.error || "Unable to switch to this session. Please try again."
        );
      }
    } catch (error: any) {
      console.error("Error joining session:", error);
      // Revert mode change on error
      onModeChange("solo");
      const { Alert } = await import("react-native");
      Alert.alert(
        "Error",
        error.message || "Failed to switch session. Please try again."
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
        const { Alert } = await import("react-native");
        Alert.alert(
          "Failed to Leave Session",
          result.error || "Unable to leave session. Please try again."
        );
      }
    } catch (error: any) {
      console.error("Error leaving session:", error);
      const { Alert } = await import("react-native");
      Alert.alert(
        "Error",
        error.message || "Failed to leave session. Please try again."
      );
    }
  };

  const handleCreateSession = async (sessionData: any) => {
    if (!user?.id) {
      console.error("No user logged in");
      return;
    }

    if (onCreateSession) {
      await onCreateSession(sessionData);
    }

    // Reload sessions to show the newly created one
    await loadUserSessions();
    // Also reload invites to show sent invites
    await loadInvites();

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

  const pendingSessions: any[] = []; // No pending sessions for now - can be added later if needed

  const styles = StyleSheet.create({
    modalContainer: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      justifyContent: "flex-end",
    },
    modalContent: {
      backgroundColor: "white",
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      width: "100%",
      maxHeight: "95%",
      minHeight: "90%",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 24,
      borderBottomWidth: 1,
      borderBottomColor: "#f3f4f6",
    },
    headerTitle: {
      fontSize: 24,
      fontWeight: "700",
      color: "#111827",
    },
    headerSubtitle: {
      fontSize: 14,
      color: "#6B7280",
      marginTop: 4,
    },
    closeButton: {
      padding: 8,
      borderRadius: 20,
    },
    tabsContainer: {
      flexDirection: "row",
      backgroundColor: "#F3F4F6",
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 16,
      paddingVertical: 8,
      gap: 8,
    },
    tab: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      borderRadius: 6,
    },
    tabActive: {
      backgroundColor: "#FFFFFF",
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
      fontSize: 15,
      fontWeight: "500",
      color: "#6B7280",
    },
    tabTextActive: {
      color: "#111827",
      fontWeight: "600",
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
      padding: 24,
      paddingBottom: 40,
    },
  });

  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View>
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
              <Ionicons name="close" size={24} color="#111827" />
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
            showsVerticalScrollIndicator={true}
            bounces={true}
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
              />
            )}
            {activeTab === "create" && (
              <CreateTab
                preSelectedFriend={preSelectedFriend}
                availableFriends={
                  transformedFriends.length > 0
                    ? transformedFriends
                    : availableFriends
                }
                onCreateSession={handleCreateSession}
                onNavigateToInvites={() => setActiveTab("invites")}
                onSessionCreated={loadUserSessions}
              />
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
