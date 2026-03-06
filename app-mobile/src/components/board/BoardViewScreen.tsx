import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Modal,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

import { BoardHeader } from "./BoardHeader";
import { BoardTabs, BoardTab } from "./BoardTabs";
import { Participant } from "./ParticipantAvatars";
import { ManageBoardModal } from "./ManageBoardModal";
import { useBoardSession } from "../../hooks/useBoardSession";
import { supabase } from "../../services/supabase";
import { realtimeService } from "../../services/realtimeService";
import { useAppStore } from "../../store/appStore";
import SwipeableBoardCards from "../SwipeableBoardCards";
import { BoardSettingsModal } from "./BoardSettingsModal";
import { BoardDiscussionTab } from "./BoardDiscussionTab";
import { CardDiscussionModal } from "./CardDiscussionModal";
import { BoardErrorHandler } from "../../services/boardErrorHandler";
import { useNetworkMonitor } from "../../services/networkMonitor";
import { BoardCache } from "../../services/boardCache";
import { BoardMessageService } from "../../services/boardMessageService";
import { BoardSessionCard } from "./BoardSessionCard";
import ExpandedCardModal from "../ExpandedCardModal";
import { ExpandedCardData } from "../../types/expandedCardTypes";
import ShareModal from "../ShareModal";
import { BoardSettingsDropdown } from "./BoardSettingsDropdown";
import { SwipeableSessionCards } from "./SwipeableSessionCards";
import { useSessionVoting } from "../../hooks/useSessionVoting";
import { useSessionStatus } from "../../hooks/useSessionStatus";
import { useCollaborationCalendar } from "../../hooks/useCollaborationCalendar";

interface BoardViewScreenProps {
  sessionId: string;
  onBack?: () => void;
  onNavigateToSession?: (sessionId: string) => void;
  onExitBoard?: (sessionId?: string, sessionName?: string) => void;
}

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
  priceRange?: string;
  distance?: string;
  travelTime?: string;
  address?: string;
  openingHours?: Record<string, string>;
  phone?: string;
  website?: string;
  highlights?: string[];
  tags?: string[];
  matchScore?: number;
  matchFactors?: Record<string, number>;
  socialStats?: { views?: number; likes?: number; saves?: number; shares?: number };
  location?: { lat: number; lng: number };
  lat?: number;
  lng?: number;
  selectedDateTime?: string | Date;
  strollData?: Record<string, unknown>;
  picnicData?: Record<string, unknown>;
  cardType?: string;
  stops?: unknown[];
  tagline?: string;
  totalPriceMin?: number;
  totalPriceMax?: number;
  estimatedDurationMinutes?: number;
  pairingKey?: string;
  experienceType?: string;
  oneLiner?: string;
  tip?: string;
  priceTier?: string;
  priceLevel?: string;
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

