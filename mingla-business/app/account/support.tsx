/** #3720 Help & Support hub for Host iOS, Android and web. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
// orch-strict-grep-allow orch-0892 — requester hub inputs remain above the fold; support thread keyboard handling stays in SupportThread.native.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  CommunityTabPanel,
  type CommunitySectionId,
} from "../../src/components/support/CommunityTabPanel";
import { GuidesTabPanel } from "../../src/components/support/GuidesTabPanel";
import { HelpSupportHubTabs } from "../../src/components/support/HelpSupportHubTabs";
import { SupportTabPanel } from "../../src/components/support/SupportTabPanel";
import { Icon, type IconName } from "../../src/components/ui/Icon";
import { DesktopCanvas } from "../../src/components/ui/DesktopCanvas";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Toast } from "../../src/components/ui/Toast";
import { accent, canvas, radius, spacing, text as textTokens, typography } from "../../src/constants/designSystem";
import { DESKTOP_RAIL_WIDTH } from "../../src/constants/desktopLayout";
import { useCommunityUnreadCount } from "../../src/hooks/useCommunity";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
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
  { id: "marketing", icon: "send", label: "Blast" },
];

function SupportDesktopRail({ onChange }: { onChange: (id: string) => void }) {
  return (
    <View style={styles.appRail} accessibilityRole="tablist">
      <Image source={MINGLA_BUSINESS_LOGO} style={styles.brandLogo} resizeMode="contain" accessibilityIgnoresInvertColors />
      {APP_TABS.map((item) => (
        <Pressable key={item.id} onPress={() => onChange(item.id)} accessibilityRole="tab" accessibilityLabel={item.label} style={styles.appRailItem}>
          <Icon name={item.icon} size={20} color="#b9b9c2" />
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
  const floatingBottom = useStickyFooterOffset();
  const params = useLocalSearchParams<{
    tab?: string | string[];
    announcementId?: string | string[];
    communityPost?: string | string[];
    section?: string | string[];
  }>();
  const queryTab = firstParam(params.tab);
  const targetAnnouncementId = firstParam(params.announcementId);
  const targetPostId = firstParam(params.communityPost);
  const targetSection = firstParam(params.section) === "roadmap" ? "roadmap" : undefined;
  const hasCommunityTarget = Boolean(targetAnnouncementId || targetPostId || targetSection);
  const scrollRef = useRef<ScrollView>(null);
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
      onTargetLayout={(contentY) => scrollRef.current?.scrollTo({ y: Math.max(0, contentY - spacing.sm), animated: true })}
      composeRequestKey={composeRequestKey}
      action={communityAction}
    />
  );

  return (
    <DesktopCanvas>
      <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
        {!isWideDesktop ? (
          <View style={styles.chromeRow}>
            <IconChrome icon="close" size={36} onPress={handleBack} accessibilityLabel="Back" />
            <Text style={styles.chromeTitle}>Help &amp; Support</Text>
            <View style={styles.chromeRightSlot} />
          </View>
        ) : null}

        <HelpSupportHubTabs active={tab} onChange={handleTabChange} communityBadge={unreadCount} />

        {/* orch-strict-grep-allow orch-0892 — short requester sections; no chat composer or thread keyboard lifecycle here. */}
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            tab === "guides" && styles.guidesContent,
            { paddingBottom: insets.bottom + (tab === "community" && !isWideDesktop ? 144 : spacing.xl) },
          ]}
          scrollEnabled={tab !== "guides"}
          showsVerticalScrollIndicator={false}
          key={`${tab}:${tab === "community" ? communitySection : "root"}`}
        >
          {tab === "community" ? communityPanel : null}
          {tab === "support" ? <SupportTabPanel onToast={showToast} /> : null}
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
            <Icon name={communityAction.icon} size={20} color={textTokens.inverse} />
            <Text style={styles.floatingActionText}>{communityAction.label}</Text>
          </Pressable>
        ) : null}
        {isWideDesktop ? <SupportDesktopRail onChange={(id) => router.push(`/(tabs)/${id}` as never)} /> : null}
        <View style={styles.toastWrap} pointerEvents="box-none"><Toast visible={toast.visible} kind="info" message={toast.message} onDismiss={() => setToast({ visible: false, message: "" })} /></View>
      </View>
    </DesktopCanvas>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  chromeRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm },
  chromeTitle: { flex: 1, fontSize: 17, fontWeight: "600", color: textTokens.primary, textAlign: "center" },
  chromeRightSlot: { width: 36 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.md, width: "100%" },
  guidesContent: { flexGrow: 1 },
  floatingAction: { position: "absolute", right: spacing.md, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: accent.warm, zIndex: 40, elevation: 8 },
  floatingActionPressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
  floatingActionText: { ...typography.buttonMd, color: textTokens.inverse, fontWeight: "800" },
  toastWrap: { position: "absolute", top: 80, left: 0, right: 0, zIndex: 100, elevation: 12 },
  appRail: { position: "fixed" as unknown as "absolute", top: 0, left: 0, bottom: "var(--mingla-privacy-inset, 0px)" as unknown as number, width: DESKTOP_RAIL_WIDTH, alignItems: "center", paddingVertical: spacing.lg, gap: spacing.sm, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "rgba(255,255,255,0.10)", zIndex: 50 },
  brandLogo: { width: 40, height: 40, marginBottom: spacing.md },
  appRailItem: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 2 },
  appRailLabel: { color: "#a1a1aa", fontSize: 9, lineHeight: 11 },
});
