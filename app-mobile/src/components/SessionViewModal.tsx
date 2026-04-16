import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { Icon } from './ui/Icon';
import { useBoardSession } from "../hooks/useBoardSession";
import { useCollaborationCalendar } from "../hooks/useCollaborationCalendar";
import { supabase } from "../services/supabase";
import { realtimeService } from "../services/realtimeService";
import { useAppStore } from "../store/appStore";
import { useNetworkMonitor } from "../services/networkMonitor";
import { getDisplayName } from "../utils/getDisplayName";
import { BoardCache } from "../services/boardCache";
import { BoardMessageService } from "../services/boardMessageService";
import { BoardErrorHandler } from "../services/boardErrorHandler";
import { withTimeout } from "../utils/withTimeout";
import { showMutationError } from "../utils/showMutationError";
import { useTranslation } from 'react-i18next';
import { useToast } from "./ToastManager";
import { Participant } from "./board/ParticipantAvatars";
import { BoardTabs, BoardTab } from "./board/BoardTabs";
import { SwipeableSessionCards } from "./board/SwipeableSessionCards";
import { BoardDiscussionTab } from "./board/BoardDiscussionTab";
import { BoardSettingsDropdown } from "./board/BoardSettingsDropdown";
import { InviteParticipantsModal } from "./board/InviteParticipantsModal";
import { CardDiscussionModal } from "./board/CardDiscussionModal";
import ExpandedCardModal from "./ExpandedCardModal";
import { ExpandedCardData } from "../types/expandedCardTypes";
import ShareModal from "./ShareModal";
import { GestureHandlerRootView } from "react-native-gesture-handler";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

interface SavedCardData {
  id?: string;
  title?: string;
  name?: string;
  description?: string;
  fullDescription?: string;
  category?: string;
  categoryIcon?: string;
  image?: string;
  images?: string[];
  rating?: number;
  reviewCount?: number;
  priceLevel?: string;
  priceTier?: string;
  priceRange?: string;
  distance?: string;
  travelTime?: string;
  address?: string;
  location?: { lat: number; lng: number };
  lat?: number;
  lng?: number;
  placeId?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  website?: string;
  phone?: string;
  openingHours?: any;
  tags?: string[];
  highlights?: string[];
  matchScore?: number;
  matchFactors?: { location?: number; budget?: number; category?: number; time?: number; popularity?: number };
  socialStats?: { views?: number; likes?: number; saves?: number; shares?: number };
  selectedDateTime?: any;
  strollData?: any;
  picnicData?: any;
  // Curated card fields
  cardType?: string;
  stops?: any[];
  tagline?: string;
  totalPriceMin?: number;
  totalPriceMax?: number;
  estimatedDurationMinutes?: number;
  pairingKey?: string;
  experienceType?: string;
  shoppingList?: any;
}

interface SavedCard {
  id: string;
  saved_card_id?: string;
  session_id: string;
  saved_by: string;
  saved_at: string;
  experience_id?: string | null;
  saved_experience_id?: string | null;
  card_data?: SavedCardData;
  experience_data?: SavedCardData;
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
  const { t } = useTranslation(['modals', 'common']);
  const insets = useSafeAreaInsets();
  const {
    session,
    loading: sessionLoading,
    error: sessionError,
    sessionValid,
    hasPermission,
    isAdmin,
    loadSession,
  } = useBoardSession(sessionId);
  const { user, profile } = useAppStore();
  const { showToast } = useToast();
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
  const [unreadMessages, setUnreadMessages] = useState(0);

  // Participants derived from useBoardSession data — no separate query needed.
  const participants = (session?.participants || []) as Participant[];

  // Local display name — updates immediately on rename, falls back to prop/session
  const [localName, setLocalName] = useState(sessionName);
  useEffect(() => {
    setLocalName(sessionName || session?.name || "");
  }, [sessionName, session?.name]);