export const BoardViewScreen: React.FC<BoardViewScreenProps> = ({
  sessionId,
  onBack,
  onNavigateToSession,
  onExitBoard,
}) => {
  const {
    session,
    preferences,
    loading: sessionLoading,
    error: sessionError,
    loadSession,
  } = useBoardSession(sessionId);
  const { user } = useAppStore();
  const networkState = useNetworkMonitor();
  const [activeTab, setActiveTab] = useState<BoardTab>("saved");
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedCardForDiscussion, setSelectedCardForDiscussion] = useState<{
    savedCardId: string;
    cardTitle: string;
  } | null>(null);
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showExitMenu, setShowExitMenu] = useState(false);
  const [exitMenuItemPressed, setExitMenuItemPressed] = useState(false);
  
  // New settings dropdown menu state
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [showManageMembersModal, setShowManageMembersModal] = useState(false);
  
  // Expanded card modal state
  const [selectedCardForExpansion, setSelectedCardForExpansion] = useState<ExpandedCardData | null>(null);
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);
  
  // Share modal state
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareData, setShareData] = useState<{ experienceData: ExpandedCardData; dateTimePreferences: { timeOfDay: string; dayOfWeek: string; planningTimeframe: string } } | null>(null);

  // Load saved cards for the session with pagination
  const [savedCardsPage, setSavedCardsPage] = useState(0);
  const [hasMoreCards, setHasMoreCards] = useState(true);
  const CARDS_PER_PAGE = 20;

  const loadSavedCards = useCallback(
    async (page: number = 0, append: boolean = false) => {
      if (!sessionId) return;

      // Check cache first
      const cacheKey = BoardCache.getSavedCardsKey(sessionId, page);
      const cached = await BoardCache.get<any[]>(cacheKey);
      if (cached && !append) {
        setSavedCards(cached);
        setLoadingCards(false);
        // Still fetch in background to update cache
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
          BoardErrorHandler.showError(boardError, () =>
            loadSavedCards(page, append)
          );
          return;
        }

        // Cache the data
        await BoardCache.set(cacheKey, data || [], 2 * 60 * 1000); // 2 minutes

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
        .select(
          `
          *,
          profiles (
            id,
            username,
            display_name,
            first_name,
            last_name,
            avatar_url
          )
        `
        )
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
      const { count, error } =
        await BoardMessageService.getUnreadBoardMessagesCount(
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

  // Phase 2: Use shared voting hook instead of duplicated inline logic
  const activeParticipantsCount = participants.filter((p) => p.has_accepted).length;
  const {
    voteCounts,
    rsvpCounts,
    lockedCards,
    handleVote,
    handleRSVP,
    loadCounts: loadVoteAndRSVPCounts,
  } = useSessionVoting(sessionId, user?.id, activeParticipantsCount);

  // Phase 2: Session status hook
  const {
    status: sessionStatus,
    canGenerateCards,
    canVote,
    canRSVP,
    isLocked: isSessionLocked,
    advanceToVoting,
    markCompleted,
    isCreator,
  } = useSessionStatus(sessionId, session?.created_by, user?.id);

  // Phase 2: Calendar hook for lock-in detection
  const {
    lockedCalendarEntry,
    syncToDeviceCalendar,
    showCalendarPrompt,
    dismissCalendarPrompt,
  } = useCollaborationCalendar(sessionId, user?.id);

  // Handle exit board
  const handleExitBoard = useCallback(async () => {
    if (!user?.id || !sessionId) return;

    // Get session name before exiting to check if it's the active session
    const sessionName = session?.name;

    Alert.alert(
      "Exit Board",
      "Are you sure you want to exit this board? You will no longer receive updates or be able to participate.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Exit",
          style: "destructive",
          onPress: async () => {
            // OPTIMISTIC UPDATES FIRST - Update UI immediately
            // 1. Remove board from boards list immediately
            if (onExitBoard) {
              // Pass sessionId and sessionName so parent can optimistically remove it
              // Parent will handle database operations and refresh
              onExitBoard(sessionId, sessionName);
            }

            // 2. Navigate back immediately (before DB operations)
            if (onBack) {
              onBack();
            }
          },
        },
      ]
    );
  }, [user?.id, sessionId, session?.name, onBack, onExitBoard]);

  // Load card message counts
  const [cardMessageCounts, setCardMessageCounts] = useState<
    Record<string, number>
  >({});

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

      if (error) throw error;

      // Count messages per card
      const counts: Record<string, number> = {};
      savedCardIds.forEach((cardId) => {
        counts[cardId] = (data || []).filter(
          (m) => m.saved_card_id === cardId
        ).length;
      });

      setCardMessageCounts(counts);
    } catch (err: any) {
      console.error("Error loading card message counts:", err);
    }
  }, [sessionId, user?.id, savedCards]);

  // Stable refs for callbacks — prevents useEffect re-runs when callback identities change
  const loadUnreadCountRef = useRef(loadUnreadCount);
  const loadParticipantsRef = useRef(loadParticipants);
  const loadCardMessageCountsRef = useRef(loadCardMessageCounts);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { loadUnreadCountRef.current = loadUnreadCount; }, [loadUnreadCount]);
  useEffect(() => { loadParticipantsRef.current = loadParticipants; }, [loadParticipants]);
  useEffect(() => { loadCardMessageCountsRef.current = loadCardMessageCounts; }, [loadCardMessageCounts]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Subscribe to real-time updates — only depends on sessionId to avoid channel destruction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boardCallbacksRef = useRef<any>(null);
  useEffect(() => {
    if (!sessionId) return;

    const callbacks = {
      onCardSaved: (card: SavedCard) => {
        setSavedCards((prev) => {
          if (prev.find((c) => c.id === card.id)) return prev;
          return [card, ...prev];
        });
        loadCardMessageCountsRef.current();
      },
      onMessage: () => {
        loadUnreadCountRef.current();
        loadCardMessageCountsRef.current();
      },
      onCardMessage: () => {
        loadCardMessageCountsRef.current();
      },
      onParticipantJoined: () => {
        loadParticipantsRef.current();
      },
      onParticipantLeft: () => {
        loadParticipantsRef.current();
      },
    };

    boardCallbacksRef.current = callbacks;
    realtimeService.subscribeToBoardSession(sessionId, callbacks);

    return () => {
      // Only unregister this callback set — don't destroy the shared channel
      if (boardCallbacksRef.current) {
        realtimeService.unregisterBoardCallbacks(sessionId, boardCallbacksRef.current);
        boardCallbacksRef.current = null;
      }
    };
  }, [sessionId]);

  // Destroy channel only on full component unmount — empty deps = unmount only
  // Uses sessionIdRef to read the latest sessionId at cleanup time without
  // adding sessionId as a dependency (which would re-run and destroy the channel
  // in React Strict Mode double-invoke or if sessionId ever changed).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    return () => {
      if (sessionIdRef.current) {
        realtimeService.unsubscribe(`board_session:${sessionIdRef.current}`);
      }
    };
  }, []);

  // Validate session and permissions on mount
  useEffect(() => {
    const validateSession = async () => {
      if (!sessionId || !user?.id) return;

      // Check session validity
      const validityCheck = await BoardErrorHandler.checkSessionValidity(
        sessionId
      );
      setSessionValid(validityCheck.valid);

      if (!validityCheck.valid && validityCheck.error) {
        BoardErrorHandler.showError(validityCheck.error, () => {
          if (onBack) onBack();
        });
        return;
      }

      // Check permissions
      const permissionCheck = await BoardErrorHandler.checkSessionPermission(
        sessionId,
        user.id
      );
      setHasPermission(permissionCheck.hasPermission);
      setIsAdmin(permissionCheck.isAdmin || false);

      if (!permissionCheck.hasPermission && permissionCheck.error) {
        BoardErrorHandler.showError(permissionCheck.error, () => {
          if (onBack) onBack();
        });
        return;
      }
    };

    validateSession();
  }, [sessionId, user?.id, onBack]);

  // Load data on mount
  useEffect(() => {
    if (sessionValid && hasPermission) {
      loadSavedCards(0, false);
      loadParticipants();
      loadUnreadCount();
    }
  }, [
    sessionValid,
    hasPermission,
    loadSavedCards,
    loadParticipants,
    loadUnreadCount,
  ]);

  // Load vote/RSVP counts when saved cards change
  useEffect(() => {
    if (savedCards.length > 0) {
      loadVoteAndRSVPCounts();
      loadCardMessageCounts();
    }
  }, [savedCards, loadVoteAndRSVPCounts, loadCardMessageCounts]);

  // Transform saved cards to board card format
  const boardCards = savedCards.map((savedCard) => {
    // Use card_data JSONB field (which contains the full card data)
    const experience = savedCard.card_data || savedCard.experience_data || {};
    const voteData = voteCounts[savedCard.id] || {
      yes: 0,
      no: 0,
      userVote: null,
    };
    const rsvpData = rsvpCounts[savedCard.id] || {
      responded: 0,
      total: participants.filter((p) => p.has_accepted).length,
      userRSVP: null,
    };
    const messageCount = cardMessageCounts[savedCard.id] || 0;

    return {
      id: experience.id || savedCard.saved_card_id || savedCard.id,
      title: experience.title || "Untitled Experience",
      category: experience.category || "Experience",
      categoryIcon: experience.categoryIcon || "star",
      image: experience.image || "",
      images: experience.images || [],
      rating: experience.rating || 0,
      reviewCount: experience.reviewCount || 0,
      travelTime: experience.travelTime || "N/A",
      priceRange: experience.priceRange || "N/A",
      description: experience.description || "",
      fullDescription: experience.fullDescription || "",
      address: experience.address || "",
      highlights: experience.highlights || [],
      matchScore: experience.matchScore || 0,
      socialStats: experience.socialStats || { views: 0, likes: 0, saves: 0 },
      votes: voteData,
      rsvps: rsvpData,
      messages: messageCount,
      isLocked: lockedCards[savedCard.id]?.isLocked || false,
    };
  });

  // Show network error banner
  const showNetworkBanner = !networkState.isConnected;

  if (sessionLoading || sessionValid === null || hasPermission === null) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#eb7825" />
        </View>
      </View>
    );
  }

  if (sessionError || !session || !sessionValid || !hasPermission) {
    const error = sessionError
      ? BoardErrorHandler.handleSessionError({ message: sessionError })
      : !sessionValid
      ? { userFriendlyMessage: "This board session is no longer available." }
      : !hasPermission
      ? {
          userFriendlyMessage:
            "You don't have permission to access this session.",
        }
      : { userFriendlyMessage: "Session not found" };

    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color="#FF3B30" />
          <Text style={styles.errorText}>
            {error.userFriendlyMessage || "Session not found"}
          </Text>
          {onBack && (
            <TouchableOpacity style={styles.backButton} onPress={onBack}>
              <Text style={styles.backButtonText}>Go Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Network Error Banner */}
      {showNetworkBanner && (
        <View style={styles.networkBanner}>
          <Ionicons name="wifi-outline" size={16} color="white" />
          <Text style={styles.networkBannerText}>
            No internet connection. Some features may be unavailable.
          </Text>
        </View>
      )}

      <BoardHeader
        session={session}
        participants={participants}
        onBack={onBack}
        onSettingsPress={() => {
          // Show new settings dropdown menu for all users
          setShowSettingsDropdown(true);
          
          /* Old implementation - commented out
          if (isAdmin || session.created_by === user?.id) {
            setShowSettings(true);
          } else {
            // Show exit menu for non-admins
            setShowExitMenu(true);
          }
          */
        }}
        loading={loadingCards}
      />

      {/* Phase 2: Session status controls */}
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
            {sessionStatus === 'active' ? 'Active' :
             sessionStatus === 'voting' ? 'Voting' :
             sessionStatus === 'locked' ? 'Locked In' :
             sessionStatus === 'completed' ? 'Completed' :
             sessionStatus.charAt(0).toUpperCase() + sessionStatus.slice(1)}
          </Text>
        </View>
        {isCreator && sessionStatus === 'active' && (
          <TouchableOpacity style={styles.statusActionButton} onPress={advanceToVoting}>
            <Ionicons name="hand-left-outline" size={14} color="white" />
            <Text style={styles.statusActionText}>Start Voting</Text>
          </TouchableOpacity>
        )}
        {isCreator && sessionStatus === 'locked' && (
          <TouchableOpacity style={styles.statusActionButton} onPress={markCompleted}>
            <Ionicons name="checkmark-circle-outline" size={14} color="white" />
            <Text style={styles.statusActionText}>Mark Complete</Text>
          </TouchableOpacity>
        )}
      </View>

      <BoardTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        savedCount={savedCards.length}
        unreadMessages={unreadMessages}
        canGenerateCards={canGenerateCards}
      />

      <View style={styles.content}>
        {activeTab === "saved" && (
          <View style={styles.savedContainer}>
            <SwipeableSessionCards
              cards={savedCards}
              sessionId={sessionId}
              userId={user?.id}
              participantCount={activeParticipantsCount}
              onViewDetails={(card) => {
                const cardData = card.card_data || card.experience_data || null;
                
                // Check if the card/experience data exists and is valid
                const hasValidCardData = cardData && 
                  typeof cardData === 'object' && 
                  (cardData.title || cardData.description || cardData.name);
                
                // If card data is completely missing or invalid, show unavailable error
                if (!hasValidCardData) {
                  Alert.alert(
                    "Card Unavailable",
                    "This experience is no longer available. It may have been removed or is temporarily inaccessible.",
                    [{ text: "OK" }]
                  );
                  return;
                }
                
                // If offline and no cached data, show error
                if (!networkState.isConnected && !hasValidCardData) {
                  Alert.alert(
                    "Offline",
                    "Unable to load card details. Please check your internet connection and try again.",
                    [{ text: "OK" }]
                  );
                  return;
                }
                
                // Transform to ExpandedCardData format with safe fallbacks
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
              }}
              loading={loadingCards}
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

      {/* Old BoardSettingsModal implementation - commented out
      {showSettings && (
        <BoardSettingsModal
          visible={showSettings}
          sessionId={sessionId}
          onClose={() => setShowSettings(false)}
          onDelete={handleDeleteSession}
        />
      )}
      */}

      {/* Board Settings Dropdown */}
      <BoardSettingsDropdown
        visible={showSettingsDropdown}
        onClose={() => setShowSettingsDropdown(false)}
        sessionId={sessionId}
        sessionName={session?.name || ""}
        sessionCreatorId={session?.created_by}
        currentUserId={user?.id}
        isAdmin={isAdmin}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={() => {
          setNotificationsEnabled(!notificationsEnabled);
          // TODO: Implement actual notification toggle logic
        }}
        onManageMembers={() => {
          setShowManageMembersModal(true);
        }}
        onExitBoard={handleExitBoard}
        onSessionDeleted={() => {
          // Navigate back after deletion
          if (onExitBoard) {
            onExitBoard(sessionId, session?.name);
          } else if (onBack) {
            onBack();
          }
        }}
        onSessionNameUpdated={(newName) => {
          // Reload session to get updated name
          loadSession(sessionId);
        }}
        variant="overlay"
      />

      {/* Manage Board Modal */}
      <ManageBoardModal
        visible={showManageMembersModal}
        sessionId={sessionId}
        sessionName={session?.name || "Board"}
        sessionCreatorId={session?.created_by}
        participants={participants}
        onClose={() => setShowManageMembersModal(false)}
        onExitBoard={handleExitBoard}
        onParticipantsChange={loadParticipants}
      />

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
          isSaved={true}
          currentMode={session?.name || "board"}
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

      {/* Phase 2: Calendar prompt on lock-in */}
      {showCalendarPrompt && lockedCalendarEntry && (
        <Modal visible={true} transparent animationType="fade">
          <View style={styles.calendarPromptOverlay}>
            <View style={styles.calendarPromptCard}>
              <Ionicons name="checkmark-circle" size={48} color="#22c55e" />
              <Text style={styles.calendarPromptTitle}>Locked In!</Text>
              <Text style={styles.calendarPromptText}>
                Everyone agreed on this experience. Add it to your calendar?
              </Text>
              <TouchableOpacity
                style={styles.calendarPromptButton}
                onPress={() => syncToDeviceCalendar(lockedCalendarEntry)}
              >
                <Ionicons name="calendar-outline" size={16} color="white" />
                <Text style={styles.calendarPromptButtonText}>Add to Calendar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.calendarPromptDismiss}
                onPress={dismissCalendarPrompt}
              >
                <Text style={styles.calendarPromptDismissText}>Not now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Exit Board Menu Popover */}
      {showExitMenu && (
        <TouchableOpacity
          style={styles.exitMenuOverlay}
          activeOpacity={1}
          onPress={() => setShowExitMenu(false)}
        >
          <View style={styles.exitMenuPopover}>
            <TouchableOpacity
              style={[
                styles.exitMenuItem,
                exitMenuItemPressed && styles.exitMenuItemPressed,
              ]}
              onPress={() => {
                setShowExitMenu(false);
                handleExitBoard();
              }}
              onPressIn={() => setExitMenuItemPressed(true)}
              onPressOut={() => setExitMenuItemPressed(false)}
              activeOpacity={1}
            >
              <Ionicons name="exit-outline" size={20} color="#FF3B30" />
              <Text style={styles.exitMenuText}>Exit Board</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
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
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eb7825",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 4,
  },
  statusActionText: {
    fontSize: 12,
    fontWeight: "600",
    color: "white",
  },
  calendarPromptOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  calendarPromptCard: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    width: "80%",
    gap: 12,
  },
  calendarPromptTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  calendarPromptText: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 20,
  },
  calendarPromptButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eb7825",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
    gap: 6,
    marginTop: 4,
  },
  calendarPromptButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "white",
  },
  calendarPromptDismiss: {
    paddingVertical: 8,
  },
  calendarPromptDismissText: {
    fontSize: 14,
    color: "#9ca3af",
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
  backButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: "white",
    fontWeight: "600",
  },
  networkBanner: {
    backgroundColor: "#FF9500",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    gap: 8,
  },
  networkBannerText: {
    color: "white",
    fontSize: 13,
    fontWeight: "500",
  },
  content: {
    flex: 1,
  },
  savedContainer: {
    flex: 1,
  },
  sessionCardsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  sessionCardsTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
  },
  sessionCardsNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sessionCardsCounter: {
    fontSize: 14,
    color: "#6b7280",
    marginRight: 4,
  },
  navButton: {
    padding: 4,
  },
  savedCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  savedCardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  savedCardDescription: {
    fontSize: 14,
    color: "#666",
  },
  discussionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  comingSoonText: {
    fontSize: 16,
    color: "#666",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  loadingMoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 8,
  },
  loadingMoreText: {
    fontSize: 14,
    color: "#666",
  },
  exitMenuOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
  },
  exitMenuPopover: {
    position: "absolute",
    top: 35,
    right: 16,
    backgroundColor: "white",
    borderRadius: 12,
    paddingVertical: 8,
    minWidth: 180,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  exitMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  exitMenuItemPressed: {
    backgroundColor: "#f3f4f6",
  },
  exitMenuText: {
    fontSize: 16,
    color: "#FF3B30",
    fontWeight: "400",
  },
});
