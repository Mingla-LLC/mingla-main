/** #3720 Wave 3 — searchable, in-app Host guide library and player. */

import { HELP_CHAPTERS, HELP_VIDEOS, bambooPosterUrl, type HelpVideoRecord } from "@mingla/help-content";
import React, { useMemo, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { accent, canvas, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { ScrollView } from "../../wrappers/SmartScrollView";
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
  HELP_VIDEOS.find((guide) => guide.slug === slug),
).filter((guide): guide is HelpVideoRecord => !!guide);

function GuideCard({ guide, wide, onPress }: { guide: HelpVideoRecord; wide: boolean; onPress: () => void }): React.ReactElement {
  const poster = guide.bambooEntryId ? bambooPosterUrl(guide.bambooEntryId, 720) : null;
  const chapter = HELP_CHAPTERS.find((item) => item.id === guide.chapter)?.label ?? "Guide";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Play ${guide.title}, ${guide.duration}`} onPress={onPress} style={({ pressed }) => [styles.card, wide && styles.cardWide, pressed && styles.pressed]}>
      <View style={styles.posterShell}>
        {poster ? <Image source={{ uri: poster }} style={styles.poster} accessibilityIgnoresInvertColors /> : null}
        <View style={styles.playBadge}><Icon name="play" size={18} color="#111318" /></View>
        <View style={styles.duration}><Text style={styles.durationText}>{guide.duration}</Text></View>
      </View>
      <View style={styles.cardCopy}>
        <Text style={styles.eyebrow}>{chapter}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{guide.title}</Text>
        <Text style={styles.cardBlurb} numberOfLines={3}>{guide.blurb}</Text>
      </View>
    </Pressable>
  );
}

function GuideLibrary({ visible, onClose, onSelect }: { visible: boolean; onClose: () => void; onSelect: (guide: HelpVideoRecord) => void }): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const guides = useMemo(() => HELP_VIDEOS.filter((guide) => !normalized || [guide.title, guide.blurb, ...guide.intents].join(" ").toLowerCase().includes(normalized)), [normalized]);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.library, { paddingTop: Math.max(insets.top, spacing.md) }]}>
        <View style={styles.libraryHeader}>
          <View style={styles.headerCopy}><Text style={styles.libraryTitle}>Host Guides</Text><Text style={styles.librarySubtitle}>Search the full Mingla Host video library</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close guide library" onPress={onClose} style={styles.closeButton}><Icon name="close" size={20} color={textTokens.primary} /></Pressable>
        </View>
        <View style={styles.searchWrap}>
          <Icon name="search" size={18} color={textTokens.tertiary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search guides" placeholderTextColor={textTokens.tertiary} accessibilityLabel="Search Host guides" style={styles.searchInput} />
        </View>
        <ScrollView contentContainerStyle={[styles.libraryGrid, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]} keyboardShouldPersistTaps="handled">
          {guides.length ? guides.map((guide) => <GuideCard key={guide.slug} guide={guide} wide={width >= 760} onPress={() => onSelect(guide)} />) : <Text style={styles.empty}>No guides match “{query}”.</Text>}
        </ScrollView>
      </View>
    </Modal>
  );
}

export type GuidesTabPanelProps = { onToast: (message: string) => void };

export const GuidesTabPanel: React.FC<GuidesTabPanelProps> = ({ onToast }) => {
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [selected, setSelected] = useState<HelpVideoRecord | null>(null);

  function selectGuide(guide: HelpVideoRecord): void {
    if (!guide.bambooEntryId) {
      onToast("That guide is still being prepared.");
      return;
    }
    setLibraryOpen(false);
    setSelected(guide);
  }

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.heading}>Featured guides</Text>
          <Text style={styles.subheading}>Short, practical walkthroughs for Mingla Host</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="View all Host guides" onPress={() => setLibraryOpen(true)} style={styles.viewMore}>
          <Text style={styles.viewMoreText}>View more</Text><Icon name="chevR" size={16} color={accent.warm} />
        </Pressable>
      </View>
      <View style={styles.featuredGrid}>
        {FEATURED_HOST_GUIDES.map((guide) => <GuideCard key={guide.slug} guide={guide} wide={width >= 760} onPress={() => selectGuide(guide)} />)}
      </View>
      <GuideLibrary visible={libraryOpen} onClose={() => setLibraryOpen(false)} onSelect={selectGuide} />
      <GuidePlayerModal guide={selected} userId={user?.id ?? "signed-in-host"} onClose={() => setSelected(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  heading: { color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  subheading: { color: textTokens.tertiary, fontSize: 12, marginTop: 3 },
  viewMore: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: spacing.sm },
  viewMoreText: { color: accent.warm, fontSize: 13, fontWeight: "800" },
  featuredGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: { width: "100%", overflow: "hidden", borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated },
  cardWide: { width: "48%", flexGrow: 1, flexBasis: 320 },
  pressed: { opacity: 0.72 },
  posterShell: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#111318" },
  poster: { width: "100%", height: "100%" },
  playBadge: { position: "absolute", left: spacing.md, bottom: spacing.md, width: 42, height: 42, borderRadius: 21, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  duration: { position: "absolute", right: spacing.sm, bottom: spacing.sm, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: "rgba(0,0,0,0.82)" },
  durationText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  cardCopy: { padding: spacing.md, gap: 5 },
  eyebrow: { color: accent.warm, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  cardTitle: { color: textTokens.primary, fontSize: 16, fontWeight: "800" },
  cardBlurb: { color: textTokens.secondary, fontSize: 13, lineHeight: 19 },
  library: { flex: 1, backgroundColor: canvas.profile },
  libraryHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  libraryTitle: { color: textTokens.primary, fontSize: 22, fontWeight: "800" },
  librarySubtitle: { color: textTokens.tertiary, fontSize: 12, marginTop: 2 },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: glass.border.profileElevated },
  searchWrap: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated },
  searchInput: { flex: 1, minHeight: 46, color: textTokens.primary, fontSize: 15 },
  libraryGrid: { width: "100%", maxWidth: 1080, alignSelf: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.md, padding: spacing.md },
  empty: { width: "100%", padding: spacing.xl, color: textTokens.secondary, textAlign: "center" },
});
