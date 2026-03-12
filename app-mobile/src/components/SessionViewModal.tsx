import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  StatusBar,
  Platform,
  Image,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useBoardSession } from "../hooks/useBoardSession";
import { useSessionVoting } from "../hooks/useSessionVoting";
import { useSessionStatus } from "../hooks/useSessionStatus";
import { useCollaborationCalendar } from "../hooks/useCollaborationCalendar";
import { supabase } from "../services/supabase";
import { realtimeService } from "../services/realtimeService";
import { useAppStore } from "../store/appStore";
import { useNetworkMonitor } from "../services/networkMonitor";
import { BoardCache } from "../services/boardCache";
import { BoardMessageService } from "../services/boardMessageService";
import { BoardErrorHandler } from "../services/boardErrorHandler";
import { Participant } from "./board/ParticipantAvatars";
import { BoardTabs, BoardTab } from "./board/BoardTabs";
import { SwipeableSessionCards } from "./board/SwipeableSessionCards";
import { BoardDiscussionTab } from "./board/BoardDiscussionTab";
import { BoardSettingsDropdown } from "./board/BoardSettingsDropdown";
import { ManageBoardModal } from "./board/ManageBoardModal";
import { InviteParticipantsModal } from "./board/InviteParticipantsModal";
import { CardDiscussionModal } from "./board/CardDiscussionModal";
import ExpandedCardModal from "./ExpandedCardModal";
import { ExpandedCardData } from "../types/expandedCardTypes";
import ShareModal from "./ShareModal";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

interface SavedCard {
  id: string;
  saved_card_id?: string;
  session_id: string;
  saved_by: string;
  saved_at: string;
  experience_id?: string | null;
  saved_experience_id?: string | null;
  card_data?: any;
  experience_data?: any;
}

interface SessionViewModalProps {
  visible: boolean;
  sessionId: string;
  sessionName: string;
  sessionInitials: string;
  onClose: () => void;
  onSessionDeleted?: () => void;
  onSessionExited?: () => void;
}

