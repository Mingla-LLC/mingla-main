/**
 * #4420 — Help & Support's Announcements column (phone: its tab).
 *
 * Extracted from #3720's CommunityTabPanel with the same hooks: the list,
 * open in place, unread state and mark-read, empty / loading / error states,
 * and the "Email me announcements" switch. Roadmap, Ideas and Questions left
 * the Host app with it. Read-only: no text input, so a plain ScrollView.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  useCommunityAnnouncements,
  useCommunityEmailPref,
  useMarkAnnouncementRead,
} from "../../hooks/useCommunity";
import type { CommunityAnnouncement } from "../../services/communityService";
import { communityMarkdownToPlainText } from "../../utils/communityMarkdown";
import { color, space } from "../../constants/designSystem";
import { BrandSwitch } from "../ui/BrandSwitch";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { CommunityMarkdown } from "./CommunityMarkdown";
import { hubCopy } from "./helpSupportHubCopy";

function AnnouncementCard({ item, onOpen }: { item: CommunityAnnouncement; onOpen: (id: string) => void }): React.ReactElement {
  const unread = item.read_at === null;
  const title = communityMarkdownToPlainText(item.title);
  return (
    <Pressable
      onPress={() => onOpen(item.id)}
      accessibilityRole="button"
      accessibilityLabel={unread ? `${title}, ${hubCopy("announcements.unread")}` : title}
      style={({ pressed }) => [pressed && styles.pressed]}
      testID={`announcement-${item.id}`}
    >
      <GlassCard variant="elevated" radius="md" padding={space[4]} style={unread ? styles.unreadCard : null}>
        <View style={styles.rowTop}>
          <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
          {unread ? <View style={styles.unreadDot} /> : null}
        </View>
        {item.published_at ? <Text style={styles.meta}>{new Date(item.published_at).toLocaleDateString()}</Text> : null}
        <Text style={styles.bodyPreview} numberOfLines={3}>{communityMarkdownToPlainText(item.body_md)}</Text>
      </GlassCard>
    </Pressable>
  );
}

export interface AnnouncementsPanelProps {
  /** A deep link's announcement: opened in place once the list arrives. */
  targetAnnouncementId: string | null;
  /** Bottom padding for the last card (safe area). */
  bottomInset: number;
}

