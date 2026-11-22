/**
 * #4420 — Help & Support's Support column (phone: its tab), spec part 2 4.2
 * as amended by the scope cut (Seth, 2026-11-21).
 *
 *   - A switch "Ari | A person". The Ari segment's mark is the Ari orb
 *     (HomeAriOrb, still, with NO tint, so it keeps Ari's orange like the Ari
 *     tab and Home; `Icon name="ari"` always tints, which is for navigation
 *     only): never a new drawing.
 *   - Ari: the ORDINARY Ari chat (same conversations as the Ari tab, no
 *     help-specific prompt, tool or flag), with "Talk to a person" always
 *     visible and one plain "Browse all help videos" link to the Help Centre.
 *   - A person: the host's support conversation (SupportPersonPane).
 *
 * Shell file: it loads with the route, so it imports no text input, no
 * support service or model and no part of Ari's chat. Both sides come in
 * through the sibling lazy boundaries in LazySupportScreens.tsx, and the
 * hand-over through the support chunk (loadSupportScreens).
 */

import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { color, radius, space } from "../../constants/designSystem";
import { HELP_CENTRE_URL } from "../../constants/supportHostFacing";
import { useAuth } from "../../context/AuthContext";
import { supportTicketKeys } from "../../hooks/supportTicketKeys";
import { useCurrentBrandStore } from "../../store/currentBrandStore";
import { HomeAriOrb } from "../home/HomeAriOrb";
import { Icon } from "../ui/Icon";
import { openHelpCentre } from "./helpCentreLauncher";
import { hubCopy } from "./helpSupportHubCopy";
import { handleSegmentKeyDown, rovingTabIndex, type SegmentKeyEvent, type SupportMode } from "./helpSupportRoute";
import type { HandoverProgress, HandoverSourceMessage } from "./supportHandover";
import { LazySupportAriChat, LazySupportPersonPane, loadSupportScreens } from "./LazySupportScreens";

const SUPPORT_MODES: readonly SupportMode[] = ["ari", "person"];

interface AriSnapshot {
  conversationId: string | null;
  messages: readonly HandoverSourceMessage[];
}

type HandoverState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "error"; message: string };

export interface SupportColumnProps {
  mode: SupportMode;
  onModeChange: (mode: SupportMode) => void;
  /** Desktop shows the column title; on a phone the tab already names it. */
  showTitle: boolean;
  startNew: boolean;
  onToast: (message: string) => void;
  bottomInset: number;
}

