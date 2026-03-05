import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ParticipantAvatars, Participant } from "./ParticipantAvatars";
import { BoardSession } from "../../hooks/useBoardSession";

interface BoardHeaderProps {
  session: BoardSession | null;
  participants: Participant[];
  onSettingsPress?: () => void;
  onInvitePress?: () => void;
  onParticipantPress?: (participant: Participant) => void;
  onViewAllParticipants?: () => void;
  onBack?: () => void;
  loading?: boolean;
}

export const BoardHeader: React.FC<BoardHeaderProps> = ({
  session,
  participants,
  onSettingsPress,
  onInvitePress,
  onParticipantPress,
  onViewAllParticipants,
  onBack,
  loading = false,
}) => {
  if (!session) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Board Session</Text>
        </View>
      </View>
    );
  }

  const participantCount = participants.filter((p) => p.has_accepted).length;
  const maxParticipants = session.max_participants || "∞";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/* Left: Back Button */}
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color="#6b7280" />
          </TouchableOpacity>
        )}

        {/* Center: Session Info */}
        <View style={styles.centerSection}>
          <Text style={styles.sessionName} numberOfLines={1}>
            {session.name}
          </Text>
          {(session as any).description && (
            <Text style={styles.sessionSubtitle} numberOfLines={1}>
              {(session as any).description}
            </Text>
          )}
        </View>

        {/* Right: Three-dot Menu */}
        {onSettingsPress && (
          <TouchableOpacity
            style={styles.menuButton}
            onPress={onSettingsPress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="ellipsis-horizontal" size={24} color="#6b7280" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "white",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,

    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  backButton: {
    padding: 4,
  },
  centerSection: {
    flex: 1,
    alignItems: "flex-start",
  },
  sessionName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#6b7280",
    marginBottom: 2,
  },
  sessionSubtitle: {
    fontSize: 14,
    color: "#666",
    fontWeight: "400",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: "#666",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  activeBadge: {
    backgroundColor: "#E8F5E9",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#4CAF50",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#4CAF50",
  },
  menuButton: {
    padding: 4,
  },
  participantsSection: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "500",
  },
});
