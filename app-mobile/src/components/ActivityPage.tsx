import React, { useState, useEffect, useCallback, useMemo } from "react";
import { BoardMessageService } from "../services/boardMessageService";
import { BoardCardService } from "../services/boardCardService";
import { useAppStore } from "../store/appStore";
import { useAppState } from "./AppStateManager";
import { useBoardSavedCards } from "../hooks/useBoardSavedCards";
import { Text, View, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import BoardsTab from "./activity/BoardsTab";
import SavedTab from "./activity/SavedTab";
import CalendarTab from "./activity/CalendarTab";
import BoardDiscussion from "./BoardDiscussion";
import UserInviteModal from "./UserInviteModal";
import PurchaseModal from "./PurchaseModal";
import PurchaseQRCode from "./PurchaseQRCode";
import ManageBoardModal from "./board/ManageBoardModal";

interface Board {
  id: string;
  name: string;
  type:
    | "date-night"
    | "group-hangout"
    | "adventure"
    | "wellness"
    | "food-tour"
    | "cultural";
  description: string;
  participants: Array<{
    id: string;
    name: string;
    status: string;
    lastActive?: string;
  }>;
  status: "active" | "voting" | "locked" | "completed";
  voteDeadline?: string;
  finalizedDate?: string;
  cardsCount: number;
  createdAt: string;
  unreadMessages: number;
  lastActivity: string;
  icon: any;
  gradient: string;
  creatorId: string;
  admins: string[];
  currentUserId: string;
}

interface ActivityPageProps {
  onSendInvite?: (sessionId: string, users: any[]) => void;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  calendarEntries?: any[];
  isLoadingSavedCards?: boolean;
  onScheduleFromSaved?: (savedCard: any) => void;
  onPurchaseFromSaved?: (card: any, purchaseOption: any) => void;
  onRemoveFromCalendar?: (entry: any) => void;
  onShareCard?: (card: any) => void;
  boardsSessions?: any[];
  isLoadingBoards?: boolean;
  onUpdateBoardSession?: (board: any) => void;
  navigationData?: {
    selectedBoard?: any;
    activeTab?: "saved" | "boards" | "calendar";
    discussionTab?: string;
  } | null;
  onNavigationComplete?: () => void;
  onPromoteToAdmin?: (boardId: string, participantId: string) => void;
  onDemoteFromAdmin?: (boardId: string, participantId: string) => void;
  onRemoveMember?: (boardId: string, participantId: string) => void;
  onLeaveBoard?: (boardId: string) => void;
  onNavigateToBoard?: (sessionId: string) => void;
  onUnreadCountChange?: (count: number) => void;
  activeBoardSessionId?: string | null; // Session ID of the currently open board
}

export default function ActivityPage({
  onSendInvite,
  userPreferences,
  accountPreferences,
  calendarEntries = [],
  isLoadingSavedCards = false,
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onRemoveFromCalendar,
  onShareCard,
  boardsSessions = [],
  isLoadingBoards = false,
  onUpdateBoardSession,
  navigationData,
  onNavigationComplete,
  onPromoteToAdmin,
  onDemoteFromAdmin,
  onRemoveMember,
  onLeaveBoard,
  onNavigateToBoard,
  onUnreadCountChange,
  activeBoardSessionId,
}: ActivityPageProps) {
  const { savedCards = [] } = useAppState();
  const [activeTab, setActiveTab] = useState<"boards" | "saved" | "calendar">(
    "boards"
  );
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [showBoardDetails, setShowBoardDetails] = useState(false);
  const [activeDiscussionTab, setActiveDiscussionTab] = useState<
    "cards" | "discussion"
  >("discussion");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteSessionData, setInviteSessionData] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [boardNotifications, setBoardNotifications] = useState<{
    [boardId: string]: boolean;
  }>({});
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseModalCard, setPurchaseModalCard] = useState<any>(null);
  const [showQRCode, setShowQRCode] = useState<string | null>(null);
  const [showManageMembersModal, setShowManageMembersModal] = useState(false);
  const [manageMembersSessionData, setManageMembersSessionData] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Handle navigation from external sources (e.g., CollaborationModule)
  React.useEffect(() => {
    if (navigationData) {
      if (navigationData.activeTab) {
        setActiveTab(navigationData.activeTab);
      }
      if (navigationData.selectedBoard) {
        setSelectedBoard(navigationData.selectedBoard.id);
        setShowBoardDetails(true);
        if (navigationData.discussionTab) {
          setActiveDiscussionTab(navigationData.discussionTab);
        }
      }
      // Clear navigation data after processing
      if (onNavigationComplete) {
        onNavigationComplete();
      }
    }
  }, [navigationData, onNavigationComplete]);

  const { user } = useAppStore();
  const [boardsWithUnreadCounts, setBoardsWithUnreadCounts] = useState<any[]>(
    []
  );

  // Fetch unread counts for each board
  useEffect(() => {
    const fetchUnreadCounts = async () => {
      if (!user?.id || !boardsSessions || boardsSessions.length === 0) {
        setBoardsWithUnreadCounts(boardsSessions || []);
        return;
      }

      try {
        // Fetch unread counts for all boards in parallel
        const boardsWithCounts = await Promise.all(
          boardsSessions.map(async (board) => {
            // Get session_id from board (could be id or session_id field)
            const sessionId = (board as any).session_id || board.id;

            const { count, error } =
              await BoardMessageService.getUnreadBoardMessagesCount(
                sessionId,
                user.id
              );

            return {
              ...board,
              unreadMessages: error ? 0 : count || 0,
            };
          })
        );

        setBoardsWithUnreadCounts(boardsWithCounts);
      } catch (error) {
        console.error("Error fetching unread counts for boards:", error);
        // Fallback to boards without counts
        setBoardsWithUnreadCounts(boardsSessions);
      }
    };

    fetchUnreadCounts();

    // Refresh unread counts periodically
    const interval = setInterval(fetchUnreadCounts, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, [boardsSessions, user?.id]);

  // Use React Query for board saved cards
  const shouldFetchBoardCards =
    activeTab === "saved" && !showBoardDetails && !!activeBoardSessionId;
  const sessionName = boardsSessions.find(
    (b) =>
      (b as any).session_id === activeBoardSessionId ||
      b.id === activeBoardSessionId
  )?.name;

  const { data: boardSavedCards = [], isLoading: loadingBoardCards } =
    useBoardSavedCards(
      activeBoardSessionId,
      sessionName,
      shouldFetchBoardCards
    );

  const handleVote = (cardId: string, vote: "yes" | "no") => {};

  const handleRSVP = (cardId: string, rsvp: "yes" | "no") => {
    if (rsvp === "yes") {
      const card = savedCards.find((c) => c.id === cardId);
      if (card && onScheduleFromSaved) {
        onScheduleFromSaved(card);
      }
    }
  };

  const handleRemoveSaved = (cardId: string) => {};

  const handleSendToFriend = (cardId: string) => {};

  const handleInviteToSession = (boardId: string, boardName: string) => {
    setInviteSessionData({ id: boardId, name: boardName });
    setShowInviteModal(true);
  };

  const handleSendInvites = (users: any[]) => {
    if (inviteSessionData && onSendInvite) {
      onSendInvite(inviteSessionData.id, users);
    }
    setShowInviteModal(false);
    setInviteSessionData(null);
  };

  const handleOpenPurchase = (card: any) => {
    setPurchaseModalCard(card);
    setShowPurchaseModal(true);
  };

  const handlePurchaseComplete = (experienceData: any, purchaseOption: any) => {
    setShowPurchaseModal(false);
    setPurchaseModalCard(null);

    if (onPurchaseFromSaved) {
      onPurchaseFromSaved(experienceData, purchaseOption);
    }
  };

  const handleLeaveBoard = (boardId: string, boardName: string) => {};

  const handleToggleBoardNotifications = (boardId: string) => {
    setBoardNotifications((prev) => {
      const newEnabled = !prev[boardId];
      return {
        ...prev,
        [boardId]: newEnabled,
      };
    });
  };

  const handleExitBoard = (boardId: string, boardName: string) => {};

  const handleManageMembers = (boardId: string, boardName: string) => {
    setManageMembersSessionData({ id: boardId, name: boardName });
    setShowManageMembersModal(true);
  };

  const isUserAdmin = (board: Board): boolean => {
    return board.admins.includes(board.currentUserId);
  };

  const handleOpenBoard = (boardId: string) => {
    // If onNavigateToBoard is provided, use it to navigate to the board view
    if (onNavigateToBoard) {
      // Try to find the board in boardsSessions
      const board = boardsSessions.find((b) => b.id === boardId);

      // Check for session_id field (boards can have a session_id)
      if (board && (board as any).session_id) {
        onNavigateToBoard((board as any).session_id);
        return;
      }

      // Check for sessionId field (alternative naming)
      if (board && (board as any).sessionId) {
        onNavigateToBoard((board as any).sessionId);
        return;
      }

      // If board not found or no session_id, try using boardId as sessionId
      // (in some cases, board.id might be the same as session.id)
      onNavigateToBoard(boardId);
      return;
    }

    // Fallback to old behavior (showing board details modal)
    setSelectedBoard(boardId);
    setShowBoardDetails(true);
  };

  const handleAddToCalendar = (entry: any) => {};

  const handleShowQRCode = (entryId: string) => {
    setShowQRCode(entryId);
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "white",
    },
    header: {
      backgroundColor: "white",
      borderBottomWidth: 1,
      borderBottomColor: "#f3f4f6",
      paddingHorizontal: 16,

      paddingTop: 16,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 24,
    },
    tabContainer: {
      flexDirection: "row",
      backgroundColor: "#f3f4f6",
      borderRadius: 12,
    },
    tab: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignItems: "center",
    },
    tabActive: {
      backgroundColor: "#eb7825",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
      borderRadius: 12,
    },
    tabText: {
      fontSize: 16,
      fontWeight: "500",
      color: "#6B7280",
    },
    tabTextActive: {
      color: "#FFFFFF",
    },
    tabTextInactive: {
      color: "#6b7280",
    },
    content: {
      flex: 1,
      overflow: "hidden",
    },
    modalOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 50,
      paddingHorizontal: 16,
      paddingBottom: 96,
    },
    qrModal: {
      backgroundColor: "white",
      borderRadius: 12,
      maxWidth: 400,
      width: "100%",
      maxHeight: "100%",
      overflow: "hidden",
    },
    qrModalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: "#e5e7eb",
    },
    qrModalTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: "#111827",
    },
    qrModalCloseButton: {
      padding: 8,
      borderRadius: 8,
    },
    qrModalContent: {
      padding: 16,
      flex: 1,
    },
  });

  // Show all boards (no filtering by status - user wants to see all boards they're a member of)
  const activeBoards =
    boardsWithUnreadCounts.length > 0 ? boardsWithUnreadCounts : boardsSessions;

  // PERFORMANCE OPTIMIZATION: Memoize scheduledCardIds to avoid creating new array on every render
  const scheduledCardIdsMemo = useMemo(() => {
    return calendarEntries
      .filter((entry: any) => !entry.archived_at)
      .map(
        (entry: any) =>
          entry.card_id || entry.experience?.id || entry.card_data?.id
      );
  }, [calendarEntries]);

  // Determine if we should show board-specific cards
  const shouldShowBoardCards = activeBoardSessionId && !showBoardDetails;

  return (
    <View style={styles.container}>
      {/* Header */}
      {!selectedBoard && (
        <View style={styles.header}>
          {/* Tab Navigation */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              onPress={() => setActiveTab("boards")}
              style={[styles.tab, activeTab === "boards" && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "boards"
                    ? styles.tabTextActive
                    : styles.tabTextInactive,
                ]}
              >
                Boards
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("saved")}
              style={[styles.tab, activeTab === "saved" && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "saved"
                    ? styles.tabTextActive
                    : styles.tabTextInactive,
                ]}
              >
                Saved
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("calendar")}
              style={[styles.tab, activeTab === "calendar" && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "calendar"
                    ? styles.tabTextActive
                    : styles.tabTextInactive,
                ]}
              >
                Locked In
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>
        {showBoardDetails && selectedBoard ? (
          (() => {
            const board = boardsSessions.find((b) => b.id === selectedBoard);
            return board ? (
              <BoardDiscussion
                board={board}
                onBack={() => {
                  setShowBoardDetails(false);
                  setSelectedBoard(null);
                }}
                activeTab={activeDiscussionTab}
                onTabChange={setActiveDiscussionTab}
                onPromoteToAdmin={onPromoteToAdmin}
                onDemoteFromAdmin={onDemoteFromAdmin}
                onRemoveMember={onRemoveMember}
                onLeaveBoard={onLeaveBoard}
              />
            ) : null;
          })()
        ) : (
          <>
            {activeTab === "boards" && (
              <BoardsTab
                boards={activeBoards}
                isLoading={isLoadingBoards}
                onOpenBoard={handleOpenBoard}
                onInviteToSession={handleInviteToSession}
                onToggleNotifications={handleToggleBoardNotifications}
                onExitBoard={handleExitBoard}
                onLeaveBoard={handleLeaveBoard}
                onManageMembers={handleManageMembers}
                boardNotifications={boardNotifications}
                isUserAdmin={isUserAdmin}
              />
            )}
            {activeTab === "saved" && (
              <SavedTab
                isLoading={
                  shouldShowBoardCards ? loadingBoardCards : isLoadingSavedCards
                }
                scheduledCardIds={scheduledCardIdsMemo}
                onScheduleFromSaved={onScheduleFromSaved || (() => {})}
                onPurchaseFromSaved={handleOpenPurchase}
                onShareCard={onShareCard || (() => {})}
                userPreferences={userPreferences}
                boardSavedCards={
                  shouldShowBoardCards ? boardSavedCards : undefined
                }
                activeBoardSessionId={
                  shouldShowBoardCards ? activeBoardSessionId : undefined
                }
              />
            )}
            {activeTab === "calendar" && (
              <CalendarTab
                calendarEntries={calendarEntries}
                onRemoveFromCalendar={onRemoveFromCalendar || (() => {})}
                onShareCard={onShareCard || (() => {})}
                onAddToCalendar={handleAddToCalendar}
                onShowQRCode={handleShowQRCode}
                userPreferences={userPreferences}
                accountPreferences={accountPreferences}
              />
            )}
          </>
        )}
      </View>

      {/* User Invite Modal */}
      <UserInviteModal
        isOpen={showInviteModal}
        onClose={() => {
          setShowInviteModal(false);
          setInviteSessionData(null);
        }}
        onSendInvites={handleSendInvites}
        sessionName={inviteSessionData?.name || ""}
        existingMemberIds={
          inviteSessionData
            ? (boardsSessions.find(
                (b: any) =>
                  b.id === inviteSessionData.id ||
                  b.session_id === inviteSessionData.id
              )?.participants || []).map((p: any) => p.id)
            : []
        }
      />

      {/* Purchase Modal */}
      {showPurchaseModal && purchaseModalCard && (
        <PurchaseModal
          isOpen={showPurchaseModal}
          onClose={() => {
            setShowPurchaseModal(false);
            setPurchaseModalCard(null);
          }}
          recommendation={purchaseModalCard}
          accountPreferences={accountPreferences}
          onPurchaseComplete={handlePurchaseComplete}
        />
      )}

      {/* QR Code Modal */}
      {showQRCode && (
        <View style={styles.modalOverlay}>
          <View style={styles.qrModal}>
            <View style={styles.qrModalHeader}>
              <Text style={styles.qrModalTitle}>Purchase QR Code</Text>
              <TouchableOpacity
                onPress={() => setShowQRCode(null)}
                style={styles.qrModalCloseButton}
              >
                <Ionicons name="close" size={20} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.qrModalContent}>
              {(() => {
                const entry = calendarEntries.find(
                  (e: any) => e.id === showQRCode
                );
                return entry ? (
                  <PurchaseQRCode
                    entry={entry}
                    accountPreferences={accountPreferences}
                  />
                ) : null;
              })()}
            </View>
          </View>
        </View>
      )}

      {/* Manage Board Members Modal */}
      {manageMembersSessionData && (
        <ManageBoardModal
          visible={showManageMembersModal}
          sessionId={manageMembersSessionData.id}
          sessionName={manageMembersSessionData.name}
          onClose={() => {
            setShowManageMembersModal(false);
            setManageMembersSessionData(null);
          }}
          onExitBoard={() => {
            setShowManageMembersModal(false);
            setManageMembersSessionData(null);
            handleExitBoard(manageMembersSessionData.id, manageMembersSessionData.name);
          }}
        />
      )}
    </View>
  );
}
