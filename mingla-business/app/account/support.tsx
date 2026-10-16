/**
 * Help & Support hub — META-ORCH-1104 Phase 1 + #3720 Slice G.
 *
 * Tabs: Community · Support · Guides. Opens on Community when there are
 * unread announcements; otherwise restores the last tab used. Settings list
 * entry is unchanged aside from an unread badge.
 *
 * Reachable on native iOS + Android AND business web. I-21: operator-side
 * route — NEVER imported by anon-tolerant buyer routes.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
// orch-strict-grep-allow orch-0892 — web-exported requester screen; plain ScrollView over a short ticket list, single subject input sits above the fold (no focused-input keyboard scroll). The chat-thread keyboard handling lives in the quarantined SupportThread.native (keyboard-controller), not here.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  spacing,
  text as textTokens,
} from "../../src/constants/designSystem";
import { CommunityTabPanel } from "../../src/components/support/CommunityTabPanel";
import { GuidesTabPanel } from "../../src/components/support/GuidesTabPanel";
import { HelpSupportHubTabs } from "../../src/components/support/HelpSupportHubTabs";
import { SupportTabPanel } from "../../src/components/support/SupportTabPanel";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Toast } from "../../src/components/ui/Toast";
import { useCommunityUnreadCount } from "../../src/hooks/useCommunity";
import {
  type HelpSupportTabId,
  isHelpSupportTabId,
  loadLastHelpSupportTab,
  resolveInitialHelpSupportTab,
  saveLastHelpSupportTab,
} from "../../src/utils/helpSupportLastTab";

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default function SupportRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    tab?: string | string[];
    announcementId?: string | string[];
    section?: string | string[];
  }>();
  const queryTab = firstParam(params.tab);
  const targetAnnouncementId = firstParam(params.announcementId);
  const targetSection =
    firstParam(params.section) === "roadmap" ? "roadmap" : undefined;
  const scrollRef = useRef<ScrollView>(null);

  const { count: unreadCount, isLoading: unreadLoading } =
    useCommunityUnreadCount();

  const [activeTab, setActiveTab] = useState<HelpSupportTabId | null>(null);
  const [initialResolved, setInitialResolved] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  // Resolve once: query tab → unread Community → last tab → Support.
  useEffect(() => {
    if (isHelpSupportTabId(queryTab)) {
      setActiveTab(queryTab);
      setInitialResolved(true);
      return;
    }
    if (initialResolved) return;
    if (unreadLoading) return;

    let cancelled = false;
    void (async () => {
      const last = await loadLastHelpSupportTab();
      if (cancelled) return;
      setActiveTab(
        resolveInitialHelpSupportTab({
          queryTab: null,
          unreadCount,
          lastTab: last,
        }),
      );
      setInitialResolved(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [queryTab, unreadLoading, unreadCount, initialResolved]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/account" as never);
  }, [router]);

  const handleTabChange = useCallback((tab: HelpSupportTabId): void => {
    setActiveTab(tab);
    void saveLastHelpSupportTab(tab);
  }, []);

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleCommunityTargetLayout = useCallback((contentY: number): void => {
    scrollRef.current?.scrollTo({
      y: Math.max(0, contentY - spacing.sm),
      animated: true,
    });
  }, []);

  const tab: HelpSupportTabId = activeTab ?? "support";

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Help &amp; Support</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      <HelpSupportHubTabs
        active={tab}
        onChange={handleTabChange}
        communityBadge={unreadCount}
      />

      {/* #1841 re-cover, NOT a new grant: the identical approved reason, moved
          to the occurrence it was always meant to cover. Before #1841 the gate
          only ever examined a file's FIRST match line, so the marker at the
          import silently immunised every container in the file; allowlisting is
          now per-occurrence, so the approval is stated where it applies. */}
      {/* orch-strict-grep-allow orch-0892 — web-exported requester screen; plain ScrollView over a short ticket list, single subject input sits above the fold (no focused-input keyboard scroll). The chat-thread keyboard handling lives in the quarantined SupportThread.native (keyboard-controller), not here. */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {tab === "community" ? (
          <CommunityTabPanel
            targetAnnouncementId={targetAnnouncementId}
            targetSection={targetSection}
            onTargetLayout={handleCommunityTargetLayout}
          />
        ) : null}
        {tab === "support" ? <SupportTabPanel onToast={showToast} /> : null}
        {tab === "guides" ? <GuidesTabPanel onToast={showToast} /> : null}
      </ScrollView>

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