export const AnnouncementsPanel: React.FC<AnnouncementsPanelProps> = ({ targetAnnouncementId, bottomInset }) => {
  const announcements = useCommunityAnnouncements();
  const { enabled: emailOn, isLoading: prefLoading, setEnabled: setEmailPref, isSaving: prefSaving } = useCommunityEmailPref();
  const { markRead } = useMarkAnnouncementRead();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const handledTarget = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const open = useCallback(async (item: CommunityAnnouncement): Promise<void> => {
    setExpandedId(item.id);
    setReadError(null);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    if (item.read_at !== null) return;
    try {
      await markRead(item.id);
    } catch {
      // Not silent: the host is told, and the card stays unread.
      setReadError(hubCopy("announcements.mark_read_error"));
    }
  }, [markRead]);

  useEffect(() => {
    if (!targetAnnouncementId || handledTarget.current === targetAnnouncementId) return;
    const target = announcements.data.find((item) => item.id === targetAnnouncementId);
    if (!target) return;
    handledTarget.current = targetAnnouncementId;
    void open(target);
  }, [announcements.data, open, targetAnnouncementId]);

  const handleEmailToggle = useCallback(async (next: boolean): Promise<void> => {
    setPrefError(null);
    try {
      await setEmailPref(next);
    } catch {
      setPrefError(hubCopy("announcements.email_error"));
    }
  }, [setEmailPref]);

  const expanded = announcements.data.find((item) => item.id === expandedId) ?? null;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset + space[7] }]}
      showsVerticalScrollIndicator={false}
      testID="help-announcements"
    >
      {announcements.isLoading ? (
        <View style={styles.state}><ActivityIndicator color={color.text2} /></View>
      ) : announcements.isError ? (
        <GlassCard variant="elevated" radius="md" padding={space[6]}>
          <Text style={styles.cardBody}>{hubCopy("announcements.load_error")}</Text>
          <Button label={hubCopy("announcements.try_again")} variant="secondary" onPress={() => void announcements.refetch()} />
        </GlassCard>
      ) : announcements.data.length === 0 ? (
        <GlassCard variant="elevated" radius="md" padding={space[6]}>
          <Text style={styles.emptyTitle}>{hubCopy("announcements.empty_title")}</Text>
          <Text style={styles.cardBodyTight}>{hubCopy("announcements.empty_body")}</Text>
        </GlassCard>
      ) : expanded ? (
        <GlassCard variant="elevated" radius="md" padding={space[4]}>
          <Button label={hubCopy("announcements.back")} variant="secondary" onPress={() => setExpandedId(null)} />
          <Text style={styles.detailTitle}>{communityMarkdownToPlainText(expanded.title)}</Text>
          {expanded.published_at ? <Text style={styles.meta}>{new Date(expanded.published_at).toLocaleDateString()}</Text> : null}
          <CommunityMarkdown body={expanded.body_md} />
          {expanded.action_line ? (
            <View style={styles.actionBox}>
              <Text style={styles.actionHeading}>{hubCopy("announcements.action_heading")}</Text>
              <Text style={styles.cardBodyTight}>{expanded.action_line}</Text>
            </View>
          ) : null}
        </GlassCard>
      ) : (
        <View style={styles.list}>
          {announcements.data.map((item) => <AnnouncementCard key={item.id} item={item} onOpen={(id) => {
            const target = announcements.data.find((candidate) => candidate.id === id);
            if (target) void open(target);
          }} />)}
        </View>
      )}
      {readError ? <Text style={styles.inlineError} accessibilityLiveRegion="polite">{readError}</Text> : null}

      <GlassCard variant="elevated" radius="md" padding={space[6]}>
        <View style={styles.prefRow}>
          <View style={styles.prefCopy}>
            <Text style={styles.cardTitle}>{hubCopy("announcements.email_title")}</Text>
            <Text style={styles.cardBodyTight}>{hubCopy("announcements.email_body")}</Text>
          </View>
          <BrandSwitch
            value={emailOn}
            onValueChange={(value) => void handleEmailToggle(value)}
            disabled={prefLoading || prefSaving}
            accessibilityLabel={hubCopy("announcements.email_label")}
          />
        </View>
        {prefError ? <Text style={styles.inlineError} accessibilityLiveRegion="polite">{prefError}</Text> : null}
      </GlassCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: space[4], paddingTop: space[2], gap: space[4] },
  state: { paddingVertical: space[6], alignItems: "center" },
  list: { gap: space[4] },
  pressed: { opacity: 0.7 },
  unreadCard: { borderColor: color.paper, borderWidth: 2 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space[2] },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "600", color: color.text1 },
  detailTitle: { fontSize: 22, fontWeight: "800", color: color.text1, marginTop: space[4] },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.paper },
  meta: { fontSize: 12, color: color.text3, marginTop: space[1] },
  bodyPreview: { marginTop: space[2], fontSize: 13, lineHeight: 19, color: color.text2 },
  cardBody: { fontSize: 13, lineHeight: 19, color: color.text2, marginBottom: space[4] },
  cardBodyTight: { fontSize: 13, lineHeight: 19, color: color.text2, marginTop: space[1] },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: color.text1, marginBottom: space[1] },
  actionBox: { marginTop: space[6], borderLeftWidth: 3, borderLeftColor: color.paper, paddingLeft: space[4] },
  actionHeading: { color: color.text1, fontSize: 14, fontWeight: "800" },
  prefRow: { flexDirection: "row", alignItems: "center", gap: space[4] },
  prefCopy: { flex: 1 },
  inlineError: { fontSize: 12, lineHeight: 17, color: color.text2, marginTop: space[2] },
});
