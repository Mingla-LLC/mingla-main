/** #3720 Help & Support hub for Host iOS, Android and web. */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
// orch-strict-grep-allow orch-0892 — requester hub inputs remain above the fold; support thread keyboard handling stays in SupportThread.native.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  COMMUNITY_SECTIONS,
  CommunityTabPanel,
  type CommunitySectionId,
} from "../../src/components/support/CommunityTabPanel";
import { GuidesTabPanel } from "../../src/components/support/GuidesTabPanel";
import { HelpSupportHubTabs } from "../../src/components/support/HelpSupportHubTabs";
import { SupportTabPanel } from "../../src/components/support/SupportTabPanel";
import { Icon, type IconName } from "../../src/components/ui/Icon";
import { DesktopCanvas } from "../../src/components/ui/DesktopCanvas";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Toast } from "../../src/components/ui/Toast";
import { canvas, glass, spacing, text as textTokens } from "../../src/constants/designSystem";
import { DESKTOP_RAIL_WIDTH } from "../../src/constants/desktopLayout";
import { useCommunityUnreadCount, useSupportIsOnline } from "../../src/hooks/useCommunity";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";
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
  const { isWideDesktop, width } = useResponsiveLayout();
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
  const { online: supportOnline } = useSupportIsOnline();
  const [activeTab, setActiveTab] = useState<HelpSupportTabId | null>(hasCommunityTarget ? "community" : null);
  const [communitySection, setCommunitySection] = useState<CommunitySectionId>(targetSection ?? "announcements");
  const [initialResolved, setInitialResolved] = useState(hasCommunityTarget);
  const [toast, setToast] = useState({ visible: false, message: "" });

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
  const desktopCommunity = isWideDesktop && width >= 1100 && tab === "community";

  const communityPanel = (
    <CommunityTabPanel
      activeSection={communitySection}
      onSectionChange={handleCommunitySectionChange}
      showSectionTabs={!desktopCommunity}
      targetAnnouncementId={targetAnnouncementId}
      targetPostId={targetPostId}
      targetSection={targetSection}
      onTargetLayout={(contentY) => scrollRef.current?.scrollTo({ y: Math.max(0, contentY - spacing.sm), animated: true })}
    />
  );

  return (
    <DesktopCanvas>
      <View style={[styles.host, { paddingTop: isWideDesktop ? 0 : insets.top, backgroundColor: canvas.discover }]}>
        {isWideDesktop ? (
          <View style={styles.desktopHeader}>
            <Text style={styles.breadcrumb}>Account  ›  Help &amp; Support</Text>
            <Text style={styles.desktopTitle}>Help &amp; Support</Text>
          </View>
        ) : (
          <View style={styles.chromeRow}>
            <IconChrome icon="close" size={36} onPress={handleBack} accessibilityLabel="Back" />
            <Text style={styles.chromeTitle}>Help &amp; Support</Text>
            <View style={styles.chromeRightSlot} />
          </View>
        )}

        <HelpSupportHubTabs active={tab} onChange={handleTabChange} communityBadge={unreadCount} />

        {desktopCommunity ? (
          <View style={styles.desktopCommunity}>
            <View style={styles.sectionRail}>
              <Text style={styles.railGroup}>COMMUNITY</Text>
              {COMMUNITY_SECTIONS.map((section) => (
                <Pressable key={section.id} onPress={() => handleCommunitySectionChange(section.id)} style={[styles.railRow, communitySection === section.id && styles.railRowActive]} accessibilityRole="tab" accessibilityState={{ selected: communitySection === section.id }}>
                  <Text style={[styles.railRowText, communitySection === section.id && styles.railRowTextActive]}>{section.label}</Text>
                  {section.id === "announcements" && unreadCount > 0 ? <View style={styles.unreadDot} /> : null}
                </Pressable>
              ))}
              <Text style={styles.railGroup}>SUPPORT</Text>
              <Pressable onPress={() => handleTabChange("support")} style={styles.railRow}><Text style={styles.railRowText}>Chat with us</Text></Pressable>
              <Pressable onPress={() => handleTabChange("support")} style={styles.railRow}><Text style={styles.railRowText}>My requests</Text></Pressable>
              <Text style={styles.railGroup}>GUIDES</Text>
              <Pressable onPress={() => handleTabChange("guides")} style={styles.railRow}><Text style={styles.railRowText}>Host guides</Text></Pressable>
            </View>
            {/* orch-strict-grep-allow orch-0892 — section-scoped reading surface; composer keyboard handling is inside its page-sheet. */}
            <ScrollView ref={scrollRef} style={styles.desktopFeed} contentContainerStyle={styles.desktopFeedContent} showsVerticalScrollIndicator={false} key={communitySection}>
              {communityPanel}
            </ScrollView>
            <View style={styles.sidePanel}>
              <GlassCard variant="elevated" radius="md" padding={spacing.md}>
                <Text style={styles.sideTitle}>Have an idea?</Text>
                <Text style={styles.sideBody}>Share it with other Hosts and vote on what matters most.</Text>
                <Pressable onPress={() => handleCommunitySectionChange("ideas")} style={styles.sideAction}><Text style={styles.sideActionText}>Suggest an idea</Text></Pressable>
              </GlassCard>
              <GlassCard variant="elevated" radius="md" padding={spacing.md}>
                <Text style={styles.sideTitle}>{supportOnline ? "Support is online" : "Support is away"}</Text>
                <Text style={styles.sideBody}>{supportOnline ? "Start a chat and we'll reply here." : "Leave a request and we'll reply when we're back."}</Text>
                <Pressable onPress={() => handleTabChange("support")} style={styles.sideAction}><Text style={styles.sideActionText}>Chat with us</Text></Pressable>
              </GlassCard>
            </View>
          </View>
        ) : (
          /* orch-strict-grep-allow orch-0892 — short requester sections; no chat composer or thread keyboard lifecycle here. */
          <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={[styles.scrollContent, isWideDesktop && styles.desktopConstrained, { paddingBottom: insets.bottom + spacing.xl }]} showsVerticalScrollIndicator={false} key={`${tab}:${tab === "community" ? communitySection : "root"}`}>
            {tab === "community" ? communityPanel : null}
            {tab === "support" ? <SupportTabPanel onToast={showToast} /> : null}
            {tab === "guides" ? <GuidesTabPanel onToast={showToast} /> : null}
          </ScrollView>
        )}

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
  desktopHeader: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm },
  breadcrumb: { color: textTokens.tertiary, fontSize: 12, marginBottom: spacing.xs },
  desktopTitle: { color: textTokens.primary, fontSize: 24, fontWeight: "800" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.md },
  desktopConstrained: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: spacing.lg },
  desktopCommunity: { flex: 1, flexDirection: "row", gap: spacing.lg, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, minHeight: 0 },
  sectionRail: { width: 220, borderRightWidth: 1, borderRightColor: glass.border.profileBase, paddingRight: spacing.md },
  railGroup: { color: textTokens.tertiary, fontSize: 10, fontWeight: "800", marginTop: spacing.md, marginBottom: spacing.xs },
  railRow: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderRadius: 10, paddingHorizontal: spacing.md },
  railRowActive: { backgroundColor: "rgba(235, 120, 37, 0.12)" },
  railRowText: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
  railRowTextActive: { color: "#eb7825", fontWeight: "800" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#eb7825" },
  desktopFeed: { flex: 1, minWidth: 0 },
  desktopFeedContent: { width: "100%", maxWidth: 760, alignSelf: "center", paddingBottom: spacing.xl, gap: spacing.md },
  sidePanel: { width: 240, gap: spacing.md },
  sideTitle: { color: textTokens.primary, fontSize: 15, fontWeight: "800", marginBottom: spacing.xs },
  sideBody: { color: textTokens.secondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  sideAction: { minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: "rgba(235, 120, 37, 0.14)" },
  sideActionText: { color: "#eb7825", fontSize: 13, fontWeight: "800" },
  toastWrap: { position: "absolute", top: 80, left: 0, right: 0, zIndex: 100, elevation: 12 },
  appRail: { position: "fixed" as unknown as "absolute", top: 0, left: 0, bottom: 0, width: DESKTOP_RAIL_WIDTH, alignItems: "center", paddingVertical: spacing.lg, gap: spacing.sm, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "rgba(255,255,255,0.10)", zIndex: 50 },
  brandLogo: { width: 40, height: 40, marginBottom: spacing.md },
  appRailItem: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 2 },
  appRailLabel: { color: "#a1a1aa", fontSize: 9, lineHeight: 11 },
});
