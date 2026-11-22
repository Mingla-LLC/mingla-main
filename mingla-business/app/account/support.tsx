/**
 * #4420 — Help & Support for Host iOS, Android and web (spec part 2, as
 * amended by the scope cut of 2026-11-21).
 *
 * Two things: Announcements and Support. At desktop width they sit side by
 * side as columns; on a phone they are two tabs. Support has the switch
 * "Ari | A person". Where it opens is decided by the pure resolver
 * (helpSupportRoute.ts): an announcement link opens that announcement, a
 * "Get help" button opens a person, and with no address the screen opens on
 * unread news first, then Support (a person when a conversation is open,
 * otherwise Ari).
 *
 * Bundle (spec 4.3, binding): this route statically imports only the shell
 * (tabs, Announcements, the Support column frame, the resolver, the unread
 * count). Ari's chat and the support conversation load through sibling lazy
 * boundaries in LazySupportScreens.tsx.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { AnnouncementsPanel } from "../../src/components/support/AnnouncementsPanel";
import { HelpSupportHubTabs } from "../../src/components/support/HelpSupportHubTabs";
import { SupportColumn } from "../../src/components/support/SupportColumn";
import { hubCopy } from "../../src/components/support/helpSupportHubCopy";
import {
  entryNeedsConversationState,
  isOpenSupportStatus,
  resolveHelpSupportEntry,
  type HelpSupportEntry,
  type HelpSupportRouteParams,
  type HelpSupportTab,
  type SupportMode,
} from "../../src/components/support/helpSupportRoute";
import { loadSupportScreens } from "../../src/components/support/LazySupportScreens";
import { DesktopCanvas } from "../../src/components/ui/DesktopCanvas";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Toast } from "../../src/components/ui/Toast";
import { color, space } from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import { useCommunityUnreadCount } from "../../src/hooks/useCommunity";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
import {
  SUPPORT_TICKETS_DISABLED_KEY,
  SUPPORT_TICKETS_STALE_TIME_MS,
  supportTicketKeys,
} from "../../src/hooks/supportTicketKeys";

/** Announcements column width at desktop; Support takes the rest. */
const ANNOUNCEMENTS_COLUMN_WIDTH = 400;