  // Settings dropdown state
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
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
  const [shareData, setShareData] = useState<{ experienceData: ExpandedCardData; dateTimePreferences: { timeOfDay: string; dayOfWeek: string; planningTimeframe: string } } | null>(null);

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
      } catch (err: unknown) {
        console.error("Error loading saved cards:", err);
        const boardError = BoardErrorHandler.handleNetworkError(err);
        BoardErrorHandler.showError(boardError);
      } finally {
        setLoadingCards(false);
      }
    },
    [sessionId]
  );

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
    } catch (err: unknown) {
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
    } catch (err: unknown) {
      console.error("Error loading card message counts:", err);
    }
  }, [sessionId, user?.id, savedCards]);

  // Handle exit board
  const handleExitBoard = useCallback(() => {
    if (!user?.id || !sessionId) return;

    Alert.alert(
      t('modals:session_view.exit_board_title'),
      t('modals:session_view.exit_board_body'),
      [
        { text: t('common:cancel'), style: "cancel" },
        {
          text: t('modals:session_view.exit'),
          style: "destructive",
          onPress: () => {
            // Close modal immediately — user sees instant feedback
            onClose();

            const currentUserId = user.id;
            const currentSessionId = sessionId;

            // Op 1 (critical): delete participant
            withTimeout(
              supabase
                .from("session_participants")
                .delete()
                .eq("session_id", currentSessionId)
                .eq("user_id", currentUserId)
                .then(({ error }) => {
                  if (error) throw error;
                }),
              5000,
              'exitBoard:deleteParticipant'
            )
              .then(() => {
                onSessionExited?.();

                // Ops 2+3 (cleanup, sequential) and Op 4 (cleanup, parallel)
                const cleanupBoardCollaborator = withTimeout(
                  supabase
                    .from("collaboration_sessions")
                    .select("board_id")
                    .eq("id", currentSessionId)
                    .single()
                    .then(({ data: sessionRow, error: lookupError }) => {
                      if (lookupError) {
                        console.warn("Error looking up session board on exit:", lookupError);
                        return;
                      }
                      const boardIds = sessionRow?.board_id ? [sessionRow.board_id] : [];
                      if (boardIds.length > 0) {
                        return supabase
                          .from("board_collaborators")
                          .delete()
                          .eq("user_id", currentUserId)
                          .in("board_id", boardIds)
                          .then(({ error: delError }) => {
                            if (delError) console.warn("Error removing board collaborator on exit:", delError);
                          });
                      }
                    }),
                  5000,
                  'exitBoard:cleanupCollaborator'
                );

                const declineInvites = withTimeout(
                  supabase
                    .from("collaboration_invites")
                    .update({ status: "declined", updated_at: new Date().toISOString() })
                    .eq("session_id", currentSessionId)
                    .eq("invited_user_id", currentUserId)
                    .eq("status", "pending")
                    .then(() => {}),
                  5000,
                  'exitBoard:declineInvites'
                );

                Promise.allSettled([cleanupBoardCollaborator, declineInvites]).then((results) => {
                  results.forEach((r, i) => {
                    if (r.status === 'rejected') {
                      console.warn(`[exitBoard] Cleanup op ${i + 2} failed:`, r.reason);
                    }
                  });
                });
              })
              .catch((error) => {
                showMutationError(error, 'exiting board', showToast);
              });
          },
        },
      ]
    );
  }, [user?.id, sessionId, onClose, onSessionExited, showToast]);

  // Session validity and permissions are now derived inside useBoardSession
  // from the same data fetch — no separate validation queries needed.

  // Start loading saved cards and unread count immediately on mount.
  // These queries only need sessionId and don't depend on validation.
  // Data will be ready by the time the loading gate opens.
  useEffect(() => {
    if (visible && sessionId) {
      loadSavedCards(0, false);
      loadUnreadCount();
    }
  }, [visible, sessionId, loadSavedCards, loadUnreadCount]);

  // Load card message counts when saved cards change
  useEffect(() => {
    if (savedCards.length > 0) {
      loadCardMessageCounts();
    }
  }, [savedCards, loadCardMessageCounts]);

  // Stable refs for realtime callbacks — prevents subscribe/unsubscribe thrashing
  const loadCardMessageCountsRef = useRef(loadCardMessageCounts);
  loadCardMessageCountsRef.current = loadCardMessageCounts;
  const loadUnreadCountRef = useRef(loadUnreadCount);
  loadUnreadCountRef.current = loadUnreadCount;
  // Participant refreshes now go through useBoardSession's loadSession
  const refreshParticipants = useCallback(() => {
    if (sessionId) loadSession(sessionId);
  }, [sessionId, loadSession]);
  const refreshParticipantsRef = useRef(refreshParticipants);
  refreshParticipantsRef.current = refreshParticipants;

  // Subscribe to real-time updates
  useEffect(() => {
    if (!visible || !sessionId) return;

    const channel = realtimeService.subscribeToBoardSession(sessionId, {
      onCardSaved: (card) => {
        setSavedCards((prev) => {
          if (prev.some((c) => c.id === card.id)) return prev;
          return [card, ...prev];
        });
        loadCardMessageCountsRef.current();
      },
      onMessage: () => {
        loadUnreadCountRef.current();
        loadCardMessageCountsRef.current();
      },
      onCardMessage: () => loadCardMessageCountsRef.current(),
      onParticipantJoined: () => refreshParticipantsRef.current(),
      onParticipantLeft: () => refreshParticipantsRef.current(),
      onSessionDeleted: () => {
        showToast({
          type: 'info',
          message: `"${localName}" was deleted by an admin.`,
        });
        onClose();
      },
    });

    return () => {
      realtimeService.unsubscribe(`board_session:${sessionId}`);
    };
  }, [visible, sessionId]);

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
      setUnreadMessages(0);
      setCardMessageCounts({});
    }
  }, [visible]);

  const activeParticipantsCount = participants.filter((p) => p.has_accepted).length;

  // Session status derived from useBoardSession data — no separate query needed.
  // Realtime updates to session.status come via useBoardSession's realtime subscription.
  const sessionStatus = session?.status ?? null;

  const advanceToVoting = useCallback(async () => {
    if (!sessionId || !isAdmin) return;
    const { error } = await supabase
      .from('collaboration_sessions')
      .update({ status: 'voting' })
      .eq('id', sessionId);
    // Realtime will update session.status via useBoardSession subscription
    if (error) console.error('Failed to advance to voting:', error);
  }, [sessionId, isAdmin]);

  const markCompleted = useCallback(async () => {
    if (!sessionId || !isAdmin) return;
    const { error } = await supabase
      .from('collaboration_sessions')
      .update({ status: 'completed' })
      .eq('id', sessionId);
    if (error) console.error('Failed to mark completed:', error);
  }, [sessionId, isAdmin]);

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
        t('modals:session_view.card_unavailable_title'),
        t('modals:session_view.card_unavailable_body'),
        [{ text: t('common:ok') }]
      );
      return;
    }


    const expandedCardData: ExpandedCardData = {
      id: cardData.id || card.id,
      placeId: cardData.placeId || card.id,
      title: cardData.title || t('modals:session_view.session_fallback'),
      category: cardData.category || t('modals:session_view.session_fallback'),
      categoryIcon: cardData.categoryIcon || "star",
      description: cardData.description || "",
      fullDescription: cardData.fullDescription || cardData.description || "",
      image: cardData.image || "",
      images: cardData.images || [cardData.image].filter(Boolean) as string[],
      rating: cardData.rating || 4.5,
      reviewCount: cardData.reviewCount || 0,
      priceRange: cardData.priceRange || "N/A",
      distance: cardData.distance || "",
      travelTime: cardData.travelTime || "N/A",
      address: cardData.address || "",
      openingHours: cardData.openingHours,
      phone: cardData.phone,
      website: cardData.websiteUri || cardData.website,
      highlights: cardData.highlights || [],
      tags: cardData.tags || [],
      matchScore: cardData.matchScore || 0,
      matchFactors: (cardData.matchFactors as any) || {
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
      priceTier: (cardData as any).priceTier as ExpandedCardData['priceTier'],
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
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.modalOverlay}>
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <View style={[styles.modalContent, { height: SCREEN_HEIGHT - insets.top }]}>
          <SafeAreaView style={[styles.container, { paddingBottom: insets.bottom }]} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="dark-content" />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="close" size={24} color="#6B7280" />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {localName || t('modals:session_view.session_fallback')}
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
                    const resolvedName = getDisplayName(p.profiles, "");
                    if (resolvedName) {
                      const parts = resolvedName.trim().split(" ");
                      initials = parts.length >= 2
                        ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
                        : resolvedName.substring(0, 2).toUpperCase();
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
            <Icon name="ellipsis-vertical" size={20} color="#374151" />
          </TouchableOpacity>
        </View>

        {/* Network Banner */}
        {showNetworkBanner && (
          <View style={styles.networkBanner}>
            <Icon name="wifi-outline" size={16} color="white" />
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
            <Icon name="alert-circle-outline" size={48} color="#FF3B30" />
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
                  savedCards={savedCards}
                  onUnreadCountChange={loadUnreadCount}
                  onCardPress={(card) => handleViewCardDetails(card as any)}
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
          sessionName={localName}
          sessionCreatorId={session?.created_by}
          currentUserId={user?.id}
          isAdmin={isAdmin}
          notificationsEnabled={notificationsEnabled}
          participants={participants}
          onToggleNotifications={() => setNotificationsEnabled(!notificationsEnabled)}
          onInviteParticipants={() => setShowInviteParticipantsModal(true)}
          onExitBoard={handleExitBoard}
          onSessionDeleted={() => {
            if (onSessionDeleted) onSessionDeleted();
            onClose();
          }}
          onSessionNameUpdated={(newName) => {
            setLocalName(newName);
            loadSession(sessionId);
          }}
          onParticipantsChange={refreshParticipants}
        />

        {/* Invite Participants Modal */}
        <InviteParticipantsModal
          visible={showInviteParticipantsModal}
          sessionId={sessionId}
          sessionName={localName || t('modals:session_view.session_fallback')}
          existingParticipantIds={participants.map((p) => p.user_id)}
          onClose={() => setShowInviteParticipantsModal(false)}
          onInvitesSent={refreshParticipants}
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
            currentMode={localName || "board"}
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
                <Icon name="calendar" size={40} color="#10B981" />
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
      </GestureHandlerRootView>
    </Modal>
  );
}

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
    paddingVertical: 0,
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
    paddingTop: 4,
    paddingBottom: 0,
    paddingHorizontal: 8,
    backgroundColor: "white",
    overflow: "visible",
  },
  savedContainer: {
    flex: 1,
    marginTop: 0,
    paddingHorizontal: 8,
    paddingBottom: 8,
    backgroundColor: "white",
    overflow: "visible",
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
