/** #3720 Help & Support hub for Host iOS, Android and web. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { ScrollView as RNScrollView } from "react-native";
// #4420 keyboard rule: the Support tab holds the new-request form (subject +
// message), so the scroller keeps the focused field above the keyboard.
import { ScrollView } from "../../src/wrappers/SmartScrollView";
// orch-strict-grep-allow orch-0892 — requester hub inputs remain above the fold; support thread keyboard handling stays in SupportThread.native.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  CommunityTabPanel,
  type CommunitySectionId,
} from "../../src/components/support/CommunityTabPanel";
import { GuidesTabPanel } from "../../src/components/support/GuidesTabPanel";
import { HelpSupportHubTabs } from "../../src/components/support/HelpSupportHubTabs";
import { LazySupportTabPanel } from "../../src/components/support/LazySupportScreens";
import { Icon, type IconName } from "../../src/components/ui/Icon";
import { DesktopCanvas } from "../../src/components/ui/DesktopCanvas";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Toast } from "../../src/components/ui/Toast";
import {
  color,
  radius,
  space,
  type,
} from "../../src/constants/designSystem";
import { DESKTOP_RAIL_WIDTH } from "../../src/constants/desktopLayout";
import { useCommunityUnreadCount } from "../../src/hooks/useCommunity";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
import { useAuth } from "../../src/context/AuthContext";
// #4304 — the tabs layout owns the first-run gate and publishes the reduced
// nav here; importing the gate itself would hoist it into the web boot chunk.
import { useFirstRunStore } from "../../src/store/firstRunStore";
import { useStickyFooterOffset } from "../../src/hooks/useStickyFooterOffset";
import { listCommunityPosts } from "../../src/services/communityService";
import {
  type HelpSupportTabId,
  isHelpSupportTabId,
  loadLastHelpSupportTab,
  resolveInitialHelpSupportTab,
  saveLastHelpSupportTab,
} from "../../src/utils/helpSupportLastTab";
import { MINGLA_BUSINESS_LOGO } from "@mingla/brand-assets";

const APP_TABS: { id: string; icon: IconName; label: string }[] = [
  { id: "home", icon: "home", label: "Home" },
  { id: "hub", icon: "calendar", label: "Hub" },
  { id: "ari", icon: "sparkle", label: "Ari" },
  // #4420 — the collapsed rail has no Blast item; Blast maps to Campaigns.
  { id: "marketing/campaigns", icon: "send", label: "Campaigns" },
];

function SupportDesktopRail({ onChange, locked }: { onChange: (id: string) => void; locked: boolean }) {
  // #4304 — a first-run host's rail is Ari only here (Account is this page).
  const tabs = locked ? APP_TABS.filter((item) => item.id === "ari") : APP_TABS;
  return (
    <View style={styles.appRail} accessibilityRole="tablist">
      <Image source={MINGLA_BUSINESS_LOGO} style={styles.brandLogo} resizeMode="contain" accessibilityIgnoresInvertColors />
      {tabs.map((item) => (
        <Pressable key={item.id} onPress={() => onChange(item.id)} accessibilityRole="tab" accessibilityLabel={item.label} style={styles.appRailItem}>
          <Icon name={item.icon} size={20} color={color.text2} />
          <Text style={styles.appRailLabel}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function SupportRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const { user } = useAuth();
  const lockedNavUserId = useFirstRunStore((s) => s.lockedNavUserId);
  const firstRunLocked = lockedNavUserId !== null && lockedNavUserId === (user?.id ?? null);
  const floatingBottom = useStickyFooterOffset();
  const params = useLocalSearchParams<{
    tab?: string | string[];
    announcementId?: string | string[];
    communityPost?: string | string[];
    section?: string | string[];
    new?: string | string[];
  }>();
  const queryTab = firstParam(params.tab);
  const targetAnnouncementId = firstParam(params.announcementId);
  const targetPostId = firstParam(params.communityPost);
  const targetSection = firstParam(params.section) === "roadmap" ? "roadmap" : undefined;
  const hasCommunityTarget = Boolean(targetAnnouncementId || targetPostId || targetSection);
  const scrollRef = useRef<RNScrollView>(null);
  const { count: unreadCount, isLoading: unreadLoading } = useCommunityUnreadCount();
  const [activeTab, setActiveTab] = useState<HelpSupportTabId | null>(hasCommunityTarget ? "community" : null);
  const [communitySection, setCommunitySection] = useState<CommunitySectionId>(targetSection ?? "announcements");
  const [initialResolved, setInitialResolved] = useState(hasCommunityTarget);
  const [toast, setToast] = useState({ visible: false, message: "" });
  const [composeRequestKey, setComposeRequestKey] = useState(0);

  useEffect(() => {
    if (isHelpSupportTabId(queryTab)) {
      setActiveTab(queryTab);
      setInitialResolved(true);
      return;
    }
    if (initialResolved || unreadLoading) return;
    let cancelled = false;
    void (async () => {
      const last = await loadLastHelpSupportTab();
      if (!cancelled) {
        setActiveTab(resolveInitialHelpSupportTab({ queryTab: null, unreadCount, lastTab: last }));
        setInitialResolved(true);
      }
    })();
    return () => { cancelled = true; };
  }, [initialResolved, queryTab, unreadCount, unreadLoading]);

  useEffect(() => {
    if (!targetPostId) return;
    let cancelled = false;
    void listCommunityPosts()
      .then((posts) => {
        if (cancelled) return;
        const target = posts.find((post) => post.id === targetPostId);
        if (target) setCommunitySection(target.kind === "idea" ? "ideas" : "questions");
      })
      .catch(() => {
        // The active Community tab still gives the host a useful recovery path.
      });
    return () => { cancelled = true; };
  }, [targetPostId]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/account" as never);
  }, [router]);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  const handleTabChange = useCallback((tab: HelpSupportTabId) => {
    setActiveTab(tab);
    scrollToTop();
    void saveLastHelpSupportTab(tab);
  }, [scrollToTop]);

  const handleCommunitySectionChange = useCallback((section: CommunitySectionId) => {
    setCommunitySection(section);
    scrollToTop();
  }, [scrollToTop]);

  const showToast = useCallback((message: string) => setToast({ visible: true, message }), []);
  const tab: HelpSupportTabId = activeTab ?? "support";
  const communityAction = useMemo(() => {
    if (communitySection === "announcements") {
      return {
        label: "Chat with support",
        icon: "chat" as const,
        onPress: () => handleTabChange("support"),
      };
    }
    if (communitySection === "questions") {
      return {
        label: "Ask a question",
        icon: "chat" as const,
        onPress: () => setComposeRequestKey((value) => value + 1),
      };
    }
    return {
      label: "Suggest an idea",
      icon: "sparkle" as const,
      onPress: () => {
        if (communitySection !== "ideas") setCommunitySection("ideas");
        setComposeRequestKey((value) => value + 1);
      },
    };
  }, [communitySection, handleTabChange]);

  const communityPanel = (
    <CommunityTabPanel
      activeSection={communitySection}
      onSectionChange={handleCommunitySectionChange}
      showSectionTabs
      targetAnnouncementId={targetAnnouncementId}
      targetPostId={targetPostId}
      targetSection={targetSection}
      onTargetLayout={(contentY) => scrollRef.current?.scrollTo({ y: Math.max(0, contentY - space[2]), animated: true })}
      composeRequestKey={composeRequestKey}
      action={communityAction}
    />
  );

  return (
    <DesktopCanvas>
      <View style={[styles.host, { paddingTop: insets.top, backgroundColor: color.canvas }]}>
        {/* #4420 — desktop keeps the page header too (close + title). */}
        <View style={styles.chromeRow}>
          <IconChrome icon="close" onPress={handleBack} accessibilityLabel="Back" />
          <Text style={styles.chromeTitle}>Help &amp; Support</Text>
          <View style={styles.chromeRightSlot} />
        </View>

        <HelpSupportHubTabs active={tab} onChange={handleTabChange} communityBadge={unreadCount} />

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            tab === "guides" && styles.guidesContent,
            { paddingBottom: insets.bottom + (tab === "community" && !isWideDesktop ? 144 : space[7]) },
          ]}
          scrollEnabled={tab !== "guides"}
          showsVerticalScrollIndicator={false}
          key={`${tab}:${tab === "community" ? communitySection : "root"}`}
        >
          {tab === "community" ? communityPanel : null}
          {tab === "support" ? <LazySupportTabPanel onToast={showToast} startNew={firstParam(params.new) === "1"} /> : null}
          {tab === "guides" ? <GuidesTabPanel onToast={showToast} /> : null}
        </ScrollView>

        {tab === "community" && !isWideDesktop ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={communityAction.label}
            onPress={communityAction.onPress}
            testID="community-floating-action"
            style={({ pressed }) => [styles.floatingAction, { bottom: floatingBottom }, pressed && styles.floatingActionPressed]}
          >
            <Icon name={communityAction.icon} size={20} color={color.ink} />
            <Text style={styles.floatingActionText}>{communityAction.label}</Text>
          </Pressable>
        ) : null}
        {/* #4420 B6: the root HostDesktopShell now draws the grouped sidebar on
            desktop for this route, so the page no longer mounts its own rail. */}
        <View style={styles.toastWrap} pointerEvents="box-none"><Toast visible={toast.visible} kind="info" message={toast.message} onDismiss={() => setToast({ visible: false, message: "" })} /></View>
      </View>
    </DesktopCanvas>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  chromeRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[2], gap: space[2] },
  chromeTitle: { flex: 1, fontSize: 17, fontWeight: "600", color: color.text1, textAlign: "center" },
  chromeRightSlot: { width: 36 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: space[4], paddingTop: space[2], gap: space[4], width: "100%" },
  guidesContent: { flexGrow: 1 },
  floatingAction: { position: "absolute", right: space[4], minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1], paddingHorizontal: space[4], borderRadius: radius.full, backgroundColor: color.paper, zIndex: 40, elevation: 8 },
  floatingActionPressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
  floatingActionText: { ...type.btnSm, color: color.ink, fontWeight: "800" },
  toastWrap: { position: "absolute", top: 80, left: 0, right: 0, zIndex: 100, elevation: 12 },
  appRail: { position: "fixed" as unknown as "absolute", top: 0, left: 0, bottom: "var(--mingla-privacy-inset, 0px)" as unknown as number, width: DESKTOP_RAIL_WIDTH, alignItems: "center", paddingVertical: space[6], gap: space[2], borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: color.line, zIndex: 50 },
  brandLogo: { width: 40, height: 40, marginBottom: space[4] },
  appRailItem: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 2 },
  appRailLabel: { color: color.text2, fontSize: 9, lineHeight: 11 },
});