export default function SupportRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const { isAuthReady, user } = useAuth();
  const params = useLocalSearchParams<{
    tab?: string | string[];
    mode?: string | string[];
    announcementId?: string | string[];
    new?: string | string[];
    section?: string | string[];
    communityPost?: string | string[];
  }>();
  const routeParams: HelpSupportRouteParams = params;
  const paramsKey = JSON.stringify(routeParams);
  const { count: unreadCount, isLoading: unreadLoading } = useCommunityUnreadCount();

  // The same cache entry as useSupportTickets (one key per entity); the list
  // itself comes from the support chunk, so the shell never imports the service.
  const userId = user?.id ?? null;
  const needsConversations = entryNeedsConversationState(routeParams);
  const ticketsEnabled = isAuthReady && userId !== null && needsConversations;
  const tickets = useQuery({
    queryKey: ticketsEnabled && userId !== null ? supportTicketKeys.byUser(userId) : SUPPORT_TICKETS_DISABLED_KEY,
    enabled: ticketsEnabled,
    staleTime: SUPPORT_TICKETS_STALE_TIME_MS,
    queryFn: async () => (userId === null ? [] : (await loadSupportScreens()).listOwnSupportTickets(userId)),
  });

  const [entry, setEntry] = useState<HelpSupportEntry | null>(null);
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);
  const [tab, setTab] = useState<HelpSupportTab>("support");
  const [mode, setMode] = useState<SupportMode>("ari");
  const [toast, setToast] = useState({ visible: false, message: "" });

  // Resolve once per address, after the facts it depends on have answered
  // (a failed read counts as answered: the screen still opens somewhere useful).
  const conversationsSettled = !needsConversations ? true : !ticketsEnabled ? isAuthReady : !tickets.isLoading;
  const ready = !unreadLoading && conversationsSettled;
  useEffect(() => {
    if (!ready || resolvedFor === paramsKey) return;
    const hasOpenConversation = (tickets.data ?? []).some(
      (ticket) => ticket.requester_user_id === userId && isOpenSupportStatus(ticket.status),
    );
    const next = resolveHelpSupportEntry({ params: routeParams, unreadAnnouncements: unreadCount, hasOpenConversation });
    setEntry(next);
    setTab(next.tab);
    setMode(next.mode);
    setResolvedFor(paramsKey);
    // routeParams is described by paramsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, ready, resolvedFor, tickets.data, unreadCount, userId]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/account" as never);
  }, [router]);

  const showToast = useCallback((message: string) => setToast({ visible: true, message }), []);
  const bottomInset = insets.bottom;

  const announcements = useMemo(
    () => <AnnouncementsPanel targetAnnouncementId={entry?.announcementId ?? null} bottomInset={bottomInset} />,
    [bottomInset, entry?.announcementId],
  );
  const support = entry ? (
    <SupportColumn
      key={resolvedFor ?? "entry"}
      mode={mode}
      onModeChange={setMode}
      showTitle={isWideDesktop}
      startNew={entry.startNew}
      onToast={showToast}
      bottomInset={bottomInset}
    />
  ) : null;

  return (
    <DesktopCanvas>
      <View style={[styles.host, { paddingTop: insets.top }]}>
        {/* #4420 — desktop keeps the page header too (close + title). */}
        <View style={styles.chromeRow}>
          <IconChrome icon="close" onPress={handleBack} accessibilityLabel={hubCopy("close")} />
          <Text style={styles.chromeTitle}>{hubCopy("title")}</Text>
          <View style={styles.chromeRightSlot} />
        </View>

        {entry === null ? (
          <View style={styles.opening} accessibilityRole="progressbar" accessibilityLabel={hubCopy("opening")}>
            <ActivityIndicator color={color.text2} />
          </View>
        ) : isWideDesktop ? (
          <View style={styles.columns} testID="help-support-columns">
            <View style={[styles.announcementsColumn, tab === "announcements" && styles.columnFocused]}>
              <Text style={styles.columnTitle} accessibilityRole="header">
                {unreadCount > 0
                  ? hubCopy("tabs.unread", { label: hubCopy("tabs.announcements"), count: unreadCount })
                  : hubCopy("tabs.announcements")}
              </Text>
              {announcements}
            </View>
            <View style={[styles.supportColumn, tab === "support" && styles.columnFocused]}>{support}</View>
          </View>
        ) : (
          <>
            <HelpSupportHubTabs active={tab} onChange={setTab} announcementsBadge={unreadCount} />
            {/* Both stay mounted, so switching tabs keeps Ari's conversation and anything typed. */}
            <View style={[styles.body, tab !== "announcements" && styles.hidden]}>{announcements}</View>
            <View style={[styles.body, tab !== "support" && styles.hidden]}>{support}</View>
          </>
        )}

        <View style={styles.toastWrap} pointerEvents="box-none">
          <Toast visible={toast.visible} kind="info" message={toast.message} onDismiss={() => setToast({ visible: false, message: "" })} />
        </View>
      </View>
    </DesktopCanvas>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: color.canvas },
  chromeRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[2], gap: space[2] },
  chromeTitle: { flex: 1, fontSize: 17, fontWeight: "600", color: color.text1, textAlign: "center" },
  chromeRightSlot: { width: 36 },
  opening: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minHeight: 0 },
  hidden: { display: "none" },
  columns: { flex: 1, minHeight: 0, flexDirection: "row", gap: space[4], paddingHorizontal: space[4], paddingBottom: space[4] },
  announcementsColumn: {
    width: ANNOUNCEMENTS_COLUMN_WIDTH,
    minHeight: 0,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    paddingTop: space[2],
  },
  supportColumn: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    paddingTop: space[2],
  },
  columnFocused: { borderColor: color.lineStrong },
  columnTitle: { fontSize: 17, fontWeight: "700", color: color.text1, paddingHorizontal: space[4], paddingBottom: space[2] },
  toastWrap: { position: "absolute", top: 80, left: 0, right: 0, zIndex: 100, elevation: 12 },
});
