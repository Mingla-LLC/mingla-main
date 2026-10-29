/** #3720 Host Community sections: Announcements, Roadmap, Ideas, Questions. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import {
  accent,
  glass,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  useCommunityAnnouncements,
  useCommunityEmailPref,
  useCommunityRoadmap,
  useMarkAnnouncementRead,
} from "../../hooks/useCommunity";
import type {
  CommunityAnnouncement,
  CommunityRoadmapCard,
  CommunityRoadmapLane,
} from "../../services/communityService";
import { communityMarkdownToPlainText } from "../../utils/communityMarkdown";
import { truncateRoadmapBlurb } from "../../utils/roadmapBlurb";
import { selectedCommunityTabOffset, type HorizontalFrame } from "../../utils/communityTabReveal";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { BrandSwitch } from "../ui/BrandSwitch";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon, type IconName } from "../ui/Icon";
import { CommunityMarkdown } from "./CommunityMarkdown";
import { CommunityConversationsPanel } from "./CommunityConversationsPanel";

export type CommunitySectionId = "announcements" | "roadmap" | "ideas" | "questions";

export const COMMUNITY_SECTIONS: readonly { id: CommunitySectionId; label: string }[] = [
  { id: "announcements", label: "Announcements" },
  { id: "roadmap", label: "Roadmap" },
  { id: "ideas", label: "Ideas" },
  { id: "questions", label: "Questions" },
];

const LANE_LABEL: Record<CommunityRoadmapLane, string> = {
  now: "Now",
  next: "Next",
  later: "Later",
  shipped: "Recently shipped",
};
const LANE_ORDER = ["now", "next", "later"] as const;

function AnnouncementCard({ item, onOpen }: { item: CommunityAnnouncement; onOpen: (id: string) => void }) {
  const unread = item.read_at === null;
  return (
    <Pressable onPress={() => onOpen(item.id)} accessibilityRole="button" accessibilityLabel={`${item.title}${unread ? ", unread" : ""}`} style={({ pressed }) => [pressed && styles.pressed]}>
      <GlassCard variant="elevated" radius="md" padding={spacing.md} style={unread ? styles.unreadCard : null}>
        <View style={styles.rowTop}>
          <Text style={styles.cardTitle} numberOfLines={2}>{communityMarkdownToPlainText(item.title)}</Text>
          {unread ? <View style={styles.unreadDot} /> : null}
        </View>
        {item.published_at ? <Text style={styles.meta}>{new Date(item.published_at).toLocaleDateString()}</Text> : null}
        <Text style={styles.bodyPreview} numberOfLines={3}>{communityMarkdownToPlainText(item.body_md)}</Text>
      </GlassCard>
    </Pressable>
  );
}

function RoadmapCardRow({ card }: { card: CommunityRoadmapCard }) {
  return (
    <GlassCard variant="elevated" radius="md" padding={spacing.md}>
      <Text style={styles.cardTitle}>{card.public_title}</Text>
      {card.public_body ? <Text style={styles.bodyPreview}>{truncateRoadmapBlurb(card.public_body)}</Text> : null}
      {card.target_label || card.idea_count > 0 ? (
        <View style={styles.roadmapMetaRow}>
          {card.target_label ? <Text style={styles.meta}>Aiming for {card.target_label}</Text> : null}
          {card.idea_count > 0 ? <Text style={styles.meta}>Fed by {card.idea_count} host idea{card.idea_count === 1 ? "" : "s"}</Text> : null}
        </View>
      ) : null}
    </GlassCard>
  );
}

export interface CommunityTabPanelProps {
  activeSection: CommunitySectionId;
  onSectionChange: (section: CommunitySectionId) => void;
  showSectionTabs?: boolean;
  targetAnnouncementId?: string;
  targetPostId?: string;
  targetSection?: "roadmap";
  onTargetLayout?: (contentY: number) => void;
  composeRequestKey?: number;
  action?: {
    label: string;
    icon: IconName;
    onPress: () => void;
  };
}

export const CommunityTabPanel: React.FC<CommunityTabPanelProps> = ({
  activeSection,
  onSectionChange,
  showSectionTabs = true,
  targetAnnouncementId,
  targetPostId,
  targetSection,
  onTargetLayout,
  composeRequestKey = 0,
  action,
}) => {
  const { isWideDesktop, width } = useResponsiveLayout();
  const announcements = useCommunityAnnouncements();
  const roadmap = useCommunityRoadmap();
  const { enabled: emailOn, isLoading: prefLoading, setEnabled: setEmailPref, isSaving: prefSaving } = useCommunityEmailPref();
  const { markRead } = useMarkAnnouncementRead();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [prefToast, setPrefToast] = useState<string | null>(null);
  const sectionScrollRef = useRef<ScrollView>(null);
  const sectionFrames = useRef(new Map<CommunitySectionId, HorizontalFrame>());
  const sectionViewportWidth = useRef(0);
  const sectionContentWidth = useRef(0);
  const sectionOffset = useRef(0);

  const revealActiveSection = useCallback((animated: boolean) => {
    const tab = sectionFrames.current.get(activeSection);
    if (!tab || sectionViewportWidth.current <= 0) return;
    const nextOffset = selectedCommunityTabOffset({
      tab,
      viewportWidth: sectionViewportWidth.current,
      currentOffset: sectionOffset.current,
      contentWidth: sectionContentWidth.current,
    });
    if (nextOffset === null) return;
    sectionScrollRef.current?.scrollTo({ x: nextOffset, animated });
  }, [activeSection]);

  useEffect(() => {
    revealActiveSection(true);
  }, [revealActiveSection]);

  useEffect(() => {
    if (targetSection === "roadmap") onSectionChange("roadmap");
  }, [onSectionChange, targetSection]);
  useEffect(() => {
    if (!targetAnnouncementId) return;
    const target = announcements.data.find((item) => item.id === targetAnnouncementId);
    if (!target) return;
    onSectionChange("announcements");
    setExpandedId(target.id);
    if (target.read_at === null) void markRead(target.id).catch(() => undefined);
    onTargetLayout?.(0);
  }, [announcements.data, markRead, onSectionChange, onTargetLayout, targetAnnouncementId]);

  const handleOpen = useCallback(async (id: string): Promise<void> => {
    setExpandedId(id);
    const target = announcements.data.find((item) => item.id === id);
    if (target?.read_at === null) await markRead(id).catch(() => undefined);
  }, [announcements.data, markRead]);

  const expanded = announcements.data.find((item) => item.id === expandedId) ?? null;
  const roadmapById = useMemo(() => new Map(roadmap.data.map((card) => [card.id, card])), [roadmap.data]);
  const byLane = LANE_ORDER.map((lane) => ({
    lane,
    cards: roadmap.data.filter((card) => card.lane === lane),
  }));
  const laneWidth = Math.max(
    132,
    Math.min(220, width > 0 ? (width - 48 - spacing.sm) / 2 : 156),
  );
  const unreadCount = announcements.data.filter((item) => item.read_at === null).length;

  const handleEmailToggle = useCallback(async (next: boolean): Promise<void> => {
    setPrefToast(null);
    try { await setEmailPref(next); } catch { setPrefToast("Couldn't save that preference. Try again."); }
  }, [setEmailPref]);

  return (
    <View style={styles.col}>
      {showSectionTabs ? (
        <View style={styles.sectionChrome}>
          <ScrollView
            ref={sectionScrollRef}
            horizontal
            style={styles.sectionScroller}
            contentContainerStyle={styles.sectionTabs}
            showsHorizontalScrollIndicator={false}
            accessibilityRole="tablist"
            onLayout={(event: LayoutChangeEvent) => {
              sectionViewportWidth.current = event.nativeEvent.layout.width;
              revealActiveSection(false);
            }}
            onContentSizeChange={(contentWidth) => {
              sectionContentWidth.current = contentWidth;
              revealActiveSection(false);
            }}
            onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
              sectionOffset.current = event.nativeEvent.contentOffset.x;
            }}
            scrollEventThrottle={16}
          >
            {COMMUNITY_SECTIONS.map((section) => {
              const selected = section.id === activeSection;
              const showUnread = section.id === "announcements" && unreadCount > 0;
              return (
                <Pressable
                  key={section.id}
                  accessibilityRole="tab"
                  accessibilityLabel={section.label}
                  accessibilityState={{ selected }}
                  onPress={() => onSectionChange(section.id)}
                  onLayout={(event: LayoutChangeEvent) => {
                    sectionFrames.current.set(section.id, event.nativeEvent.layout);
                    if (selected) revealActiveSection(false);
                  }}
                  style={[styles.sectionTab, selected && styles.sectionTabActive]}
                >
                  <Text style={[styles.sectionTabText, selected && styles.sectionTabTextActive]}>{section.label}</Text>
                  {showUnread ? <View style={styles.unreadDot} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          {action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={action.onPress}
              style={[styles.sectionAction, !isWideDesktop && styles.sectionActionCompact]}
              testID="community-tab-action"
            >
              <Icon name={action.icon} size={18} color={textTokens.inverse} />
              {isWideDesktop ? <Text style={styles.sectionActionText}>{action.label}</Text> : null}
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {activeSection === "announcements" ? (
        <View style={[styles.announcementWorkspace, isWideDesktop && styles.announcementWorkspaceWide]}>
          <View
            style={[
              styles.announcementFeed,
              isWideDesktop && styles.announcementFeedWide,
            ]}
          >
            {announcements.isLoading ? <ActivityIndicator color={textTokens.secondary} /> : announcements.isError ? (
              <GlassCard variant="elevated" radius="md" padding={spacing.lg}><Text style={styles.cardBody}>We couldn&apos;t load announcements just now.</Text><Button label="Try again" variant="secondary" onPress={() => void announcements.refetch()} /></GlassCard>
            ) : announcements.data.length === 0 ? (
              <GlassCard variant="elevated" radius="md" padding={spacing.lg}><Text style={styles.emptyTitle}>No news yet</Text><Text style={styles.cardBody}>When Mingla posts an update, it will show up here.</Text></GlassCard>
            ) : expanded ? (
              <GlassCard variant="elevated" radius="md" padding={spacing.md}>
                <Button label="Back to announcements" variant="secondary" onPress={() => setExpandedId(null)} />
                <Text style={styles.detailTitle}>{communityMarkdownToPlainText(expanded.title)}</Text>
                {expanded.published_at ? <Text style={styles.meta}>{new Date(expanded.published_at).toLocaleDateString()}</Text> : null}
                <CommunityMarkdown body={expanded.body_md} />
                {expanded.action_line ? <View style={styles.actionBox}><Text style={styles.actionHeading}>What you need to do</Text><Text style={styles.cardBodyTight}>{expanded.action_line}</Text></View> : null}
                {expanded.roadmap_card_id && roadmapById.get(expanded.roadmap_card_id) ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Open roadmap item: ${roadmapById.get(expanded.roadmap_card_id)?.public_title ?? "Roadmap"}`} onPress={() => onSectionChange("roadmap")} style={styles.roadmapLink}>
                    <Text style={styles.roadmapLinkLabel}>On the roadmap</Text>
                    <Text style={styles.cardTitle}>{roadmapById.get(expanded.roadmap_card_id)?.public_title}</Text>
                  </Pressable>
                ) : null}
              </GlassCard>
            ) : announcements.data.map((item) => <AnnouncementCard key={item.id} item={item} onOpen={(id) => void handleOpen(id)} />)}
          </View>
          <View
            style={[
              styles.announcementSupport,
              isWideDesktop && styles.announcementSupportWide,
            ]}
          >
            <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
              <View style={styles.prefRow}><View style={styles.prefCopy}><Text style={styles.cardTitle}>Email me announcements</Text><Text style={styles.cardBodyTight}>Service notices from Mingla. On by default; turn off anytime. Push stays on.</Text></View><BrandSwitch value={emailOn} onValueChange={(value) => void handleEmailToggle(value)} disabled={prefLoading || prefSaving} accessibilityLabel="Email me community announcements" /></View>
              {prefToast ? <Text style={styles.prefError}>{prefToast}</Text> : null}
            </GlassCard>
          </View>
        </View>
      ) : null}

      {activeSection === "roadmap" ? (
        <View style={styles.list}>
          {roadmap.isLoading ? <ActivityIndicator color={textTokens.secondary} /> : roadmap.isError ? (
            <GlassCard variant="elevated" radius="md" padding={spacing.lg}><Text style={styles.cardBody}>We couldn&apos;t load the roadmap just now.</Text><Button label="Try again" variant="secondary" onPress={() => void roadmap.refetch()} /></GlassCard>
          ) : (
            <ScrollView
              horizontal
              scrollEnabled={!isWideDesktop}
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={isWideDesktop ? undefined : laneWidth + spacing.md}
              contentContainerStyle={[styles.roadmapBoard, isWideDesktop && styles.roadmapBoardWide]}
              testID="community-roadmap-board"
            >
              {byLane.map(({ lane, cards }) => (
                <View key={lane} style={[styles.laneBlock, isWideDesktop ? styles.laneBlockWide : { width: laneWidth }]}>
                  <Text style={styles.laneLabel}>{LANE_LABEL[lane]}</Text>
                  {cards.length > 0 ? cards.map((card) => <RoadmapCardRow key={card.id} card={card} />) : (
                    <GlassCard variant="base" radius="md" padding={spacing.md}>
                      <Text style={styles.laneEmpty}>Nothing here yet.</Text>
                    </GlassCard>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}

      {activeSection === "ideas" ? <CommunityConversationsPanel kind="idea" targetPostId={targetPostId} composeRequestKey={composeRequestKey} /> : null}
      {activeSection === "questions" ? <CommunityConversationsPanel kind="question" targetPostId={targetPostId} composeRequestKey={composeRequestKey} /> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  col: { gap: spacing.md },
  list: { gap: spacing.md },
  sectionChrome: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionScroller: { flex: 1, minWidth: 0 },
  sectionTabs: { flexDirection: "row", gap: spacing.xs, paddingBottom: spacing.xs },
  sectionTab: { minHeight: 44, minWidth: 108, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 999, borderWidth: 1, borderColor: glass.border.profileElevated, paddingHorizontal: spacing.sm },
  sectionTabActive: { backgroundColor: accent.tint, borderColor: accent.border },
  sectionTabText: { color: textTokens.tertiary, fontSize: 12, fontWeight: "700" },
  sectionTabTextActive: { color: textTokens.primary },
  sectionAction: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: 999, paddingHorizontal: spacing.md, backgroundColor: accent.warm },
  sectionActionCompact: { width: 40, minWidth: 40, paddingHorizontal: 0 },
  sectionActionText: { color: textTokens.inverse, fontSize: 13, fontWeight: "800" },
  announcementWorkspace: { gap: spacing.md },
  announcementWorkspaceWide: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  announcementFeed: { minWidth: 0, gap: spacing.md },
  announcementFeedWide: { flexBasis: 0, flexGrow: 5 },
  announcementSupport: { minWidth: 0, gap: spacing.md },
  announcementSupportWide: { flexBasis: 0, flexGrow: 3 },
  pressed: { opacity: 0.7 },
  unreadCard: { borderColor: accent.warm, borderWidth: 2 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "600", color: textTokens.primary },
  detailTitle: { fontSize: 22, fontWeight: "800", color: textTokens.primary, marginTop: spacing.md },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: accent.warm },
  meta: { fontSize: 12, color: textTokens.tertiary, marginTop: spacing.xs },
  bodyPreview: { marginTop: spacing.sm, fontSize: 13, lineHeight: 19, color: textTokens.secondary },
  cardBody: { fontSize: 13, lineHeight: 19, color: textTokens.secondary, marginBottom: spacing.md },
  cardBodyTight: { fontSize: 13, lineHeight: 19, color: textTokens.secondary, marginTop: spacing.xs },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: textTokens.primary, marginBottom: spacing.xs },
  roadmapBoard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingBottom: spacing.xs },
  roadmapBoardWide: { width: "100%", flexGrow: 1 },
  laneBlock: { gap: spacing.sm },
  laneBlockWide: { flexBasis: 0, flexGrow: 1, minWidth: 0 },
  laneLabel: { fontSize: 12, fontWeight: "700", color: accent.warm, textTransform: "uppercase" },
  laneEmpty: { color: textTokens.tertiary, fontSize: 13 },
  roadmapMetaRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.sm, marginTop: spacing.sm },
  actionBox: { marginTop: spacing.lg, borderLeftWidth: 3, borderLeftColor: accent.warm, paddingLeft: spacing.md },
  actionHeading: { color: textTokens.primary, fontSize: 14, fontWeight: "800" },
  roadmapLink: { marginTop: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: accent.border, backgroundColor: accent.tint, padding: spacing.md },
  roadmapLinkLabel: { color: accent.warm, fontSize: 11, fontWeight: "800", marginBottom: spacing.xs },
  prefRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  prefCopy: { flex: 1 },
  prefError: { marginTop: spacing.sm, fontSize: 12, color: textTokens.secondary },
});