export const SupportColumn: React.FC<SupportColumnProps> = ({
  mode,
  onModeChange,
  showTitle,
  startNew,
  onToast,
  bottomInset,
}) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const currentBrandId = useCurrentBrandStore((state) => state.currentBrandId);
  // Each side mounts on first use and then stays mounted, so switching back
  // keeps the conversation and anything typed.
  const [visited, setVisited] = useState<Record<SupportMode, boolean>>({
    ari: mode === "ari",
    person: mode === "person",
  });
  const [focusTicketId, setFocusTicketId] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [handover, setHandover] = useState<HandoverState>({ status: "idle" });
  const [helpCentreError, setHelpCentreError] = useState(false);
  const snapshotRef = useRef<AriSnapshot | null>(null);
  const progressRef = useRef<{ key: string; progress: HandoverProgress } | null>(null);

  const optionRefs = useRef<Partial<Record<SupportMode, { focus?: () => void } | null>>>({});
  const focusOption = useCallback((option: SupportMode): void => {
    optionRefs.current[option]?.focus?.();
  }, []);

  const select = useCallback((next: SupportMode): void => {
    setVisited((current) => (current[next] ? current : { ...current, [next]: true }));
    onModeChange(next);
  }, [onModeChange]);

  const handleConversationChange = useCallback((snapshot: AriSnapshot): void => {
    snapshotRef.current = snapshot;
  }, []);

  const handleTalkToPerson = useCallback(async (): Promise<void> => {
    if (handover.status === "running") return;
    setHandover({ status: "running" });
    let screens: Awaited<ReturnType<typeof loadSupportScreens>>;
    try {
      screens = await loadSupportScreens();
    } catch {
      setHandover({ status: "error", message: hubCopy("support.handover_unavailable") });
      return;
    }
    const payload = screens.handOverPayloadFromMessages(snapshotRef.current?.messages ?? []);
    const userId = user?.id ?? null;
    if (payload === null || userId === null || (payload.text === null && payload.ariImageIds.length === 0)) {
      // Nothing asked yet (or only files that stay with Ari): just switch.
      setNotices(payload ? screens.handoverNotices({ photoFailures: [], skippedFiles: payload.skippedFiles }) : []);
      setHandover({ status: "idle" });
      select("person");
      return;
    }
    const key = JSON.stringify([snapshotRef.current?.conversationId ?? null, payload]);
    const previous = progressRef.current?.key === key ? progressRef.current.progress : null;
    try {
      const outcome = await screens.handOverToSupport({ userId, brandId: currentBrandId, payload, previous });
      progressRef.current = { key, progress: outcome.progress };
      void queryClient.invalidateQueries({ queryKey: supportTicketKeys.byUser(userId) });
      void queryClient.invalidateQueries({ queryKey: supportTicketKeys.thread(outcome.ticketId) });
      setNotices(screens.handoverNotices(outcome));
      setFocusTicketId(outcome.ticketId);
      setHandover({ status: "idle" });
      select("person");
    } catch (error) {
      if (error instanceof screens.HandoverError) progressRef.current = { key, progress: error.progress };
      setHandover({ status: "error", message: screens.handoverFailureMessage(error) });
    }
  }, [currentBrandId, handover.status, queryClient, select, user?.id]);

  const handleBrowseVideos = useCallback(async (): Promise<void> => {
    setHelpCentreError(false);
    try {
      await openHelpCentre(HELP_CENTRE_URL);
    } catch {
      setHelpCentreError(true);
    }
  }, []);

  return (
    <View style={styles.column} testID="help-support-column">
      <View style={styles.header}>
        {showTitle ? <Text style={styles.title} accessibilityRole="header">{hubCopy("tabs.support")}</Text> : null}
        <View style={styles.switch} accessibilityRole="radiogroup" accessibilityLabel={hubCopy("support.switch_label")}>
          {(["ari", "person"] as const).map((option) => {
            const selected = option === mode;
            return (
              <Pressable
                key={option}
                onPress={() => select(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected, checked: selected }}
                // A radio's state is "checked"; react-native-web reads aria-checked (#4420 rework 2).
                aria-checked={selected}
                // #4420 rework 3 (G6): Space selects, arrows move (web keyboard).
                // #4420 rework 5 (H2): roving tabindex, focus follows the arrows.
                ref={(node: unknown) => {
                  optionRefs.current[option] = node as { focus?: () => void } | null;
                }}
                {...({
                  onKeyDown: (event: SegmentKeyEvent) =>
                    handleSegmentKeyDown(event, SUPPORT_MODES, option, select, focusOption),
                  tabIndex: rovingTabIndex(selected),
                } as object)}
                accessibilityLabel={hubCopy(`support.${option}`)}
                testID={`support-mode-${option}`}
                style={({ pressed }) => [styles.segment, selected && styles.segmentOn, pressed && !selected && styles.pressed]}
              >
                {option === "ari" ? <HomeAriOrb size={18} still testID="support-mode-ari-orb" /> : null}
                <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{hubCopy(`support.${option}`)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {visited.ari ? (
        <View style={[styles.side, mode !== "ari" && styles.hidden]} testID="support-ari-side">
          <View style={styles.ariBar}>
            <Pressable
              onPress={() => void handleTalkToPerson()}
              disabled={handover.status === "running"}
              accessibilityRole="button"
              accessibilityLabel={hubCopy("support.talk_to_person")}
              accessibilityHint={hubCopy("support.talk_to_person_hint")}
              accessibilityState={{ busy: handover.status === "running" }}
              testID="support-talk-to-person"
              style={({ pressed }) => [styles.talkButton, pressed && styles.pressed]}
            >
              {handover.status === "running" ? (
                <ActivityIndicator size="small" color={color.ink} />
              ) : (
                <Icon name="chat" size={16} color={color.ink} />
              )}
              <Text style={styles.talkText}>
                {handover.status === "running" ? hubCopy("support.handing_over") : hubCopy("support.talk_to_person")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void handleBrowseVideos()}
              accessibilityRole="link"
              accessibilityLabel={hubCopy("support.browse_videos")}
              testID="support-browse-videos"
              hitSlop={8}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Text style={styles.linkText}>{hubCopy("support.browse_videos")}</Text>
            </Pressable>
          </View>
          {handover.status === "error" ? (
            <View style={styles.errorRow} accessibilityRole="alert">
              <Text style={styles.errorText}>{handover.message}</Text>
              <Pressable
                onPress={() => void handleTalkToPerson()}
                accessibilityRole="button"
                accessibilityLabel={hubCopy("support.retry")}
                style={styles.errorAction}
              >
                <Text style={styles.errorActionText}>{hubCopy("support.retry")}</Text>
              </Pressable>
              <Pressable
                onPress={() => setHandover({ status: "idle" })}
                accessibilityRole="button"
                accessibilityLabel={hubCopy("support.dismiss")}
                style={styles.errorAction}
              >
                <Text style={styles.errorActionText}>{hubCopy("support.dismiss")}</Text>
              </Pressable>
            </View>
          ) : null}
          {helpCentreError ? (
            <Text style={styles.errorText} accessibilityRole="alert">{hubCopy("support.browse_failed")}</Text>
          ) : null}
          <View style={styles.sideBody}>
            <LazySupportAriChat embedded withoutTabBar onConversationChange={handleConversationChange} />
          </View>
        </View>
      ) : null}

      {visited.person ? (
        <View style={[styles.side, mode !== "person" && styles.hidden]} testID="support-person-side">
          <LazySupportPersonPane
            startNew={startNew}
            focusTicketId={focusTicketId}
            notices={notices}
            onDismissNotices={() => setNotices([])}
            onToast={onToast}
            bottomInset={bottomInset}
          />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  column: { flex: 1, minHeight: 0, minWidth: 0 },
  header: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[2], gap: space[2] },
  title: { fontSize: 17, fontWeight: "700", color: color.text1 },
  switch: {
    flexDirection: "row",
    gap: space[1],
    padding: 4,
    borderRadius: 12,
    backgroundColor: color.fill.inset,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: space[2],
  },
  segmentOn: { backgroundColor: color.fill.tabOn, borderWidth: 1, borderColor: color.lineStrong },
  segmentText: { fontSize: 13, fontWeight: "600", color: color.text3 },
  segmentTextOn: { color: color.text1 },
  pressed: { opacity: 0.7 },
  side: { flex: 1, minHeight: 0 },
  hidden: { display: "none" },
  sideBody: { flex: 1, minHeight: 0 },
  ariBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingBottom: space[2],
  },
  talkButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    backgroundColor: color.paper,
  },
  talkText: { fontSize: 13, fontWeight: "700", color: color.ink },
  link: { minHeight: 40, justifyContent: "center" },
  linkText: { fontSize: 13, fontWeight: "600", color: color.text1, textDecorationLine: "underline" },
  errorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[2],
    marginHorizontal: space[4],
    marginBottom: space[2],
    padding: space[2],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.inset,
  },
  errorText: { flexGrow: 1, flexShrink: 1, fontSize: 13, lineHeight: 19, color: color.text1, paddingHorizontal: space[4] },
  errorAction: { minHeight: 32, justifyContent: "center", paddingHorizontal: space[2] },
  errorActionText: { fontSize: 13, fontWeight: "700", color: color.text1, textDecorationLine: "underline" },
});
