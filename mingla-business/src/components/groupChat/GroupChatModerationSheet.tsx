import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { accent, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { Sheet } from "../ui/Sheet";
import { Icon } from "../ui/Icon";
import type { EventGroupParticipant } from "../../services/groupChatService";

export interface GroupChatModerationSheetProps {
  visible: boolean;
  onClose: () => void;
  broadcastOnly: boolean;
  participants: EventGroupParticipant[];
  loading: boolean;
  onToggleBroadcastOnly: (value: boolean) => void;
  onRemoveParticipant: (userId: string) => void;
}

export const GroupChatModerationSheet: React.FC<GroupChatModerationSheetProps> = ({
  visible,
  onClose,
  broadcastOnly,
  participants,
  loading,
  onToggleBroadcastOnly,
  onRemoveParticipant,
}) => (
  <Sheet visible={visible} onClose={onClose} snapPoint="half">
    <View style={styles.host}>
      <Text style={styles.title}>Group chat moderation</Text>
      <View style={styles.toggleRow}>
        <View style={styles.toggleCopy}>
          <Text style={styles.rowTitle}>Broadcast-only</Text>
          <Text style={styles.rowSub}>Only your team can post. Buyers can still read.</Text>
        </View>
        <Switch
          value={broadcastOnly}
          onValueChange={onToggleBroadcastOnly}
          trackColor={{ false: "rgba(255,255,255,0.16)", true: accent.tint }}
          thumbColor={broadcastOnly ? accent.warm : "#f4f4f5"}
        />
      </View>

      <Text style={styles.sectionLabel}>Members</Text>
      {loading ? <ActivityIndicator color={accent.warm} /> : null}
      {participants.map((participant) => (
        <View key={participant.user_id} style={styles.memberRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {participant.display_name.trim().charAt(0).toUpperCase() || "B"}
            </Text>
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {participant.display_name}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              Joined {new Date(participant.joined_at).toLocaleDateString()}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${participant.display_name} from chat`}
            onPress={() => onRemoveParticipant(participant.user_id)}
            style={styles.removeButton}
          >
            <Icon name="trash" size={16} color="#ff8a8a" />
          </Pressable>
        </View>
      ))}
    </View>
  </Sheet>
);

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: textTokens.primary,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  toggleCopy: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: textTokens.tertiary,
    textTransform: "uppercase",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
  },
  avatarText: {
    color: textTokens.primary,
    fontWeight: "700",
  },
  memberInfo: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  rowSub: {
    marginTop: 2,
    fontSize: 12,
    color: textTokens.tertiary,
  },
  removeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "rgba(255, 90, 90, 0.10)",
  },
});

export default GroupChatModerationSheet;
