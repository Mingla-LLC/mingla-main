import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView } from "../../src/wrappers/SmartScrollView";
import { Button } from "../../src/components/ui/Button";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { CREATOR_FORMATS } from "../../src/services/creatorProgramContract";
import { creatorGigsService, type PublicGig } from "../../src/services/creatorGigsService";
import { accent, canvas, glass, radius, spacing, text as textTokens } from "../../src/constants/designSystem";
import { ProgramBackBar } from "../../src/components/programs/ProgramBackBar";

export default function CreatorHub(): React.ReactElement {
  const router = useRouter();
  const [gigs, setGigs] = useState<PublicGig[]>([]);
  const [format, setFormat] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [band, setBand] = useState<string | null>(null);
  const [soon, setSoon] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setGigs(await creatorGigsService.board()); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void AsyncStorage.getItem("mingla.creator.savedGigs").then((raw) => {
      if (!raw) return;
      try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) setSaved(parsed.filter((id): id is string => typeof id === "string")); } catch { /* a corrupt local preference must not block the board */ }
    });
  }, []);
  const cities = useMemo(() => Array.from(new Set(gigs.map((gig) => gig.city_name))).sort(), [gigs]);
  const bands = useMemo(() => Array.from(new Set(gigs.map((gig) => gig.budget_band))).sort(), [gigs]);
  const filtered = useMemo(() => {
    const cutoff = Date.now() + 30 * 24 * 60 * 60 * 1000;
    return gigs.filter((gig) =>
      (!format || gig.format_key === format) &&
      (!city || gig.city_name === city) &&
      (!band || gig.budget_band === band) &&
      (!soon || new Date(gig.shoot_window.start).getTime() <= cutoff) &&
      (!savedOnly || saved.includes(gig.id))
    );
  }, [band, city, format, gigs, saved, savedOnly, soon]);
  const toggleSaved = async (gigId: string): Promise<void> => {
    const next = saved.includes(gigId) ? saved.filter((id) => id !== gigId) : [...saved, gigId];
    setSaved(next);
    await AsyncStorage.setItem("mingla.creator.savedGigs", JSON.stringify(next));
  };
  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
    <Stack.Screen options={{ headerShown: false }} /><ProgramBackBar title="Creator hub" fallback="/(tabs)/home" />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>CREATOR HUB</Text><Text style={styles.heading}>Paid briefs near you.</Text>
      <Text style={styles.lede}>Brands stay private until you accept a funded offer. Your contact details stay private too.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <Pressable onPress={() => setFormat(null)} style={[styles.chip, !format && styles.chipOn]}><Text style={styles.chipText}>All formats</Text></Pressable>
        {CREATOR_FORMATS.map((item) => <Pressable key={item.key} accessibilityLabel={`Filter by ${item.name}`} onPress={() => setFormat(item.key)} style={[styles.chip, format === item.key && styles.chipOn]}><Text style={styles.chipText}>{item.name}</Text></Pressable>)}
      </ScrollView>
      {cities.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}><Pressable onPress={() => setCity(null)} style={[styles.chip, !city && styles.chipOn]}><Text style={styles.chipText}>Every city</Text></Pressable>{cities.map((item) => <Pressable key={item} accessibilityLabel={`Filter by ${item}`} onPress={() => setCity(item)} style={[styles.chip, city === item && styles.chipOn]}><Text style={styles.chipText}>{item}</Text></Pressable>)}</ScrollView> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}><Pressable onPress={() => setBand(null)} style={[styles.chip, !band && styles.chipOn]}><Text style={styles.chipText}>Any budget</Text></Pressable>{bands.map((item) => <Pressable key={item} accessibilityLabel={`Filter by ${item} budget`} onPress={() => setBand(item)} style={[styles.chip, band === item && styles.chipOn]}><Text style={styles.chipText}>{item.toUpperCase()}</Text></Pressable>)}<Pressable onPress={() => setSoon((value) => !value)} style={[styles.chip, soon && styles.chipOn]}><Text style={styles.chipText}>Next 30 days</Text></Pressable><Pressable onPress={() => setSavedOnly((value) => !value)} style={[styles.chip, savedOnly && styles.chipOn]}><Text style={styles.chipText}>Saved</Text></Pressable></ScrollView>
      {loading ? <Text style={styles.empty}>Finding current gigs…</Text> : filtered.length === 0 ? <GlassCard style={styles.card}><Text style={styles.cardTitle}>Nothing matches yet</Text><Text style={styles.copy}>Clear a filter or come back after the next daily match.</Text><Button label="Refresh" onPress={() => void load()} /></GlassCard> : filtered.map((gig) => <Pressable key={gig.id} accessibilityLabel={`Open gig ${gig.title_public}`} onPress={() => router.push(`/creator/gig/${gig.id}` as never)}>
        <GlassCard style={styles.card}><View style={styles.row}><Text style={styles.band}>{gig.budget_band.toUpperCase()}</Text><View style={styles.actions}><Text style={styles.slots}>{gig.slots_left} slot{gig.slots_left === 1 ? "" : "s"}</Text><Pressable accessibilityRole="button" accessibilityLabel={saved.includes(gig.id) ? "Remove saved gig" : "Save gig"} onPress={(event) => { event.stopPropagation(); void toggleSaved(gig.id); }} style={styles.save}><Text style={styles.saveText}>{saved.includes(gig.id) ? "SAVED" : "SAVE"}</Text></Pressable></View></View><Text style={styles.cardTitle}>{gig.title_public}</Text><Text numberOfLines={3} style={styles.copy}>{gig.brief_public}</Text><View style={styles.meta}><Text style={styles.metaText}>{gig.city_name}</Text><Text style={styles.metaText}>Shoot {gig.shoot_window.start}–{gig.shoot_window.end}</Text><Text style={styles.metaText}>Post by {gig.post_by}</Text></View>{gig.sales_share_bps ? <Text style={styles.share}>Plus {(gig.sales_share_bps / 100).toFixed(0)}% sales share</Text> : null}</GlassCard>
      </Pressable>)}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: canvas.profile }, content: { width: "100%", maxWidth: 920, alignSelf: "center", padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md }, eyebrow: { color: accent.warm, fontSize: 12, fontWeight: "900", letterSpacing: 1.5, marginTop: spacing.md }, heading: { color: textTokens.primary, fontSize: 34, fontWeight: "900" }, lede: { color: textTokens.secondary, fontSize: 16, lineHeight: 23 }, filters: { gap: spacing.sm, paddingVertical: spacing.xs }, chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: glass.border.profileBase }, chipOn: { borderColor: accent.warm, backgroundColor: glass.tint.profileElevated }, chipText: { color: textTokens.primary, fontWeight: "700" }, card: { padding: spacing.lg, gap: spacing.sm }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }, actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, save: { minHeight: 34, justifyContent: "center", paddingHorizontal: spacing.sm, borderRadius: radius.full, borderWidth: 1, borderColor: accent.warm }, saveText: { color: accent.warm, fontSize: 11, fontWeight: "900" }, band: { color: accent.warm, fontWeight: "900" }, slots: { color: textTokens.secondary }, cardTitle: { color: textTokens.primary, fontSize: 21, fontWeight: "900" }, copy: { color: textTokens.secondary, lineHeight: 21 }, meta: { gap: 3 }, metaText: { color: textTokens.secondary, fontSize: 13 }, share: { color: accent.warm, fontWeight: "800" }, empty: { color: textTokens.secondary } });
