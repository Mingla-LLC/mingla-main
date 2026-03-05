import React, { useState, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BoardSettingsDropdown } from "../board/BoardSettingsDropdown";
import { useAppStore } from "../../store/appStore";

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

interface BoardsTabProps {
  boards: Board[];
  isLoading?: boolean;
  onOpenBoard: (boardId: string) => void;
  onInviteToSession: (boardId: string, boardName: string) => void;
  onToggleNotifications: (boardId: string) => void;
  onManageMembers?: (boardId: string, boardName: string) => void;
  onExitBoard: (boardId: string, boardName: string) => void;
  onLeaveBoard: (boardId: string, boardName: string) => void;
  onDeleteBoard?: (boardId: string, boardName: string) => void;
  onBoardNameUpdated?: (boardId: string, newName: string) => void;
  boardNotifications: { [boardId: string]: boolean };
  isUserAdmin: (board: Board) => boolean;
}

const BoardsTab = ({
  boards,
  isLoading = false,
  onOpenBoard,
  onInviteToSession,
  onToggleNotifications,
  onManageMembers,
  onExitBoard,
  onLeaveBoard,
  onDeleteBoard,
  onBoardNameUpdated,
  boardNotifications,
  isUserAdmin,
}: BoardsTabProps) => {
  const [menuOpenForBoard, setMenuOpenForBoard] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuButtonRefs = useRef<{ [key: string]: View | null }>({});
  // Track the selected board separately so it persists when dropdown closes for edit modal
  const [selectedBoardForSettings, setSelectedBoardForSettings] = useState<Board | null>(null);

  const handleMenuPress = (boardId: string) => {
    const board = boards.find((b) => b.id === boardId);
    if (board) {
      setSelectedBoardForSettings(board);
    }
    
    const buttonRef = menuButtonRefs.current[boardId];
    if (buttonRef) {
      buttonRef.measureInWindow((x, y, width, height) => {
        const screenWidth = Dimensions.get("window").width;
        const screenHeight = Dimensions.get("window").height;
        const menuWidth = 220;
        const menuHeight = 110; // Approximate height of menu
        
        // Position menu to the left of the button, below it
        let menuX = x + width - menuWidth; // Align right edge with button right edge
        let menuY = y + height + 8; // Below the button with 8px gap
        
        // Make sure menu doesn't go off screen horizontally
        if (menuX < 16) menuX = 16;
        if (menuX + menuWidth > screenWidth - 16) menuX = screenWidth - menuWidth - 16;
        
        // If menu would go below screen, show it above the button
        if (menuY + menuHeight > screenHeight - 100) {
          menuY = y - menuHeight - 8;
        }
        
        setMenuPosition({ x: menuX, y: menuY });
        setMenuOpenForBoard(boardId);
      });
    } else {
      setMenuOpenForBoard(boardId);
    }
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    listContent: {
      gap: 16,
      paddingBottom: 62, // Add padding to prevent tab bar from touching last card
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    boardCard: {
      backgroundColor: "white",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#e5e7eb",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
    },
    boardContent: {
      padding: 16,
    },
    boardHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    boardInfo: {
      flex: 1,
    },
    boardNameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 4,
    },
    boardName: {
      fontSize: 16,
      fontWeight: "600",
      color: "#111827",
    },
    unreadBadge: {
      backgroundColor: "#eb7825",
      borderRadius: 12,
      minWidth: 24,
      height: 24,
      paddingHorizontal: 8,
      justifyContent: "center",
      alignItems: "center",
    },
    unreadBadgeText: {
      color: "white",
      fontSize: 12,
      fontWeight: "600",
    },
    boardDescription: {
      fontSize: 14,
      color: "#6b7280",
      lineHeight: 20,
    },
    statusBadge: {
      flexShrink: 0,
      marginLeft: 12,
    },
    votingBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: "rgba(235, 120, 37, 0.1)",
      borderRadius: 20,
    },
    votingBadgeText: {
      fontSize: 12,
      color: "#eb7825",
    },
    lockedBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: "#f3f4f6",
      borderRadius: 20,
    },
    lockedBadgeText: {
      fontSize: 12,
      color: "#374151",
    },
    activeBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: "#dcfce7",
      borderRadius: 20,
    },
    activeBadgeText: {
      fontSize: 12,
      color: "#166534",
    },
    completedBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: "#dbeafe",
      borderRadius: 20,
    },
    completedBadgeText: {
      fontSize: 12,
      color: "#1d4ed8",
    },
    statsRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 16,
    },
    statsContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
    },
    statItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    statNumber: {
      fontSize: 14,
      color: "#111827",
    },
    statLabel: {
      fontSize: 12,
      color: "#6b7280",
      letterSpacing: 0.5,
    },
    statDivider: {
      width: 4,
      height: 4,
      backgroundColor: "#d1d5db",
      borderRadius: 2,
    },
    actionsContainer: {
      flexDirection: "row",
      gap: 8,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: "#eb7825",
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: "center",
    },
    primaryButtonText: {
      color: "white",
      fontSize: 14,
      fontWeight: "500",
    },
    secondaryButton: {
      width: 40,
      height: 40,
      borderWidth: 1,
      borderColor: "#e5e7eb",
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    adminButton: {
      borderColor: "#eb7825",
    },
    menuButton: {
      borderColor: "#e5e7eb",
    },
    leaveButton: {
      borderColor: "#fecaca",
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: 48,
    },
    emptyStateIcon: {
      width: 48,
      height: 48,
      color: "#d1d5db",
      marginBottom: 16,
    },
    emptyStateTitle: {
      fontSize: 18,
      fontWeight: "500",
      color: "#111827",
      marginBottom: 8,
    },
    emptyStateSubtitle: {
      fontSize: 14,
      color: "#6b7280",
      textAlign: "center",
      marginBottom: 24,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 48,
    },
  });

  const getIconComponent = (iconName: any) => {
    if (typeof iconName === "function") {
      return iconName;
    }

    const iconMap: { [key: string]: string } = {
      Coffee: "cafe",
      TreePine: "leaf",
      Sparkles: "sparkles",
      Dumbbell: "fitness",
      Utensils: "restaurant",
      Eye: "eye",
      Heart: "heart",
      Calendar: "calendar",
      MapPin: "location",
      Clock: "time",
      Star: "star",
      Navigation: "navigate",
      Users: "people",
      Check: "checkmark",
      ThumbsUp: "thumbs-up",
      ThumbsDown: "thumbs-down",
      MessageSquare: "chatbubble",
      Share2: "share",
      X: "close",
      ChevronRight: "chevron-forward",
      ChevronLeft: "chevron-back",
      Bookmark: "bookmark",
    };

    return iconMap[iconName] || "heart";
  };

  const renderStatusBadge = (board: Board) => {
    switch (board.status) {
      case "voting":
        return (
          <View style={styles.votingBadge}>
            <Text style={styles.votingBadgeText}>Voting</Text>
          </View>
        );
      case "locked":
        return (
          <View style={styles.lockedBadge}>
            <Text style={styles.lockedBadgeText}>Locked In</Text>
          </View>
        );
      case "active":
        return (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>Active</Text>
          </View>
        );
      case "completed":
        return (
          <View style={styles.completedBadge}>
            <Text style={styles.completedBadgeText}>Completed</Text>
          </View>
        );
      default:
        return null;
    }
  };

  const renderBoardCard = ({ item: board }: { item: Board }) => {
    const IconComponent = getIconComponent(board.icon);
    return (
      <View style={styles.boardCard}>
        <View style={styles.boardContent}>
          {/* Header Section */}
          <View style={styles.boardHeader}>
            <View style={styles.boardInfo}>
              <View style={styles.boardNameRow}>
                <Text style={styles.boardName}>{board.name}</Text>
                {board.unreadMessages > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>
                      {board.unreadMessages > 99 ? "99+" : board.unreadMessages}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.boardDescription}>{board.description}</Text>
            </View>

            {/* Status Badge */}
            <View style={styles.statusBadge}>{renderStatusBadge(board)}</View>
          </View>

          {/* Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.statsContainer}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>
                  {board.participants.length}
                </Text>
                <Text style={styles.statLabel}>MEMBERS</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{board.cardsCount}</Text>
                <Text style={styles.statLabel}>EXPERIENCES</Text>
              </View>
            </View>
          </View>

          {/* Actions Section */}
          <View style={styles.actionsContainer}>
            {/* Primary Action */}
            <TouchableOpacity
              onPress={() => onOpenBoard(board.id)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Open Board</Text>
            </TouchableOpacity>

            {/* Admin Actions */}
            {isUserAdmin(board) && (
              <TouchableOpacity
                onPress={() => onInviteToSession(board.id, board.name)}
                style={[styles.secondaryButton, styles.adminButton]}
              >
                <Ionicons name="person-add" size={16} color="#eb7825" />
              </TouchableOpacity>
            )}

            {/* Board Menu */}
            <TouchableOpacity
              ref={(ref) => { menuButtonRefs.current[board.id] = ref; }}
              onPress={() => handleMenuPress(board.id)}
              style={[styles.secondaryButton, styles.menuButton]}
            >
              <Ionicons name="ellipsis-horizontal" size={16} color="#6b7280" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const renderEmptyComponent = () => {
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#eb7825" />
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Ionicons name="calendar" size={48} color="#d1d5db" />
        <Text style={styles.emptyStateTitle}>No Active Boards</Text>
        <Text style={styles.emptyStateSubtitle}>
          Start collaborating with friends to create shared experiences
        </Text>
      </View>
    );
  };

  // Only show active sessions in the boards tab
  const activeBoards = boards.filter((board) => board.status === "active");

  const notificationsEnabled = menuOpenForBoard
    ? boardNotifications[menuOpenForBoard]
    : selectedBoardForSettings
    ? boardNotifications[selectedBoardForSettings.id]
    : false;
  const currentUserId = useAppStore.getState().user?.id || "";

  // Handler to fully close the settings dropdown and clear selected board
  const handleSettingsClose = () => {
    setMenuOpenForBoard(null);
    // Don't clear selectedBoardForSettings here - let the component handle it
    // after the edit modal closes
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={activeBoards}
        renderItem={renderBoardCard}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyComponent}
        showsVerticalScrollIndicator={false}
      />

      {/* Board Settings Dropdown */}
      {selectedBoardForSettings && (
        <BoardSettingsDropdown
          visible={menuOpenForBoard !== null}
          onClose={handleSettingsClose}
          sessionId={selectedBoardForSettings.id}
          sessionName={selectedBoardForSettings.name}
          sessionCreatorId={selectedBoardForSettings.creatorId}
          currentUserId={currentUserId}
          isAdmin={isUserAdmin(selectedBoardForSettings)}
          notificationsEnabled={notificationsEnabled}
          onToggleNotifications={() => {
            onToggleNotifications(selectedBoardForSettings.id);
          }}
          onManageMembers={() => {
            if (onManageMembers) {
              onManageMembers(selectedBoardForSettings.id, selectedBoardForSettings.name);
            }
          }}
          onExitBoard={() => {
            onExitBoard(selectedBoardForSettings.id, selectedBoardForSettings.name);
          }}
          onSessionDeleted={() => {
            if (onDeleteBoard) {
              onDeleteBoard(selectedBoardForSettings.id, selectedBoardForSettings.name);
            }
            setSelectedBoardForSettings(null);
          }}
          onSessionNameUpdated={(newName: string) => {
            if (onBoardNameUpdated) {
              onBoardNameUpdated(selectedBoardForSettings.id, newName);
            }
            setSelectedBoardForSettings(null);
          }}
          position={menuPosition}
          variant="positioned"
        />
      )}
    </View>
  );
};

export default BoardsTab;
