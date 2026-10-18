/**
 * #3720 Slice G — Community tab: announcements, roadmap, email pref.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
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
import { focusCommunityTargetNode } from "../../utils/communityTargetFocus";
import { BrandSwitch } from "../ui/BrandSwitch";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { CommunityMarkdown } from "./CommunityMarkdown";
import { CommunityConversationsPanel } from "./CommunityConversationsPanel";

const LANE_LABEL: Record<CommunityRoadmapLane, string> = {
  now: "Now",
  next: "Next",
  later: "Later",
};

const LANE_ORDER: readonly CommunityRoadmapLane[] = ["now", "next", "later"];

function AnnouncementCard({
  item,
  onOpen,
}: {
  item: CommunityAnnouncement;
  onOpen: (id: string) => void;
}): React.ReactElement {
  const unread = item.read_at === null;
  return (
    <Pressable
      onPress={() => onOpen(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${unread ? ", unread" : ""}`}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <GlassCard variant="elevated" radius="md" padding={spacing.md}>
        <View style={styles.rowTop}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {communityMarkdownToPlainText(item.title)}
          </Text>
          {unread ? <View style={styles.unreadDot} /> : null}
        </View>
        {item.published_at ? (
          <Text style={styles.meta}>
            {new Date(item.published_at).toLocaleDateString()}
          </Text>
        ) : null}
        <Text style={styles.bodyPreview} numberOfLines={3}>
          {communityMarkdownToPlainText(item.body_md)}
        </Text>
      </GlassCard>
    </Pressable>
  );
}

function RoadmapCardRow({
  card,
}: {
  card: CommunityRoadmapCard;
}): React.ReactElement {
  return (
    <GlassCard variant="elevated" radius="md" padding={spacing.md}>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {card.public_title}
      </Text>
      {card.public_body ? (
        <Text style={styles.bodyPreview} numberOfLines={4}>
          {card.public_body}
        </Text>
      ) : null}
    </GlassCard>
  );
}

export interface CommunityTabPanelProps {
  targetAnnouncementId?: string;
  targetPostId?: string;
  targetSection?: "roadmap";
  onTargetLayout?: (contentY: number) => void;
}

export const CommunityTabPanel: React.FC<CommunityTabPanelProps> = ({
  targetAnnouncementId,
  targetPostId,
  targetSection,
  onTargetLayout,
}) => {
  const {
    data: announcements,
    isLoading: annsLoading,
    isError: annsError,
    refetch: refetchAnns,
  } = useCommunityAnnouncements();
  const {
    data: roadmap,
    isLoading: roadLoading,
    isError: roadError,
    refetch: refetchRoad,
  } = useCommunityRoadmap();
  const {
    enabled: emailOn,
    isLoading: prefLoading,
    setEnabled: setEmailPref,
    isSaving: prefSaving,
  } = useCommunityEmailPref();
  const { markRead } = useMarkAnnouncementRead();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [prefToast, setPrefToast] = useState<string | null>(null);
  const [announcementListY, setAnnouncementListY] = useState<number | null>(
    null,
  );
  const [targetAnnouncementY, setTargetAnnouncementY] = useState<number | null>(
    null,
  );
  const [roadmapY, setRoadmapY] = useState<number | null>(null);
  const readTargetRef = useRef<string | null>(null);
  const focusedTargetRef = useRef<string | null>(null);
  const targetAnnouncementRef = useRef<View>(null);
  const roadmapRef = useRef<View>(null);

  const focusTarget = useCallback((target: "announcement" | "roadmap") => {
    const ref =
      target === "announcement"
        ? targetAnnouncementRef.current
        : roadmapRef.current;
    focusCommunityTargetNode(ref);
  }, []);

  useEffect(() => {
    setTargetAnnouncementY(null);
    readTargetRef.current = null;
    focusedTargetRef.current = null;
  }, [targetAnnouncementId]);

  useEffect(() => {
    if (!targetAnnouncementId) return;
    const target = announcements.find(
      (item) => item.id === targetAnnouncementId,
    );
    if (!target) return;
    setExpandedId(targetAnnouncementId);
    if (
      target.read_at === null &&
      readTargetRef.current !== targetAnnouncementId
    ) {
      readTargetRef.current = targetAnnouncementId;
      void markRead(targetAnnouncementId).catch(() => undefined);
    }
  }, [announcements, markRead, targetAnnouncementId]);

  useEffect(() => {
    if (
      targetAnnouncementId &&
      announcementListY !== null &&
      targetAnnouncementY !== null
    ) {
      onTargetLayout?.(announcementListY + targetAnnouncementY);
      if (focusedTargetRef.current !== targetAnnouncementId) {
        focusedTargetRef.current = targetAnnouncementId;
        focusTarget("announcement");
      }
    }
  }, [
    announcementListY,
    onTargetLayout,
    targetAnnouncementId,
    targetAnnouncementY,
    focusTarget,
  ]);

  useEffect(() => {
    if (targetSection === "roadmap" && roadmapY !== null) {
      onTargetLayout?.(roadmapY);
      if (focusedTargetRef.current !== "roadmap") {
        focusedTargetRef.current = "roadmap";
        focusTarget("roadmap");
      }
    }
  }, [focusTarget, onTargetLayout, roadmapY, targetSection]);

  const handleOpen = useCallback(
    async (id: string): Promise<void> => {
      setExpandedId((prev) => (prev === id ? null : id));
      const target = announcements.find((a) => a.id === id);
      if (target && target.read_at === null) {
        try {
          await markRead(id);
        } catch {
          // Read receipt is best-effort; content still expands.
        }
      }
    },
    [announcements, markRead],
  );

  const handleEmailToggle = useCallback(
    async (next: boolean): Promise<void> => {
      setPrefToast(null);
      try {
        await setEmailPref(next);
      } catch {
        setPrefToast("Couldn't save that preference. Try again.");
      }
    },
    [setEmailPref],
  );

  const expanded = announcements.find((a) => a.id === expandedId) ?? null;

  const byLane = LANE_ORDER.map((lane) => ({
    lane,
    cards: roadmap.filter((c) => c.lane === lane),
  })).filter((g) => g.cards.length > 0);

  return (
    <View style={styles.col}>
      <Text style={styles.sectionLabel}>From Mingla</Text>

      {annsLoading ? (
        <View style={styles.listState}>
          <ActivityIndicator color={textTokens.secondary} />
        </View>
      ) : annsError ? (
        <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
          <Text style={styles.cardBody}>
            We couldn&apos;t load announcements just now.
          </Text>
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => void refetchAnns()}
          />
        </GlassCard>
      ) : announcements.length === 0 ? (
        <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
          <Text style={styles.emptyTitle}>No news yet</Text>
          <Text style={styles.cardBody}>
            When Mingla posts an update, it will show up here.
          </Text>
        </GlassCard>
      ) : (
        <View
          style={styles.list}
          onLayout={(event) => setAnnouncementListY(event.nativeEvent.layout.y)}
        >
          {announcements.map((item) => (
            <View
              key={item.id}
              ref={
                targetAnnouncementId === item.id
                  ? targetAnnouncementRef
                  : undefined
              }
              accessible={targetAnnouncementId === item.id}
              accessibilityLabel={
                targetAnnouncementId === item.id
                  ? `Announcement: ${communityMarkdownToPlainText(item.title)}`
                  : undefined
              }
              tabIndex={
                Platform.OS === "web" && targetAnnouncementId === item.id
                  ? -1
                  : undefined
              }
              onLayout={
                targetAnnouncementId === item.id
                  ? (event) =>
                      setTargetAnnouncementY(event.nativeEvent.layout.y)
                  : undefined
              }
            >
              {expandedId === item.id && expanded ? (
                <GlassCard variant="elevated" radius="md" padding={spacing.md}>
                  <Pressable
                    onPress={() => setExpandedId(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Collapse announcement"
                  >
                    <View style={styles.rowTop}>
                      <Text style={styles.cardTitle}>
                        {communityMarkdownToPlainText(expanded.title)}
                      </Text>
                    </View>
                    {expanded.published_at ? (
                      <Text style={styles.meta}>
                        {new Date(expanded.published_at).toLocaleDateString()}
                      </Text>
                    ) : null}
                  </Pressable>
                  <CommunityMarkdown body={expanded.body_md} />
                </GlassCard>
              ) : (
                <AnnouncementCard
                  item={item}
                  onOpen={(id) => void handleOpen(id)}
                />
              )}
            </View>
          ))}
        </View>
      )}

      <CommunityConversationsPanel targetPostId={targetPostId} />

      <View
        ref={roadmapRef}
        accessible={targetSection === "roadmap"}
        accessibilityLabel="Roadmap section"
        tabIndex={
          Platform.OS === "web" && targetSection === "roadmap" ? -1 : undefined
        }
        onLayout={(event) => setRoadmapY(event.nativeEvent.layout.y)}
      >
        <Text style={styles.sectionLabel} accessibilityRole="header">
          Roadmap
        </Text>

        {roadLoading ? (
          <View style={styles.listState}>
            <ActivityIndicator color={textTokens.secondary} />
          </View>
        ) : roadError ? (
          <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
            <Text style={styles.cardBody}>
              We couldn&apos;t load the roadmap just now.
            </Text>
            <Button
              label="Try again"
              variant="secondary"
              onPress={() => void refetchRoad()}
            />
          </GlassCard>
        ) : byLane.length === 0 ? (
          <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
            <Text style={styles.emptyTitle}>Nothing published yet</Text>
            <Text style={styles.cardBody}>
              Mingla&apos;s public roadmap will appear here when it&apos;s
              ready.
            </Text>
          </GlassCard>
        ) : (
          <View style={styles.list}>
            {byLane.map(({ lane, cards }) => (
              <View key={lane} style={styles.laneBlock}>
                <Text style={styles.laneLabel}>{LANE_LABEL[lane]}</Text>
                {cards.map((card) => (
                  <RoadmapCardRow key={card.id} card={card} />
                ))}
              </View>
            ))}
          </View>
        )}
      </View>

      <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
        <View style={styles.prefRow}>
          <View style={styles.prefCopy}>
            <Text style={styles.cardTitle}>Email me announcements</Text>
            <Text style={styles.cardBodyTight}>
              Service notices from Mingla. On by default — turn off anytime.
              Push stays on.
            </Text>
          </View>
          <BrandSwitch
            value={emailOn}
            onValueChange={(v) => void handleEmailToggle(v)}
            disabled={prefLoading || prefSaving}
            accessibilityLabel="Email me community announcements"
          />
        </View>
        {prefToast ? <Text style={styles.prefError}>{prefToast}</Text> : null}
      </GlassCard>
    </View>
  );
};

const styles = StyleSheet.create({
  col: {
    gap: spacing.md,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    color: textTokens.tertiary,
    paddingTop: spacing.xs,
  },
  list: {
    gap: spacing.sm,
  },
  listState: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  pressed: {
    opacity: 0.7,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    backgroundColor: accent.warm,
  },
  meta: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  bodyPreview: {
    marginTop: spacing.sm,
    fontSize: 13,
    lineHeight: 19,
    color: textTokens.secondary,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 19,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  cardBodyTight: {
    fontSize: 13,
    lineHeight: 19,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  laneBlock: {
    gap: spacing.sm,
  },
  laneLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: accent.warm,
    textTransform: "uppercase",
  },
  prefRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  prefCopy: {
    flex: 1,
  },
  prefError: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: textTokens.secondary,
  },
});
