import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { color, radius, space } from "../../constants/designSystem";
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
      <Text style={styles.title}>Guest chat settings</Text>
      <View style={styles.toggleRow}>
        <View style={styles.toggleCopy}>
          <Text style={styles.rowTitle}>Announcements only</Text>
          <Text style={styles.rowSub}>Only your brand can post. Guests can still read.</Text>
        </View>
        <Switch
          value={broadcastOnly}
          onValueChange={onToggleBroadcastOnly}
          trackColor={{ false: color.fill.step, true: color.paper }}
          thumbColor={broadcastOnly ? color.ink : color.text1}
        />
      </View>

      <Text style={styles.rowSub}>Your posts notify every guest. A guest message notifies you only when it tags or replies to you.</Text>
      <Text style={styles.sectionLabel}>All members · {participants.length}</Text>
      {loading ? <ActivityIndicator color={color.text2} /> : null}
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
              {participant.is_team
                ? "Your team"
                : `${participant.shown_as_going ? "Shown as going · " : ""}Joined ${new Date(participant.joined_at).toLocaleDateString()}`}
            </Text>
          </View>
          {/* #4459: the brand team stays in its Guest chat; only guests can be removed. */}
          {participant.is_team ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${participant.display_name} from the Guest chat`}
              onPress={() => onRemoveParticipant(participant.user_id)}
              style={styles.removeButton}
            >
              <Icon name="trash" size={16} color={color.errorText} />
            </Pressable>
          )}
        </View>
      ))}
    </View>
  </Sheet>
);

const styles = StyleSheet.create({
  host: {
    gap: space[4],
    padding: space[6],
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: color.text1,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    padding: space[4],
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  toggleCopy: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: color.text3,
    textTransform: "uppercase",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.tile,
  },
  avatarText: {
    color: color.text1,
    fontWeight: "700",
  },
  memberInfo: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: color.text1,
  },
  rowSub: {
    marginTop: 2,
    fontSize: 12,
    color: color.text3,
  },
  removeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: color.errorTint,
  },
});

export default GroupChatModerationSheet;
