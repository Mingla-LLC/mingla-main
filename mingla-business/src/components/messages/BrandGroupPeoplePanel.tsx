import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { accent, canvas, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import type { BrandGroupMember } from "../../services/brandGroupRosterService";
import { Icon } from "../ui/Icon";

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "M";
}

export function memberRoleLabel(role: string): string {
  if (role === "brand_owner") return "Owner";
  if (role === "brand_admin") return "Admin";
  if (role === "event_manager") return "Events";
  if (role === "finance_manager") return "Finance";
  if (role === "marketing_manager") return "Marketing";
  if (role === "scanner") return "Door team";
  return "Member";
}

export type BrandGroupPeoplePanelProps = {
  groupName: string;
  members: BrandGroupMember[];
  loading: boolean;
  error: string | null;
  muted: boolean;
  muteBusy: boolean;
  onToggleMute: () => void;
  onClose?: () => void;
  onShowMedia?: () => void;
};

export function BrandGroupPeoplePanel({
  groupName,
  members,
  loading,
  error,
  muted,
  muteBusy,
  onToggleMute,
  onClose,
  onShowMedia,
}: BrandGroupPeoplePanelProps): React.ReactElement {
  return (
    <View style={styles.panel} testID="brand-group-people-panel">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>People in {groupName}</Text>
          <Text style={styles.subtitle}>{members.length || "—"} current Brand teammate{members.length === 1 ? "" : "s"}</Text>
        </View>
        {onClose ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Close people list" onPress={onClose} style={styles.iconButton}>
            <Icon name="close" size={18} color={textTokens.primary} />
          </Pressable>
        ) : null}
      </View>

      {onShowMedia ? (
        <View style={styles.tabs} accessibilityRole="tablist">
          <View style={[styles.tab, styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: true }}><Text style={styles.tabActiveText}>People · {members.length || "—"}</Text></View>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: false }} onPress={onShowMedia} style={styles.tab}><Text style={styles.tabText}>Media</Text></Pressable>
        </View>
      ) : null}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={accent.warm} style={styles.state} /> : error ? (
          <Text style={styles.stateText}>{error}</Text>
        ) : members.length === 0 ? (
          <Text style={styles.stateText}>No current teammates were found.</Text>
        ) : members.map((member) => (
          <View key={member.user_id} style={styles.memberRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(member.display_name)}</Text></View>
            <View style={styles.memberCopy}>
              <Text style={styles.memberName} numberOfLines={1}>{member.display_name}</Text>
              <Text style={styles.memberEmail} numberOfLines={2}>{member.email}</Text>
            </View>
            <Text style={styles.role}>{memberRoleLabel(member.role)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.notificationRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.notificationTitle}>Mute notifications</Text>
          <Text style={styles.notificationBody}>Direct @mentions still notify you</Text>
        </View>
        <Switch
          value={muted}
          onValueChange={onToggleMute}
          disabled={muteBusy}
          trackColor={{ false: "rgba(255,255,255,0.12)", true: accent.warm }}
          thumbColor="#ffffff"
          accessibilityLabel="Mute notifications"
          accessibilityState={{ checked: muted, disabled: muteBusy }}
        />
      </View>
    </View>
  );
}

export function BrandGroupPeopleSheet(props: BrandGroupPeoplePanelProps & { visible: boolean }): React.ReactElement {
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <Pressable accessible={false} onPress={props.onClose} style={styles.backdrop}>
        <Pressable accessible={false} onPress={(event) => event.stopPropagation()} style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <BrandGroupPeoplePanel {...props} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.62)" },
  sheet: { height: "72%", maxHeight: "78%", overflow: "hidden", paddingTop: 8, borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, borderBottomWidth: 0, borderColor: glass.border.profileElevated, backgroundColor: canvas.profile },
  handle: { width: 38, height: 4, alignSelf: "center", marginBottom: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.28)" },
  panel: { flex: 1, minHeight: 0, backgroundColor: canvas.profile },
  header: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: glass.border.profileBase },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: textTokens.primary, fontSize: 17, fontWeight: "800" },
  subtitle: { marginTop: 3, color: textTokens.tertiary, fontSize: 11 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, borderWidth: 1, borderColor: glass.border.profileElevated },
  tabs: { flexDirection: "row", gap: 4, padding: 8 },
  tab: { minHeight: 40, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  tabActive: { borderWidth: 1, borderColor: "rgba(235,120,37,0.38)", backgroundColor: "rgba(235,120,37,0.10)" },
  tabText: { color: textTokens.tertiary, fontSize: 12, fontWeight: "700" },
  tabActiveText: { color: textTokens.primary, fontSize: 12, fontWeight: "800" },
  list: { flex: 1, minHeight: 120 },
  listContent: { paddingHorizontal: spacing.md },
  state: { margin: spacing.xl },
  stateText: { padding: spacing.xl, color: textTokens.secondary, textAlign: "center" },
  memberRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border.profileBase },
  avatar: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: "rgba(235,120,37,0.20)" },
  avatarText: { color: accent.warm, fontSize: 11, fontWeight: "900" },
  memberCopy: { flex: 1, minWidth: 0 },
  memberName: { color: textTokens.primary, fontSize: 12, fontWeight: "800" },
  memberEmail: { marginTop: 2, color: textTokens.tertiary, fontSize: 10 },
  role: { maxWidth: 72, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 5, borderRadius: 9, borderWidth: 1, borderColor: "rgba(235,120,37,0.32)", color: accent.warm, fontSize: 8, fontWeight: "800" },
  notificationRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: glass.border.profileBase },
  notificationTitle: { color: textTokens.primary, fontSize: 12, fontWeight: "800" },
  notificationBody: { marginTop: 2, color: textTokens.tertiary, fontSize: 9 },
});
