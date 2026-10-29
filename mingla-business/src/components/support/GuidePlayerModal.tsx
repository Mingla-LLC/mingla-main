import AsyncStorage from "@react-native-async-storage/async-storage";
import { bambooHlsUrl, type HelpVideoRecord } from "@mingla/help-content";
import { VideoView, useVideoPlayer } from "expo-video";
import {
  isVideoPlayerReleasedForReload,
  registerVideoPlayerForReload,
} from "@mingla/offering-rendering/videoPlayerReloadRelease";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { accent, canvas, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { useBusinessMediaTranslation } from "../../i18n";
import { Icon } from "../ui/Icon";
import { MediaViewerShell } from "../media/MediaViewerShell";
import { parseGuideCaptions, type GuideCaptionCue } from "./guideCaptions";

const CAPTION_ORIGIN = "https://usemingla.com";

function progressKey(userId: string, slug: string): string {
  return `issue3720:guide-progress:${userId}:${slug}`;
}

function GuidePlayer({ guide, userId, onClose }: { guide: HelpVideoRecord; userId: string; onClose: () => void }): React.ReactElement {
  const { t } = useBusinessMediaTranslation();
  const insets = useSafeAreaInsets();
  const [cues, setCues] = useState<GuideCaptionCue[]>([]);
  const [captionOn, setCaptionOn] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [time, setTime] = useState(0);
  const [loadingTranscript, setLoadingTranscript] = useState(true);
  const lastSavedSecond = useRef(-1);
  const hls = guide.bambooEntryId ? bambooHlsUrl(guide.bambooEntryId) : null;
  const player = useVideoPlayer(hls ? { uri: hls, contentType: "hls" } : null, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.5;
  });

  useEffect(() => {
    let active = true;
    setLoadingTranscript(true);
    void fetch(`${CAPTION_ORIGIN}/help/captions/${guide.slug}.vtt`)
      .then((response) => response.ok ? response.text() : "")
      .then((body) => { if (active) setCues(parseGuideCaptions(body)); })
      .catch(() => { if (active) setCues([]); })
      .finally(() => { if (active) setLoadingTranscript(false); });
    return () => { active = false; };
  }, [guide.slug]);

  // #2107: an in-app restart releases this player before reloadAsync. A
  // released player is never touched again (the VideoView keeps its still frame).
  useEffect(() => registerVideoPlayerForReload(player), [player]);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(progressKey(userId, guide.slug)).then((saved) => {
      const value = Number(saved);
      if (!active || isVideoPlayerReleasedForReload(player)) return;
      if (Number.isFinite(value) && value > 0) player.currentTime = value;
    });
    const timeSubscription = player.addListener("timeUpdate", ({ currentTime }) => {
      setTime(currentTime);
      const whole = Math.floor(currentTime);
      if (whole > 0 && whole - lastSavedSecond.current >= 5) {
        lastSavedSecond.current = whole;
        void AsyncStorage.setItem(progressKey(userId, guide.slug), String(whole));
      }
    });
    const endSubscription = player.addListener("playToEnd", () => {
      setTime(0);
      void AsyncStorage.removeItem(progressKey(userId, guide.slug));
    });
    return () => {
      active = false;
      timeSubscription.remove();
      endSubscription.remove();
      // #4173 — useVideoPlayer owns the native object's unmount/release. A
      // close can race Expo's release before this cleanup runs, so calling
      // pause here can target a released NativeSharedObject and crash the
      // screen. Unmounting VideoView stops playback without touching it again.
    };
  }, [guide.slug, player, userId]);

  const activeCaption = useMemo(() => cues.find((cue) => time >= cue.start && time < cue.end)?.text ?? null, [cues, time]);

  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("viewer.close_guide_a11y")} onPress={onClose} style={styles.iconButton}>
          <Icon name="close" size={20} color={textTokens.primary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>Guide {guide.episode} · {guide.duration}</Text>
          <Text style={styles.title} numberOfLines={2}>{guide.title}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
        <View style={styles.videoShell}>
          {hls ? <VideoView player={player} style={styles.video} nativeControls contentFit="contain" accessibilityLabel={`${guide.title} video`} /> : (
            <View style={styles.videoUnavailable}><Text style={styles.muted}>This guide is being prepared.</Text></View>
          )}
          {captionOn && activeCaption ? <View pointerEvents="none" style={styles.caption}><Text style={styles.captionText}>{activeCaption}</Text></View> : null}
        </View>

        <View style={styles.controlRow}>
          <Pressable accessibilityRole="switch" accessibilityLabel="Captions" accessibilityState={{ checked: captionOn }} onPress={() => setCaptionOn((current) => !current)} style={[styles.pill, captionOn && styles.pillActive]}>
            <Text style={[styles.pillText, captionOn && styles.pillTextActive]}>Captions {captionOn ? "on" : "off"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={showTranscript ? "Hide transcript" : "Show transcript"} accessibilityState={{ expanded: showTranscript }} onPress={() => setShowTranscript((current) => !current)} style={styles.pill}>
            <Text style={styles.pillText}>{showTranscript ? "Hide transcript" : "Show transcript"}</Text>
          </Pressable>
        </View>

        <Text style={styles.blurb}>{guide.blurb}</Text>
        {showTranscript ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Transcript</Text>
            {loadingTranscript ? <ActivityIndicator color={accent.warm} /> : cues.length ? cues.map((cue, index) => (
              <Pressable key={`${cue.start}-${index}`} accessibilityRole="button" accessibilityLabel={`Jump to ${Math.floor(cue.start / 60)} minutes ${Math.floor(cue.start % 60)} seconds`} onPress={() => {
                if (isVideoPlayerReleasedForReload(player)) return;
                player.currentTime = cue.start;
                player.play();
              }} style={styles.transcriptRow}>
                <Text style={styles.transcriptTime}>{Math.floor(cue.start / 60)}:{String(Math.floor(cue.start % 60)).padStart(2, "0")}</Text>
                <Text style={styles.transcriptText}>{cue.text}</Text>
              </Pressable>
            )) : <Text style={styles.muted}>The captions are embedded in this video.</Text>}
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Follow along</Text>
          {guide.steps.map((step, index) => (
            <View key={`${step.title}-${index}`} style={styles.step}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
              <View style={styles.stepCopy}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepBody}>{step.body}</Text>
                {step.links?.map((link) => (
                  <Pressable key={link.href} accessibilityRole="link" accessibilityLabel={link.label} onPress={() => void Linking.openURL(link.href)} style={styles.resourceLink}>
                    <Text style={styles.resourceText}>{link.label}</Text><Icon name="externalLink" size={14} color={accent.warm} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export function GuidePlayerModal({ guide, userId, onClose }: { guide: HelpVideoRecord | null; userId: string; onClose: () => void }): React.ReactElement {
  const { t } = useBusinessMediaTranslation();
  return (
    <MediaViewerShell visible={guide !== null} onClose={onClose} closeAccessibilityLabel={t("viewer.close_guide_a11y")} contentOnly testID="guide-player-modal">
      {guide ? <GuidePlayer key={guide.slug} guide={guide} userId={userId} onClose={onClose} /> : null}
    </MediaViewerShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: canvas.profile },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: glass.border.profileBase },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: glass.border.profileElevated },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: accent.warm, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 },
  title: { color: textTokens.primary, fontSize: 20, fontWeight: "800", marginTop: 2 },
  content: { width: "100%", maxWidth: 980, alignSelf: "center", padding: spacing.md, gap: spacing.lg },
  videoShell: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#050607", borderWidth: 1, borderColor: glass.border.profileElevated },
  video: { width: "100%", height: "100%" },
  videoUnavailable: { flex: 1, alignItems: "center", justifyContent: "center" },
  caption: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.xl, alignItems: "center" },
  captionText: { color: "#fff", backgroundColor: "rgba(0,0,0,0.82)", paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: 5, fontSize: 15, lineHeight: 21, textAlign: "center" },
  controlRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pill: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: 22, borderWidth: 1, borderColor: glass.border.profileElevated },
  pillActive: { borderColor: accent.warm, backgroundColor: "rgba(235,120,37,0.1)" },
  pillText: { color: textTokens.secondary, fontSize: 12, fontWeight: "700" },
  pillTextActive: { color: accent.warm },
  blurb: { color: textTokens.secondary, fontSize: 16, lineHeight: 24 },
  panel: { gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  sectionTitle: { color: textTokens.primary, fontSize: 17, fontWeight: "800" },
  transcriptRow: { minHeight: 44, flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: glass.border.profileBase },
  transcriptTime: { width: 42, color: accent.warm, fontSize: 12, fontWeight: "800" },
  transcriptText: { flex: 1, color: textTokens.secondary, fontSize: 14, lineHeight: 20 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: glass.border.profileBase },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(235,120,37,0.14)", alignItems: "center", justifyContent: "center" },
  stepNumberText: { color: accent.warm, fontWeight: "800" },
  stepCopy: { flex: 1, gap: 5 },
  stepTitle: { color: textTokens.primary, fontSize: 14, fontWeight: "800" },
  stepBody: { color: textTokens.secondary, fontSize: 14, lineHeight: 21 },
  resourceLink: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  resourceText: { color: accent.warm, fontSize: 13, fontWeight: "700" },
  muted: { color: textTokens.tertiary, fontSize: 13 },
});
