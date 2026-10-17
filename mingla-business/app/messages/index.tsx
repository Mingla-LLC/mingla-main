import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { SafeScreen } from "../../src/components/ui/SafeScreen";
import { TopBar } from "../../src/components/ui/TopBar";
import { Button } from "../../src/components/ui/Button";
import { useBrandGroups } from "../../src/hooks/useBrandGroups";
import { useSupportStaff } from "../../src/hooks/useSupportStaff";
import {
  accent,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../src/constants/designSystem";
import type { BrandGroupSummary } from "../../src/services/brandGroupsService";

function GroupRow({ group, onPress }: { group: BrandGroupSummary; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.brand_name} Brand group${group.unread_count ? `, ${group.unread_count} unread` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{group.brand_name.trim().slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>{group.brand_name}</Text>
          {group.unread_count > 0 ? (
            <View style={styles.badge}><Text style={styles.badgeText}>{Math.min(group.unread_count, 99)}</Text></View>
          ) : null}
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {group.last_message_preview || `${group.member_count} people · Brand group`}
        </Text>
      </View>
    </Pressable>
  );
}

export default function MessagesIndexRoute(): React.ReactElement {
  const router = useRouter();
  const { groups, loading, error, refresh } = useBrandGroups();
  const staff = useSupportStaff();
  const ownGroups = useMemo(() => groups.filter((group) => group.access_kind === "brand"), [groups]);
  const supportGroups = useMemo(() => groups.filter((group) => group.access_kind === "support"), [groups]);

  const openGroup = (group: BrandGroupSummary): void => {
    const mode = group.access_kind === "support" ? "support" : "brand";
    router.push(`/messages/${group.conversation_id}?mode=${mode}` as never);
  };

  return (
    <SafeScreen edges={["top"]} style={styles.screen} testID="brand-groups-messages-index">
      <TopBar leftKind="back" title="Messages" onBack={() => router.back()} rightSlot={null} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={styles.heading}>Your Mingla conversations</Text>
          <Text style={styles.subheading}>Brand groups are created automatically and stay in sync with each brand’s active team.</Text>
        </View>

        {staff.isStaff ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Support inbox</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Support inbox"
              onPress={() => router.push("/support/inbox" as never)}
              style={({ pressed }) => [styles.supportRow, pressed && styles.rowPressed]}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>Customer support conversations</Text>
                <Text style={styles.preview}>Claim, reply to and resolve customer requests</Text>
              </View>
              <Text style={styles.openText}>Open</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.state}><ActivityIndicator color={accent.warm} /></View>
        ) : error ? (
          <View style={styles.state}>
            <Text style={styles.stateText}>{error}</Text>
            <Button label="Retry" variant="secondary" onPress={() => void refresh()} />
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your Brand groups</Text>
              {ownGroups.length ? ownGroups.map((group) => (
                <GroupRow key={group.conversation_id} group={group} onPress={() => openGroup(group)} />
              )) : <Text style={styles.emptyText}>Your active brand teams will appear here automatically.</Text>}
            </View>
            {staff.isStaff ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Brand groups you support</Text>
                {supportGroups.length ? supportGroups.map((group) => (
                  <GroupRow key={group.conversation_id} group={group} onPress={() => openGroup(group)} />
                )) : <Text style={styles.emptyText}>No additional Brand groups need Support access.</Text>}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: canvas.profile },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl },
  intro: { gap: spacing.xs },
  heading: { color: textTokens.primary, fontSize: 24, fontWeight: "700" },
  subheading: { color: textTokens.secondary, fontSize: 14, lineHeight: 20, maxWidth: 620 },
  section: { gap: spacing.sm },
  sectionTitle: { color: textTokens.tertiary, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 72, padding: spacing.md, borderWidth: 1, borderColor: glass.border.profileBase, borderRadius: radius.lg, backgroundColor: glass.tint.profileBase },
  supportRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 72, padding: spacing.md, borderWidth: 1, borderColor: "rgba(235,120,37,0.35)", borderRadius: radius.lg, backgroundColor: "rgba(235,120,37,0.08)" },
  rowPressed: { opacity: 0.72 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(235,120,37,0.14)", borderWidth: 1, borderColor: "rgba(235,120,37,0.35)" },
  avatarText: { color: accent.warm, fontSize: 17, fontWeight: "800" },
  rowCopy: { flex: 1, minWidth: 0, gap: 4 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowTitle: { flex: 1, color: textTokens.primary, fontSize: 16, fontWeight: "700" },
  preview: { color: textTokens.secondary, fontSize: 13 },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: accent.warm },
  badgeText: { color: "#101216", fontSize: 11, fontWeight: "800" },
  openText: { color: accent.warm, fontSize: 14, fontWeight: "700" },
  state: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.md },
  stateText: { color: textTokens.secondary, textAlign: "center" },
  emptyText: { color: textTokens.secondary, padding: spacing.md, borderWidth: 1, borderColor: glass.border.profileBase, borderRadius: radius.lg, backgroundColor: glass.tint.profileBase },
});
