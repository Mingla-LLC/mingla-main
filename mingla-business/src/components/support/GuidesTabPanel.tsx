/** #4173 — compact five-foundation Host guide workspace. */

import {
  HELP_CHAPTERS,
  HELP_VIDEOS,
  bambooPosterUrl,
  type HelpVideoRecord,
} from "@mingla/help-content";
import React, { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { accent, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { HELP_CENTRE_URL } from "../../constants/supportHostFacing";
import { useAuth } from "../../context/AuthContext";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { Icon } from "../ui/Icon";
import { GuidePlayerModal } from "./GuidePlayerModal";
import { openHelpCentre } from "./helpCentreLauncher";

const FEATURED_GUIDE_SLUGS = [
  "getting-the-apps",
  "sign-up-and-create-a-brand",
  "connect-a-bank-and-get-paid",
  "build-your-guest-list-and-groups",
  "send-a-campaign-to-a-group",
] as const;

export const FEATURED_HOST_GUIDES = FEATURED_GUIDE_SLUGS.map((slug) =>
  HELP_VIDEOS.find((guide) => guide.slug === slug)
).filter((guide): guide is HelpVideoRecord => !!guide);

const START_GUIDE = FEATURED_HOST_GUIDES.find(
  (guide) => guide.slug === "sign-up-and-create-a-brand",
) ?? FEATURED_HOST_GUIDES[0];
const ESSENTIAL_GUIDES = FEATURED_HOST_GUIDES.filter(
  (guide) => guide.slug !== START_GUIDE?.slug,
);

function guideChapter(guide: HelpVideoRecord): string {
  return HELP_CHAPTERS.find((item) => item.id === guide.chapter)?.label ?? "Guide";
}

function GuideCard({ guide, onPress }: { guide: HelpVideoRecord; onPress: () => void }) {
  const poster = guide.bambooEntryId ? bambooPosterUrl(guide.bambooEntryId, 360) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${guide.title}, ${guide.duration}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardPoster}>
        {poster ? <Image source={{ uri: poster }} style={styles.cardPosterImage} accessibilityIgnoresInvertColors /> : null}
        <View style={styles.cardPlay}><Icon name="play" size={14} color={accent.warm} /></View>
        <View style={styles.duration}><Text style={styles.durationText}>{guide.duration}</Text></View>
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>{guide.title}</Text>
      <Text style={styles.cardMeta} numberOfLines={1}>{guideChapter(guide)}</Text>
    </Pressable>
  );
}

export type GuidesTabPanelProps = { onToast: (message: string) => void };

