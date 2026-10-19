/** #3720 compact, chapter-grouped Host guide library. */

import {
  HELP_CHAPTERS,
  HELP_VIDEOS,
  bambooPosterUrl,
  type HelpVideoRecord,
} from "@mingla/help-content";
import React, { useMemo, useState } from "react";
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { HELP_CENTRE_URL } from "../../constants/supportHostFacing";
import { useAuth } from "../../context/AuthContext";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { Icon } from "../ui/Icon";
import { GuidePlayerModal } from "./GuidePlayerModal";

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

function GuideRow({ guide, onPress }: { guide: HelpVideoRecord; onPress: () => void }) {
  const poster = guide.bambooEntryId ? bambooPosterUrl(guide.bambooEntryId, 360) : null;
  const chapter = HELP_CHAPTERS.find((item) => item.id === guide.chapter)?.label ?? "Guide";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Play ${guide.title}, ${guide.duration}`} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.thumbnail}>
        {poster ? <Image source={{ uri: poster }} style={styles.poster} accessibilityIgnoresInvertColors /> : null}
        <View style={styles.duration}><Text style={styles.durationText}>{guide.duration}</Text></View>
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={2}>{guide.title}</Text>
        <Text style={styles.chapter}>{chapter}</Text>
      </View>
      <Icon name="play" size={16} color={accent.warm} />
    </Pressable>
  );
}

export type GuidesTabPanelProps = { onToast: (message: string) => void };

export const GuidesTabPanel: React.FC<GuidesTabPanelProps> = ({ onToast }) => {
  const { user } = useAuth();
  const { isWideDesktop } = useResponsiveLayout();
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HelpVideoRecord | null>(null);
  const normalized = query.trim().toLowerCase();

  const filtered = useMemo(() => HELP_VIDEOS.filter((guide) =>
    !normalized || [guide.title, guide.blurb, ...guide.intents].join(" ").toLowerCase().includes(normalized)
  ), [normalized]);

  function selectGuide(guide: HelpVideoRecord): void {
    if (!guide.bambooEntryId) {
      onToast("That guide is still being prepared.");
      return;
    }
    setSelected(guide);
  }

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.heading}>Featured</Text>
          <Text style={styles.subheading}>Short, practical walkthroughs for Mingla Host</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="View all Host guides" onPress={() => setShowAll((current) => !current)} style={styles.viewMore}>
          <Text style={styles.viewMoreText}>{showAll ? "Show featured" : "View more"}</Text><Icon name={showAll ? "chevU" : "chevD"} size={16} color={accent.warm} />
        </Pressable>
      </View>

      <View style={[styles.grid, isWideDesktop && styles.desktopGrid]}>
        {FEATURED_HOST_GUIDES.map((guide) => <View key={guide.slug} style={isWideDesktop ? styles.desktopCell : styles.mobileCell}><GuideRow guide={guide} onPress={() => selectGuide(guide)} /></View>)}
      </View>

      {showAll ? (
        <View style={styles.library}>
          <View style={styles.searchWrap}>
            <Icon name="search" size={18} color={textTokens.tertiary} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search the full Mingla Host video library" placeholderTextColor={textTokens.tertiary} accessibilityLabel="Search Host guides" style={styles.searchInput} />
          </View>
          {HELP_CHAPTERS.map((chapter) => {
            const guides = filtered.filter((guide) => guide.chapter === chapter.id);
            if (guides.length === 0) return null;
            return (
              <View key={chapter.id} style={styles.chapterGroup}>
                <Text style={styles.chapterHeading}>{chapter.label}</Text>
                <View style={[styles.grid, isWideDesktop && styles.desktopGrid]}>
                  {guides.map((guide) => <View key={guide.slug} style={isWideDesktop ? styles.desktopCell : styles.mobileCell}><GuideRow guide={guide} onPress={() => selectGuide(guide)} /></View>)}
                </View>
              </View>
            );
          })}
          {filtered.length === 0 ? <Text style={styles.empty}>No guides match “{query}”.</Text> : null}
        </View>
      ) : null}

      <Pressable accessibilityRole="link" accessibilityLabel="Open Help Centre videos in your browser" onPress={() => { void Linking.openURL(HELP_CENTRE_URL).catch(() => onToast("Couldn’t open the Help Centre.")); }} style={({ pressed }) => [styles.helpCentreLink, pressed && styles.pressed]}>
        <Text style={styles.helpCentreLinkText}>Help Centre videos</Text>
      </Pressable>
      <GuidePlayerModal guide={selected} userId={user?.id ?? "signed-in-host"} onClose={() => setSelected(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  heading: { color: textTokens.primary, fontSize: 20, fontWeight: "800" },
  subheading: { color: textTokens.tertiary, fontSize: 12, marginTop: 3 },
  viewMore: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: spacing.sm },
  viewMoreText: { color: accent.warm, fontSize: 13, fontWeight: "800" },
  grid: { gap: spacing.sm },
  desktopGrid: { flexDirection: "row", flexWrap: "wrap" },
  desktopCell: { width: "48%", flexGrow: 1, flexBasis: 300 },
  mobileCell: { width: "100%" },
  row: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated },
  thumbnail: { width: 88, height: 56, overflow: "hidden", borderRadius: radius.md, backgroundColor: "#111318" },
  poster: { width: 88, height: 56 },
  duration: { position: "absolute", right: 3, bottom: 3, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2, backgroundColor: "rgba(0,0,0,0.82)" },
  durationText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: textTokens.primary, fontSize: 14, fontWeight: "700" },
  chapter: { color: textTokens.tertiary, fontSize: 11, marginTop: 4 },
  pressed: { opacity: 0.72 },
  library: { gap: spacing.lg },
  searchWrap: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated },
  searchInput: { flex: 1, minHeight: 46, color: textTokens.primary, fontSize: 15, letterSpacing: 0 },
  chapterGroup: { gap: spacing.sm },
  chapterHeading: { color: accent.warm, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  empty: { padding: spacing.xl, color: textTokens.secondary, textAlign: "center" },
  helpCentreLink: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: spacing.sm },
  helpCentreLinkText: { color: accent.warm, fontSize: 13, fontWeight: "800", textDecorationLine: "underline" },
});