export default function SessionViewModal({
  visible,
  sessionId,
  sessionName,
  sessionInitials,
  onClose,
  onSessionDeleted,
  onSessionExited,
}: SessionViewModalProps) {
  const insets = useSafeAreaInsets();
  const {
    session,
    loading: sessionLoading,
    error: sessionError,
    loadSession,
  } = useBoardSession(sessionId);
  const { user, profile } = useAppStore();
  const networkState = useNetworkMonitor();

  // Account preferences state (for currency display)
  const [accountPreferences, setAccountPreferences] = useState<{
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  }>({ currency: "USD", measurementSystem: "Imperial" });

  // Tab state
  const [activeTab, setActiveTab] = useState<BoardTab>("saved");

  // Data states
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);

  // Permission states
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Settings dropdown state
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [showManageMembersModal, setShowManageMembersModal] = useState(false);
  const [showInviteParticipantsModal, setShowInviteParticipantsModal] = useState(false);

  // Card discussion modal state
  const [selectedCardForDiscussion, setSelectedCardForDiscussion] = useState<{
    savedCardId: string;
    cardTitle: string;
  } | null>(null);

  // Expanded card modal state
  const [selectedCardForExpansion, setSelectedCardForExpansion] = useState<ExpandedCardData | null>(null);
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);

  // Share modal state
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareData, setShareData] = useState<{ experienceData: any; dateTimePreferences: any } | null>(null);

  const [cardMessageCounts, setCardMessageCounts] = useState<Record<string, number>>({});

  // Pagination
  const [savedCardsPage, setSavedCardsPage] = useState(0);
  const [hasMoreCards, setHasMoreCards] = useState(true);
  const CARDS_PER_PAGE = 20;

  // Load saved cards
  const loadSavedCards = useCallback(
    async (page: number = 0, append: boolean = false) => {
      if (!sessionId) return;

      const cacheKey = BoardCache.getSavedCardsKey(sessionId, page);
      const cached = await BoardCache.get<any[]>(cacheKey);
      if (cached && !append) {
        setSavedCards(cached);
        setLoadingCards(false);
      }

      setLoadingCards(true);
      try {
        const { data, error } = await supabase
          .from("board_saved_cards")
          .select("*")
          .eq("session_id", sessionId)
          .order("saved_at", { ascending: false })
          .range(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE - 1);

        if (error) {
          const boardError = BoardErrorHandler.handleNetworkError(error);
          BoardErrorHandler.showError(boardError, () => loadSavedCards(page, append));
          return;
        }

        await BoardCache.set(cacheKey, data || [], 2 * 60 * 1000);

        if (append) {
          setSavedCards((prev) => [...prev, ...(data || [])]);
        } else {
          setSavedCards(data || []);
        }

        setHasMoreCards((data || []).length === CARDS_PER_PAGE);
        setSavedCardsPage(page);
      } catch (err: any) {
        console.error("Error loading saved cards:", err);
        const boardError = BoardErrorHandler.handleNetworkError(err);
        BoardErrorHandler.showError(boardError);
      } finally {
        setLoadingCards(false);
      }
    },
    [sessionId]
  );

  // Load participants
  const loadParticipants = useCallback(async () => {
    if (!sessionId) return;

    try {
      const { data, error } = await supabase
        .from("session_participants")
        .select(`
          *,
          profiles (
            id,
            username,
            display_name,
            first_name,
            last_name,
            avatar_url
          )
        `)
        .eq("session_id", sessionId);

      if (error) throw error;
      setParticipants((data || []) as Participant[]);
    } catch (err: any) {
      console.error("Error loading participants:", err);
    }
  }, [sessionId]);

  // Load unread message count
  const loadUnreadCount = useCallback(async () => {
    if (!sessionId || !user?.id) return;

    try {
      const { count, error } = await BoardMessageService.getUnreadBoardMessagesCount(
        sessionId,
        user.id
      );

      if (error) {
        console.warn("Error loading unread count:", error);
        setUnreadMessages(0);
        return;
      }

      setUnreadMessages(count || 0);
    } catch (err: any) {
      console.error("Error loading unread count:", err);
      setUnreadMessages(0);
    }
  }, [sessionId, user?.id]);

  // Load card message counts
  const loadCardMessageCounts = useCallback(async () => {
    if (!sessionId || !user?.id || savedCards.length === 0) return;

    try {
      const savedCardIds = savedCards.map((c) => c.id);
      const { data, error } = await supabase
        .from("board_card_messages")
        .select("saved_card_id")
        .eq("session_id", sessionId)
        .in("saved_card_id", savedCardIds)
        .is("deleted_at", null);

      if (error) return;

      const counts: Record<string, number> = {};
      savedCardIds.forEach((cardId) => {
        counts[cardId] = (data || []).filter((m) => m.saved_card_id === cardId).length;
      });

      setCardMessageCounts(counts);
    } catch (err: any) {
      console.error("Error loading card message counts:", err);
    }
  }, [sessionId, user?.id, savedCards]);

  // Handle exit board
  const handleExitBoard = useCallback(async () => {
    if (!user?.id || !sessionId) return;

    Alert.alert(
      "Exit Board",
      "Are you sure you want to exit this board? You will no longer receive updates or be able to participate.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Exit",
          style: "destructive",
          onPress: async () => {
            try {
              const { error: participantDeleteError } = await supabase
                .from("session_participants")
                .delete()
                .eq("session_id", sessionId)
                .eq("user_id", user.id);

              if (participantDeleteError) {
                throw participantDeleteError;
              }

              // Look up board_id from the session (the actual relationship)
              // collaboration_sessions.board_id points to boards.id
              const { data: sessionRow, error: sessionLookupError } = await supabase
                .from("collaboration_sessions")
                .select("board_id")
                .eq("id", sessionId)
                .single();

              if (sessionLookupError) {
                console.warn("Error looking up session board on exit:", sessionLookupError);
              }

              const boardIds = sessionRow?.board_id ? [sessionRow.board_id] : [];
              if (boardIds.length > 0) {
                const { error: collaboratorDeleteError } = await supabase
                  .from("board_collaborators")
                  .delete()
                  .eq("user_id", user.id)
                  .in("board_id", boardIds);

                if (collaboratorDeleteError) {
                  console.warn("Error removing board collaborator on exit:", collaboratorDeleteError);
                }
              }

              await supabase
                .from("collaboration_invites")
                .update({ status: "declined", updated_at: new Date().toISOString() })
                .eq("session_id", sessionId)
                .eq("invitee_id", user.id)
                .eq("status", "pending");

              if (onSessionExited) onSessionExited();
              onClose();
            } catch (error: any) {
              console.error("Error exiting board:", error);
              Alert.alert(
                "Unable to Exit Board",
                error?.message || "Please try again."
              );
            }
          },
        },
      ]
    );
  }, [user?.id, sessionId, onClose, onSessionExited]);

  // Validate session and permissions on mount
  useEffect(() => {
    if (!visible) return;

    const validateSession = async () => {
      if (!sessionId || !user?.id) return;

      const validityCheck = await BoardErrorHandler.checkSessionValidity(sessionId);
      setSessionValid(validityCheck.valid);

      if (!validityCheck.valid && validityCheck.error) {
        BoardErrorHandler.showError(validityCheck.error);
        return;
      }

      const permissionCheck = await BoardErrorHandler.checkSessionPermission(sessionId, user.id);
      setHasPermission(permissionCheck.hasPermission);
      setIsAdmin(permissionCheck.isAdmin || false);

      if (!permissionCheck.hasPermission && permissionCheck.error) {
        BoardErrorHandler.showError(permissionCheck.error);
      }
    };

    validateSession();
  }, [visible, sessionId, user?.id]);

  // Load data when modal opens
  useEffect(() => {
    if (visible && sessionValid && hasPermission) {
      loadSavedCards(0, false);
      loadParticipants();
      loadUnreadCount();
    }
  }, [visible, sessionValid, hasPermission, loadSavedCards, loadParticipants, loadUnreadCount]);

  // Load card message counts when saved cards change
  useEffect(() => {
    if (savedCards.length > 0) {
      loadCardMessageCounts();
    }
  }, [savedCards, loadCardMessageCounts]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!visible || !sessionId) return;

    const channel = realtimeService.subscribeToBoardSession(sessionId, {
      onCardSaved: (card) => {
        setSavedCards((prev) => {
          if (prev.some((c) => c.id === card.id)) return prev;
          return [card, ...prev];
        });
        loadCardMessageCounts();
      },
      onMessage: () => {
        loadUnreadCount();
        loadCardMessageCounts();
      },
      onCardMessage: () => loadCardMessageCounts(),
      onParticipantJoined: () => loadParticipants(),
      onParticipantLeft: () => loadParticipants(),
    });

    return () => {
      realtimeService.unsubscribe(`board_session:${sessionId}`);
    };
  }, [visible, sessionId, loadSavedCards, loadUnreadCount, loadParticipants, loadCardMessageCounts]);

  // Load account preferences on mount
  useEffect(() => {
    const loadAccountPreferences = async () => {
      try {
        // First try to get from profile
        if (profile?.currency || profile?.measurement_system) {
          setAccountPreferences({
            currency: profile.currency || "USD",
            measurementSystem: (profile.measurement_system === "metric" ? "Metric" : "Imperial") as "Metric" | "Imperial",
          });
          return;
        }
        
        // Fallback to AsyncStorage
        const stored = await AsyncStorage.getItem("mingla_account_preferences");
        if (stored) {
          const parsed = JSON.parse(stored);
          setAccountPreferences({
            currency: parsed.currency || "USD",
            measurementSystem: (parsed.measurementSystem as "Metric" | "Imperial") || "Imperial",
          });
        }
      } catch (error) {
        console.error("Error loading account preferences:", error);
      }
    };
    
    loadAccountPreferences();
  }, [profile]);

  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setActiveTab("saved");
      setSavedCards([]);
      setParticipants([]);
      setUnreadMessages(0);
      setCardMessageCounts({});
      setSessionValid(null);
      setHasPermission(null);
      setIsAdmin(false);
    }
  }, [visible]);

  const activeParticipantsCount = participants.filter((p) => p.has_accepted).length;

  // Phase 2 hooks: voting, session status, calendar
  const {
    voteCounts,
    rsvpCounts,
    lockedCards,
    handleVote,
    handleRSVP,
    loadCounts: loadVoteAndRSVPCounts,
  } = useSessionVoting(sessionId, user?.id, activeParticipantsCount);

  const {
    status: sessionStatus,
    canVote,
    canRSVP,
    isLocked: isSessionLocked,
    advanceToVoting,
    markCompleted,
    isCreator,
  } = useSessionStatus(sessionId, session?.created_by, user?.id);

  const {
    lockedCalendarEntry,
    syncToDeviceCalendar,
    showCalendarPrompt,
    dismissCalendarPrompt,
  } = useCollaborationCalendar(sessionId, user?.id);

  const showNetworkBanner = !networkState.isConnected;

  const handleViewCardDetails = (card: SavedCard) => {
    const cardData = card.card_data || card.experience_data || null;

    const hasValidCardData =
      cardData && typeof cardData === "object" && (cardData.title || cardData.description || cardData.name);

    if (!hasValidCardData) {
      Alert.alert(
        "Card Unavailable",
        "This experience is no longer available. It may have been removed or is temporarily inaccessible.",
        [{ text: "OK" }]
      );
      return;
    }

    if (!networkState.isConnected && !hasValidCardData) {
      Alert.alert(
        "Offline",
        "Unable to load card details. Please check your internet connection and try again.",
        [{ text: "OK" }]
      );
      return;
    }

    const expandedCardData: ExpandedCardData = {
      id: cardData.id || card.id,
      placeId: cardData.placeId || card.id,
      title: cardData.title || "Untitled Experience",
      category: cardData.category || "Experience",
      categoryIcon: cardData.categoryIcon || "star",
      description: cardData.description || "",
      fullDescription: cardData.fullDescription || cardData.description || "",
      image: cardData.image || "",
      images: cardData.images || [cardData.image].filter(Boolean),
      rating: cardData.rating || 4.5,
      reviewCount: cardData.reviewCount || 0,
      priceRange: cardData.priceRange || "N/A",
      distance: cardData.distance || "",
      travelTime: cardData.travelTime || "N/A",
      address: cardData.address || "",
      openingHours: cardData.openingHours,
      phone: cardData.phone,
      website: cardData.website,
      highlights: cardData.highlights || [],
      tags: cardData.tags || [],
      matchScore: cardData.matchScore || 0,
      matchFactors: cardData.matchFactors || {
        location: 0,
        budget: 0,
        category: 0,
        time: 0,
        popularity: 0,
      },
      socialStats: {
        views: cardData.socialStats?.views || 0,
        likes: cardData.socialStats?.likes || 0,
        saves: cardData.socialStats?.saves || 0,
        shares: cardData.socialStats?.shares || 0,
      },
      location: cardData.location || (cardData.lat && cardData.lng ? { lat: cardData.lat, lng: cardData.lng } : undefined),
      selectedDateTime: cardData.selectedDateTime || new Date(),
      strollData: cardData.strollData,
      picnicData: cardData.picnicData,
      // Curated card fields
      ...(cardData.cardType === 'curated' ? {
        cardType: cardData.cardType,
        stops: cardData.stops,
        tagline: cardData.tagline,
        totalPriceMin: cardData.totalPriceMin,
        totalPriceMax: cardData.totalPriceMax,
        estimatedDurationMinutes: cardData.estimatedDurationMinutes,
        pairingKey: cardData.pairingKey,
        experienceType: cardData.experienceType,
        shoppingList: cardData.shoppingList,
      } : {}),
    };

    setSelectedCardForExpansion(expandedCardData);
    setIsExpandedModalVisible(true);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalOverlay}>
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <View style={styles.modalContent}>
          <SafeAreaView style={[styles.container, { paddingBottom: insets.bottom }]} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="dark-content" />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#6B7280" />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {sessionName || session?.name || "Session"}
            </Text>
            <View style={styles.headerParticipantsRow}>
              <View style={styles.participantAvatarsSmall}>
                {participants
                  .filter((p) => p.has_accepted)
                  .slice(0, 4)
                  .map((p, index) => {
                    // Generate a color based on the user's id
                    const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];
                    const colorIndex = p.user_id ? p.user_id.charCodeAt(0) % colors.length : index % colors.length;
                    
                    // Get initials from profile
                    let initials = "?";
                    if (p.profiles?.display_name) {
                      const parts = p.profiles.display_name.trim().split(" ");
                      initials = parts.length >= 2 
                        ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
                        : p.profiles.display_name.substring(0, 2).toUpperCase();
                    } else if (p.profiles?.first_name) {
                      initials = p.profiles.last_name 
                        ? `${p.profiles.first_name[0]}${p.profiles.last_name[0]}`.toUpperCase()
                        : p.profiles.first_name.substring(0, 2).toUpperCase();
                    } else if (p.profiles?.username) {
                      initials = p.profiles.username.substring(0, 2).toUpperCase();
                    }
                    
                    // Check if profile picture exists
                    const profilePictureUrl = p.profiles?.avatar_url?.trim() || "";
                    const hasProfilePicture = profilePictureUrl !== "";
                    
                    return (
                      <View
                        key={p.id}
                        style={[
                          styles.miniAvatar,
                          index > 0 && { marginLeft: -6 },
                        ]}
                      >
                        {hasProfilePicture ? (
                          <Image
                            source={{ uri: profilePictureUrl }}
                            style={styles.miniAvatarImage}
                          />
                        ) : (
                          <View style={[styles.miniAvatarInitials, { backgroundColor: colors[colorIndex] }]}>
                            <Text style={styles.miniAvatarText}>{initials}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
              </View>
              <Text style={styles.headerSubtitle}>
                {activeParticipantsCount} active
              </Text>
            </View>
          </View>

          <TouchableOpacity onPress={() => setShowSettingsDropdown(true)} style={styles.settingsButton}>
            <Ionicons name="ellipsis-vertical" size={20} color="#374151" />
          </TouchableOpacity>
        </View>

        {/* Network Banner */}
        {showNetworkBanner && (
          <View style={styles.networkBanner}>
            <Ionicons name="wifi-outline" size={16} color="white" />
            <Text style={styles.networkBannerText}>No internet connection</Text>
          </View>
        )}

        {/* Loading State */}
        {(sessionLoading || sessionValid === null || hasPermission === null) && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#eb7825" />
            <Text style={styles.loadingText}>Loading session...</Text>
          </View>
        )}

        {/* Error State */}
        {!sessionLoading && (sessionError || !sessionValid || !hasPermission) && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={48} color="#FF3B30" />
            <Text style={styles.errorText}>
              {sessionError || (!sessionValid ? "Session is no longer available." : "You don't have access to this session.")}
            </Text>
            <TouchableOpacity style={styles.closeErrorButton} onPress={onClose}>
              <Text style={styles.closeErrorButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Main Content */}
        {!sessionLoading && sessionValid && hasPermission && (
          <>
            {/* Session Status Row */}
            {session && (
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        sessionStatus === 'locked'
                          ? '#10B981'
                          : sessionStatus === 'voting'
                          ? '#F59E0B'
                          : sessionStatus === 'completed'
                          ? '#6B7280'
                          : '#3B82F6',
                    },
                  ]}
                >
                  <Text style={styles.statusBadgeText}>
                    {sessionStatus.charAt(0).toUpperCase() + sessionStatus.slice(1)}
                  </Text>
                </View>
                {isCreator && sessionStatus === 'active' && (
                  <TouchableOpacity style={styles.statusActionButton} onPress={advanceToVoting}>
                    <Text style={styles.statusActionText}>Start Voting</Text>
                  </TouchableOpacity>
                )}
                {isCreator && sessionStatus === 'locked' && (
                  <TouchableOpacity style={styles.statusActionButton} onPress={markCompleted}>
                    <Text style={styles.statusActionText}>Mark Complete</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <BoardTabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              savedCount={savedCards.length}
              unreadMessages={unreadMessages}
            />

            <View style={styles.content}>
              {activeTab === "saved" && (
                <View style={styles.savedContainer}>
                  <SwipeableSessionCards
                    cards={savedCards}
                    sessionId={sessionId}
                    userId={user?.id}
                    participantCount={activeParticipantsCount}
                    onViewDetails={handleViewCardDetails}
                    loading={loadingCards}
                    accountPreferences={accountPreferences}
                  />
                </View>
              )}

              {activeTab === "discussion" && (
                <BoardDiscussionTab
                  sessionId={sessionId}
                  participants={participants}
                  onUnreadCountChange={loadUnreadCount}
                />
              )}
            </View>
          </>
        )}

        {/* Board Settings Dropdown */}
        <BoardSettingsDropdown
          visible={showSettingsDropdown}
          onClose={() => setShowSettingsDropdown(false)}
          sessionId={sessionId}
          sessionName={sessionName || session?.name || ""}
          sessionCreatorId={session?.created_by}
          currentUserId={user?.id}
          isAdmin={isAdmin}
          notificationsEnabled={notificationsEnabled}
          onToggleNotifications={() => setNotificationsEnabled(!notificationsEnabled)}
          onManageMembers={() => setShowManageMembersModal(true)}
          onInviteParticipants={() => setShowInviteParticipantsModal(true)}
          onExitBoard={handleExitBoard}
          onSessionDeleted={() => {
            if (onSessionDeleted) onSessionDeleted();
            onClose();
          }}
          onSessionNameUpdated={(newName) => {
            loadSession(sessionId);
          }}
          variant="overlay"
        />

        {/* Manage Board Modal */}
        <ManageBoardModal
          visible={showManageMembersModal}
          sessionId={sessionId}
          sessionName={sessionName || session?.name || "Board"}
          sessionCreatorId={session?.created_by}
          participants={participants}
          onClose={() => setShowManageMembersModal(false)}
          onExitBoard={handleExitBoard}
          onParticipantsChange={loadParticipants}
        />

        {/* Invite Participants Modal */}
        <InviteParticipantsModal
          visible={showInviteParticipantsModal}
          sessionId={sessionId}
          sessionName={sessionName || session?.name || "Board"}
          existingParticipantIds={participants.map((p) => p.user_id)}
          onClose={() => setShowInviteParticipantsModal(false)}
          onInvitesSent={loadParticipants}
        />

        {/* Card Discussion Modal */}
        {selectedCardForDiscussion && (
          <CardDiscussionModal
            visible={!!selectedCardForDiscussion}
            sessionId={sessionId}
            savedCardId={selectedCardForDiscussion.savedCardId}
            cardTitle={selectedCardForDiscussion.cardTitle}
            participants={participants}
            onClose={() => setSelectedCardForDiscussion(null)}
          />
        )}

        {/* Expanded Card Modal */}
        {selectedCardForExpansion && (
          <ExpandedCardModal
            visible={isExpandedModalVisible}
            card={selectedCardForExpansion}
            onClose={() => {
              setIsExpandedModalVisible(false);
              setSelectedCardForExpansion(null);
            }}
            onSave={async () => {
              // Card is already saved in this board
            }}
            onShare={(card) => {
              setShareData({
                experienceData: card,
                dateTimePreferences: {
                  timeOfDay: "Afternoon",
                  dayOfWeek: "Weekend",
                  planningTimeframe: "This month",
                },
              });
              setShowShareModal(true);
            }}
            accountPreferences={accountPreferences}
            isSaved={true}
            currentMode={sessionName || "board"}
          />
        )}

        {/* Share Modal */}
        {showShareModal && shareData && (
          <ShareModal
            isOpen={showShareModal}
            onClose={() => {
              setShowShareModal(false);
              setShareData(null);
            }}
            experienceData={shareData.experienceData}
            dateTimePreferences={shareData.dateTimePreferences}
          />
        )}
        {/* Calendar Prompt Modal */}
        {showCalendarPrompt && lockedCalendarEntry && (
          <Modal visible={showCalendarPrompt} transparent animationType="fade">
            <View style={styles.calendarPromptOverlay}>
              <View style={styles.calendarPromptCard}>
                <Ionicons name="calendar" size={40} color="#10B981" />
                <Text style={styles.calendarPromptTitle}>Plan Locked In!</Text>
                <Text style={styles.calendarPromptText}>
                  Everyone is attending. Add this to your calendar?
                </Text>
                <TouchableOpacity
                  style={styles.calendarPromptButton}
                  onPress={() => syncToDeviceCalendar(lockedCalendarEntry)}
                >
                  <Text style={styles.calendarPromptButtonText}>Add to Calendar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.calendarPromptDismiss}
                  onPress={dismissCalendarPrompt}
                >
                  <Text style={styles.calendarPromptDismissText}>Maybe Later</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

// Modal height with proper centering - sits flush on bottom nav
const MODAL_HEIGHT = SCREEN_HEIGHT * 0.88; // 88% of screen height for premium centered experience
const MODAL_MARGIN_BOTTOM = 0; // 0px margin for flush positioning on Android

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContent: {
    height: MODAL_HEIGHT,
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 30,
    marginBottom: MODAL_MARGIN_BOTTOM,
  },
  container: {
    flex: 1,
    backgroundColor: "white",
    justifyContent: "flex-start",
    overflow: "hidden",
    paddingVertical: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "white",
    marginBottom: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginLeft: 4,
  },
  headerParticipantsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  participantAvatarsSmall: {
    flexDirection: "row",
    alignItems: "center",
  },
  miniAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  miniAvatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 9,
  },
  miniAvatarInitials: {
    width: "100%",
    height: "100%",
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  miniAvatarText: {
    fontSize: 7,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  settingsButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  networkBanner: {
    backgroundColor: "#FF9500",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    gap: 8,
  },
  networkBannerText: {
    color: "white",
    fontSize: 13,
    fontWeight: "500",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: "#666",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: "#FF3B30",
    textAlign: "center",
    fontWeight: "500",
  },
  closeErrorButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  closeErrorButtonText: {
    fontSize: 16,
    color: "white",
    fontWeight: "600",
  },
  content: {
    flex: 1,
    paddingTop: 16,
    paddingBottom: 28,
    paddingHorizontal: 8,
    backgroundColor: "white",
    overflow: "visible",
  },
  savedContainer: {
    flex: 1,
    marginTop: 0,
    paddingHorizontal: 8,
    paddingBottom: 28,
    backgroundColor: "white",
    overflow: "visible",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  statusActionButton: {
    backgroundColor: "#eb7825",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusActionText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  calendarPromptOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  calendarPromptCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    width: "100%",
    maxWidth: 320,
    gap: 12,
  },
  calendarPromptTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1e293b",
  },
  calendarPromptText: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
  },
  calendarPromptButton: {
    backgroundColor: "#10B981",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    width: "100%",
    alignItems: "center",
    marginTop: 4,
  },
  calendarPromptButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  calendarPromptDismiss: {
    paddingVertical: 8,
  },
  calendarPromptDismissText: {
    color: "#9CA3AF",
    fontSize: 14,
    fontWeight: "500",
  },
});
