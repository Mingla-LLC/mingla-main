/**
 * #4304 — the /messages inbox screen (support row, customer enquiries and the
 * brand list, one row per brand since #4420). The /messages route loads it on demand through the
 * Brand-group thread route's module, so the inbox list, tiles, thread model
 * and chat tokens ship in ONE lazy web chunk instead of the eager __common
 * boot chunk (bundle-baseline-movement). Only app/messages/[conversationId].tsx
 * may import this file statically.
 */
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { SafeScreen } from "../ui/SafeScreen";
import { TopBar } from "../ui/TopBar";
import { Icon } from "../ui/Icon";
import { BrandGroupInboxList } from "./BrandGroupInboxList";
import { useBrandGuestChats } from "../../hooks/useBrandGuestChats";
import { useAuth } from "../../context/AuthContext";
import { useBrandGroups } from "../../hooks/useBrandGroups";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useSupportStaff } from "../../hooks/useSupportStaff";
import { brandEnquiryThreadRoute } from "../../utils/brandEnquiryWaiting";
import { brandInboxRowHref } from "../../utils/brandMessagesInbox";
import { useBusinessMediaTranslation } from "../../i18n";
import { useMessagesEnglishReady } from "../groupChat/LazyGroupChatPanel";
import { Button } from "../ui/Button";
import { brandGroupChat } from "../../constants/brandGroupChatTokens";
import { color, space } from "../../constants/designSystem";


// #4111 — the enquiry list loads with this route, never in the boot chunk.
// Same module as the enquiry route's thread, so the two share one lazy chunk.
const LazyBrandEnquiryListSection = React.lazy(async () => ({
  default: (await import("./BrandEnquiryScreens")).BrandEnquiryListSection,
}));

/** Support inbox row + customer enquiries: everything above the brands. */
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
      {/* #4111 D4 — customer enquiries sit above the brands. */}
      {/* #4420: the enquiries sit on the same 16 gutter as the support row
          and the brand rows (they ran to the pane edge). */}
      <View style={styles.enquiries}>
        <React.Suspense fallback={null}>
          <LazyBrandEnquiryListSection onOpen={(item) => router.push(brandEnquiryThreadRoute(item.id) as never)} />
        </React.Suspense>
      </View>
    </View>
  );
}

/**
 * #4420 — one row per brand. The GUESTS section is gone: a brand's Guest chat
 * is the Guests side of its one thread (Team | Guests switcher), opened from
 * the brand's row.
 */
export function BrandGroupInboxScreen(): React.ReactElement {
  const router = useRouter();
  const { user } = useAuth();
  const { groups, loading, error, refresh } = useBrandGroups();
  const guestChats = useBrandGuestChats();
  const staff = useSupportStaff();
  const { isWideDesktop } = useResponsiveLayout();
  const { t } = useBusinessMediaTranslation();
  // #4420: the Messages words load on intent (never in the boot chunk).
  const words = useMessagesEnglishReady();

  if (!words.ready) {
    return (
      <SafeScreen edges={["top"]} style={styles.screen} testID="brand-groups-messages-index">
        <View style={styles.wordsState} accessibilityLabel={t("messages.opening")}>
          {words.error ? (
            <>
              <Text style={styles.desktopEmptyText}>{t("messages.words_failed")}</Text>
              <Button label={t("messages.try_again")} variant="secondary" onPress={words.retry} />
            </>
          ) : <ActivityIndicator color={color.text2} />}
        </View>
      </SafeScreen>
    );
  }

  const list = (
    <BrandGroupInboxList
      groups={groups}
      guestChats={guestChats.chats}
      guestActivity={guestChats.activity}
      loading={loading}
      error={error}
      onRetry={() => {
        void refresh();
        void guestChats.refresh();
      }}
      viewerId={user?.id ?? null}
      isStaff={staff.isStaff}
      onOpen={(row) => router.push(brandInboxRowHref(row) as never)}
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
            <Text style={styles.desktopEmptyTitle}>{t("messages.desktop_empty_title")}</Text>
            <Text style={styles.desktopEmptyText}>{t("messages.desktop_empty_body")}</Text>
          </ScrollView>
        </View>
      ) : list}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: brandGroupChat.screenBg },
  header: { gap: space[2], paddingBottom: space[2] },
  supportRow: { minHeight: 64, marginHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brandGroupChat.accentSoft },
  supportRowPressed: { opacity: 0.75 },
  supportIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.tile },
  supportCopy: { flex: 1, minWidth: 0, gap: 2 },
  supportTitle: { color: brandGroupChat.textPrimary, fontSize: 15, fontWeight: "700" },
  supportText: { color: brandGroupChat.textSoft, fontSize: 13 },
  desktop: { flex: 1, flexDirection: "row" },
  wordsState: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], padding: space[6] },
  enquiries: { marginHorizontal: space[4] },
  // #4420 one-thread design: the inbox column is 360.
  desktopList: { width: 360, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: brandGroupChat.hairline },
  desktopEmptyScroll: { flex: 1 },
  desktopEmpty: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[7] },
  desktopEmptyTitle: { color: brandGroupChat.textPrimary, fontSize: 18, fontWeight: "700" },
  desktopEmptyText: { color: brandGroupChat.textSoft, fontSize: 14, lineHeight: 20, maxWidth: 380, textAlign: "center" },
});
