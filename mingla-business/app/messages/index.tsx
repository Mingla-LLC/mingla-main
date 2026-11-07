import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { SafeScreen } from "../../src/components/ui/SafeScreen";
import { TopBar } from "../../src/components/ui/TopBar";
import { Icon } from "../../src/components/ui/Icon";
import { BrandGroupInboxList } from "../../src/components/messages/BrandGroupInboxList";
import { useAuth } from "../../src/context/AuthContext";
import { useBrandGroups } from "../../src/hooks/useBrandGroups";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
import { useSupportStaff } from "../../src/hooks/useSupportStaff";
import { brandEnquiryThreadRoute } from "../../src/utils/brandEnquiryWaiting";
import { brandGroupThreadHref } from "../../src/utils/brandGroupThreadModel";
import { brandGroupChat } from "../../src/constants/brandGroupChatTokens";
import { spacing } from "../../src/constants/designSystem";

// #4111 — the enquiry list loads with this route, never in the boot chunk.
// Same module as the enquiry route's thread, so the two share one lazy chunk.
const LazyBrandEnquiryListSection = React.lazy(async () => ({
  default: (await import("../../src/components/messages/BrandEnquiryScreens")).BrandEnquiryListSection,
}));

/** Support inbox row + customer enquiries: everything above the groups. */
function MessagesInboxHeader({ isStaff }: { isStaff: boolean }): React.ReactElement {
  const router = useRouter();
  return (
    <View style={styles.header}>
      {isStaff ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Support inbox"
          onPress={() => router.push("/support/inbox" as never)}
          style={({ pressed }) => [styles.supportRow, pressed && styles.supportRowPressed]}
        >
          <View style={styles.supportIcon}><Icon name="inbox" size={20} color={brandGroupChat.accent} /></View>
          <View style={styles.supportCopy}>
            <Text style={styles.supportTitle}>Support inbox</Text>
            <Text style={styles.supportText} numberOfLines={1}>Claim, reply to and resolve customer requests</Text>
          </View>
          <Icon name="chevR" size={16} color={brandGroupChat.textMuted} />
        </Pressable>
      ) : null}
      {/* #4111 D4 — customer enquiries sit above the Brand groups. */}
      <React.Suspense fallback={null}>
        <LazyBrandEnquiryListSection onOpen={(item) => router.push(brandEnquiryThreadRoute(item.id) as never)} />
      </React.Suspense>
    </View>
  );
}

export default function MessagesIndexRoute(): React.ReactElement {
  const router = useRouter();
  const { user } = useAuth();
  const { groups, loading, error, refresh } = useBrandGroups();
  const staff = useSupportStaff();
  const { isWideDesktop } = useResponsiveLayout();

  const list = (
    <BrandGroupInboxList
      groups={groups}
      loading={loading}
      error={error}
      onRetry={() => void refresh()}
      viewerId={user?.id ?? null}
      isStaff={staff.isStaff}
      onOpen={(group) => router.push(brandGroupThreadHref(group) as never)}
      header={<MessagesInboxHeader isStaff={staff.isStaff} />}
    />
  );

  return (
    <SafeScreen edges={["top"]} style={styles.screen} testID="brand-groups-messages-index">
      <TopBar leftKind="back" title="Messages" onBack={() => router.back()} rightSlot={null} />
      {isWideDesktop ? (
        <View style={styles.desktop}>
          <View style={styles.desktopList}>{list}</View>
          <ScrollView style={styles.desktopEmptyScroll} contentContainerStyle={styles.desktopEmpty}>
            <Icon name="chat" size={36} color={brandGroupChat.textMuted} />
            <Text style={styles.desktopEmptyTitle}>Your Mingla conversations</Text>
            <Text style={styles.desktopEmptyText}>Pick a Brand group on the left. Brand groups are created automatically and stay in sync with each brand’s active team.</Text>
          </ScrollView>
        </View>
      ) : list}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: brandGroupChat.screenBg },
  header: { gap: spacing.sm, paddingBottom: spacing.sm },
  supportRow: { minHeight: 64, marginHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brandGroupChat.accentSoft },
  supportRowPressed: { opacity: 0.75 },
  supportIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(235,120,37,0.18)" },
  supportCopy: { flex: 1, minWidth: 0, gap: 2 },
  supportTitle: { color: brandGroupChat.textPrimary, fontSize: 15, fontWeight: "700" },
  supportText: { color: brandGroupChat.textSoft, fontSize: 13 },
  desktop: { flex: 1, flexDirection: "row" },
  desktopList: { width: 320, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: brandGroupChat.hairline },
  desktopEmptyScroll: { flex: 1 },
  desktopEmpty: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  desktopEmptyTitle: { color: brandGroupChat.textPrimary, fontSize: 18, fontWeight: "700" },
  desktopEmptyText: { color: brandGroupChat.textSoft, fontSize: 14, lineHeight: 20, maxWidth: 380, textAlign: "center" },
});