export const GuidesTabPanel: React.FC<GuidesTabPanelProps> = ({ onToast }) => {
  const { user } = useAuth();
  const { isWideDesktop } = useResponsiveLayout();
  const [selected, setSelected] = useState<HelpVideoRecord | null>(null);

  function selectGuide(guide: HelpVideoRecord): void {
    if (!guide.bambooEntryId) {
      onToast("That guide is still being prepared.");
      return;
    }
    setSelected(guide);
  }

  async function viewMoreVideos(): Promise<void> {
    try {
      await openHelpCentre(HELP_CENTRE_URL);
    } catch {
      onToast("Couldn’t open the Help Centre.");
    }
  }

  if (!START_GUIDE) return <View />;

  const startPoster = START_GUIDE.bambooEntryId
    ? bambooPosterUrl(START_GUIDE.bambooEntryId, 720)
    : null;

  return (
    <View style={[styles.root, isWideDesktop && styles.rootDesktop]} testID="five-foundation-guides">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${START_GUIDE.title}, ${START_GUIDE.duration}`}
        onPress={() => selectGuide(START_GUIDE)}
        style={({ pressed }) => [styles.hero, isWideDesktop && styles.heroDesktop, pressed && styles.pressed]}
      >
        <View style={[styles.heroCopy, isWideDesktop && styles.heroCopyDesktop]}>
          <Text style={styles.eyebrow}>Start here · {START_GUIDE.duration}</Text>
          <Text style={[styles.heroTitle, isWideDesktop && styles.heroTitleDesktop]} numberOfLines={2}>{START_GUIDE.title}</Text>
          <Text style={styles.heroBody} numberOfLines={isWideDesktop ? 3 : 2}>{START_GUIDE.blurb}</Text>
          <View style={styles.heroAction}><Icon name="play" size={14} color="#17100c" /><Text style={styles.heroActionText}>Play guide</Text></View>
        </View>
        <View style={[styles.heroArt, isWideDesktop && styles.heroArtDesktop]}>
          {startPoster ? <Image source={{ uri: startPoster }} style={styles.heroPoster} accessibilityIgnoresInvertColors /> : null}
          <View style={styles.heroShade} />
          <View style={styles.heroPlay}><Icon name="play" size={20} color="#17100c" /></View>
        </View>
      </Pressable>

      <View style={styles.sectionHeading}>
        <Text style={styles.heading}>Essential guides</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="View more videos in the Help Centre"
          onPress={() => void viewMoreVideos()}
          style={({ pressed }) => [styles.viewMore, pressed && styles.pressed]}
        >
          <Text style={styles.viewMoreText}>View more videos</Text>
          <Icon name="externalLink" size={14} color={accent.warm} />
        </Pressable>
      </View>

      <View style={[styles.grid, isWideDesktop && styles.gridDesktop]}>
        {ESSENTIAL_GUIDES.map((guide) => (
          <View key={guide.slug} style={isWideDesktop ? styles.desktopCell : styles.mobileCell}>
            <GuideCard guide={guide} onPress={() => selectGuide(guide)} />
          </View>
        ))}
      </View>

      <GuidePlayerModal guide={selected} userId={user?.id ?? "signed-in-host"} onClose={() => setSelected(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, gap: spacing.sm },
  rootDesktop: { width: "100%", maxWidth: 1120, alignSelf: "center", gap: spacing.md },
  hero: { minHeight: 144, flexDirection: "row", overflow: "hidden", borderRadius: 22, borderWidth: 1, borderColor: "rgba(235,120,37,0.32)", backgroundColor: "rgba(235,120,37,0.10)" },
  heroDesktop: { minHeight: 162 },
  heroCopy: { flex: 1, minWidth: 0, justifyContent: "center", padding: spacing.md },
  heroCopyDesktop: { padding: spacing.xl },
  eyebrow: { color: "#f3a36a", fontSize: 10, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  heroTitle: { marginTop: 5, color: textTokens.primary, fontSize: 20, lineHeight: 22, fontWeight: "900", letterSpacing: -0.5 },
  heroTitleDesktop: { fontSize: 25, lineHeight: 27 },
  heroBody: { marginTop: 5, color: textTokens.secondary, fontSize: 11, lineHeight: 15 },
  heroAction: { minHeight: 34, alignSelf: "flex-start", marginTop: spacing.sm, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, borderRadius: 18, backgroundColor: accent.warm },
  heroActionText: { color: "#17100c", fontSize: 11, fontWeight: "900" },
  heroArt: { width: 106, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#1d1a1a" },
  heroArtDesktop: { width: "34%" },
  heroPoster: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(20,13,10,0.35)" },
  heroPlay: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
  sectionHeading: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  heading: { flex: 1, color: textTokens.primary, fontSize: 16, fontWeight: "800" },
  viewMore: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: "rgba(235,120,37,0.38)", backgroundColor: "rgba(235,120,37,0.09)" },
  viewMoreText: { color: accent.warm, fontSize: 11, fontWeight: "800" },
  grid: { flex: 1, minHeight: 0, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  gridDesktop: { flexWrap: "nowrap" },
  mobileCell: { width: "48%", height: "48%", flexGrow: 1, flexBasis: 140 },
  desktopCell: { flex: 1, height: "100%", minWidth: 0 },
  card: { flex: 1, minHeight: 0, overflow: "hidden", padding: 8, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated },
  cardPoster: { flex: 1, minHeight: 48, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: "rgba(235,120,37,0.12)" },
  cardPosterImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  cardPlay: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "rgba(10,10,12,0.76)" },
  duration: { position: "absolute", right: 4, bottom: 4, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.82)" },
  durationText: { color: "#ffffff", fontSize: 8, fontWeight: "800" },
  cardTitle: { marginTop: 7, color: textTokens.primary, fontSize: 11, lineHeight: 14, fontWeight: "800" },
  cardMeta: { marginTop: 2, color: textTokens.tertiary, fontSize: 9 },
  pressed: { opacity: 0.72 },
});
