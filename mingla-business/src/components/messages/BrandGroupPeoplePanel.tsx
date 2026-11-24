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

import { color, scrim, space } from "../../constants/designSystem";
import type { BrandGroupMember } from "../../services/brandGroupRosterService";
import { Icon } from "../ui/Icon";
import { useBusinessMediaTranslation } from "../../i18n";

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
}: BrandGroupPeoplePanelProps): React.ReactElement {
  // #4420 design: People per side. The Team side lists your team, then
  // Mingla as one entry (hosts see Mingla staff as "Mingla").
  const { t } = useBusinessMediaTranslation();
  return (
    <View style={styles.panel} testID="brand-group-people-panel">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>People</Text>
          <Text style={styles.subtitle}>{t("messages.people_team_sub", { n: members.length || "—" })}</Text>
        </View>
        {onClose ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Close people list" onPress={onClose} style={styles.iconButton}>
            <Icon name="close" size={18} color={color.text1} />
          </Pressable>
        ) : null}
      </View>
      {/* #4304 — no inner People | Media tabs: the details rail's shared
          People / Plan / Media row is the only tab row (live double row on
          #4270's check). */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.section}>{t("messages.people_team")}</Text>
        {loading ? <ActivityIndicator color={color.text2} style={styles.state} /> : error ? (
          <Text style={styles.stateText}>{error}</Text>
        ) : members.length === 0 ? (
          <Text style={styles.stateText}>No current teammates were found.</Text>
        ) : members.map((member) => (
          <View key={member.user_id} style={styles.memberRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(member.display_name)}</Text></View>
            <View style={styles.memberCopy}>
              <Text style={styles.memberName} numberOfLines={1}>{member.display_name}</Text>
              {typeof member.email === "string" && member.email.trim().length > 0 ? (
                <Text style={styles.memberEmail} numberOfLines={2}>{member.email}</Text>
              ) : null}
            </View>
            <Text style={styles.role}>{memberRoleLabel(member.role)}</Text>
          </View>
        ))}
        <Text style={styles.section}>{t("messages.people_mingla")}</Text>
        <View style={styles.memberRow} testID="brand-group-people-mingla">
          <View style={[styles.avatar, styles.avatarMingla]}><Text style={styles.avatarTextMingla}>M</Text></View>
          <View style={styles.memberCopy}>
            <Text style={styles.memberName} numberOfLines={1}>{t("messages.people_mingla")}</Text>
            <Text style={styles.memberEmail} numberOfLines={2}>{t("messages.people_mingla_sub", { brand: groupName })}</Text>
          </View>
          <Text style={styles.role}>{t("messages.people_mingla")}</Text>
        </View>
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
          trackColor={{ false: color.fill.step, true: color.paper }}
          thumbColor={color.textStrong}
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
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close people list" onPress={props.onClose} style={StyleSheet.absoluteFillObject} />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <BrandGroupPeoplePanel {...props} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: scrim.modal },
  sheet: { height: "72%", maxHeight: "78%", overflow: "hidden", paddingTop: 8, borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, borderBottomWidth: 0, borderColor: color.lineStrong, backgroundColor: color.canvas },
  handle: { width: 38, height: 4, alignSelf: "center", marginBottom: 4, borderRadius: 2, backgroundColor: color.fill.handle },
  panel: { flex: 1, minHeight: 0, backgroundColor: color.canvas },
  header: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], borderBottomWidth: 1, borderBottomColor: color.line },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: color.text1, fontSize: 17, lineHeight: 24, fontWeight: "600" },
  subtitle: { marginTop: 2, color: color.text3, fontSize: 13 },
  section: { color: color.text3, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.84, marginTop: space[4], marginBottom: space[2] },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, borderWidth: 1, borderColor: color.lineStrong },
  list: { flex: 1, minHeight: 120 },
  listContent: { paddingHorizontal: space[4] },
  state: { margin: space[7] },
  stateText: { padding: space[7], color: color.text2, textAlign: "center" },
  memberRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  avatar: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: color.card3 },
  avatarText: { color: color.text1, fontSize: 14, fontWeight: "700" },
  avatarMingla: { backgroundColor: color.ink, borderWidth: 1, borderColor: color.lineStrong },
  avatarTextMingla: { color: color.accentText, fontSize: 14, fontWeight: "700" },
  memberCopy: { flex: 1, minWidth: 0 },
  memberName: { color: color.text1, fontSize: 15, fontWeight: "600" },
  memberEmail: { marginTop: 2, color: color.text3, fontSize: 13 },
  role: { maxWidth: 96, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: color.lineStrong, color: color.text1, fontSize: 12, fontWeight: "600" },
  notificationRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], borderTopWidth: 1, borderTopColor: color.line },
  notificationTitle: { color: color.text1, fontSize: 15, fontWeight: "600" },
  notificationBody: { marginTop: 2, color: color.text3, fontSize: 13 },
});
