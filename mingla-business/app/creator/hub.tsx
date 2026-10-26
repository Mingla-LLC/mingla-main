import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView } from "../../src/wrappers/SmartScrollView";
import { Button } from "../../src/components/ui/Button";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { CREATOR_FORMATS } from "../../src/services/creatorProgramService";
import { creatorGigsService, type PublicGig } from "../../src/services/creatorGigsService";
import { accent, canvas, glass, radius, spacing, text as textTokens } from "../../src/constants/designSystem";

export default function CreatorHub(): React.ReactElement {
  const router = useRouter();
  const [gigs, setGigs] = useState<PublicGig[]>([]);
  const [format, setFormat] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setGigs(await creatorGigsService.board(null, format)); } finally { setLoading(false); } }, [format]);
  useEffect(() => { void load(); }, [load]);
  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
    <Stack.Screen options={{ headerShown: false }} />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>CREATOR HUB</Text><Text style={styles.heading}>Paid briefs near you.</Text>
      <Text style={styles.lede}>Brands stay private until you accept a funded offer. Your contact details stay private too.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <Pressable onPress={() => setFormat(null)} style={[styles.chip, !format && styles.chipOn]}><Text style={styles.chipText}>All formats</Text></Pressable>
        {CREATOR_FORMATS.map((item) => <Pressable key={item.key} onPress={() => setFormat(item.key)} style={[styles.chip, format === item.key && styles.chipOn]}><Text style={styles.chipText}>{item.name}</Text></Pressable>)}
      </ScrollView>
      {loading ? <Text style={styles.empty}>Finding current gigs…</Text> : gigs.length === 0 ? <GlassCard style={styles.card}><Text style={styles.cardTitle}>Nothing matches yet</Text><Text style={styles.copy}>Try another format or come back after the next daily match.</Text><Button label="Refresh" onPress={() => void load()} /></GlassCard> : gigs.map((gig) => <Pressable key={gig.id} onPress={() => router.push(`/creator/gig/${gig.id}` as never)}>
        <GlassCard style={styles.card}><View style={styles.row}><Text style={styles.band}>{gig.budget_band.toUpperCase()}</Text><Text style={styles.slots}>{gig.slots_left} slot{gig.slots_left === 1 ? "" : "s"}</Text></View><Text style={styles.cardTitle}>{gig.title_public}</Text><Text numberOfLines={3} style={styles.copy}>{gig.brief_public}</Text><View style={styles.meta}><Text style={styles.metaText}>{gig.city_name}</Text><Text style={styles.metaText}>Shoot {gig.shoot_window.start}–{gig.shoot_window.end}</Text><Text style={styles.metaText}>Post by {gig.post_by}</Text></View>{gig.sales_share_bps ? <Text style={styles.share}>Plus {(gig.sales_share_bps / 100).toFixed(0)}% sales share</Text> : null}</GlassCard>
      </Pressable>)}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: canvas.profile }, content: { width: "100%", maxWidth: 920, alignSelf: "center", padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md }, eyebrow: { color: accent.warm, fontSize: 12, fontWeight: "900", letterSpacing: 1.5, marginTop: spacing.md }, heading: { color: textTokens.primary, fontSize: 34, fontWeight: "900" }, lede: { color: textTokens.secondary, fontSize: 16, lineHeight: 23 }, filters: { gap: spacing.sm, paddingVertical: spacing.xs }, chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: glass.border.profileBase }, chipOn: { borderColor: accent.warm, backgroundColor: glass.tint.profileElevated }, chipText: { color: textTokens.primary, fontWeight: "700" }, card: { padding: spacing.lg, gap: spacing.sm }, row: { flexDirection: "row", justifyContent: "space-between" }, band: { color: accent.warm, fontWeight: "900" }, slots: { color: textTokens.secondary }, cardTitle: { color: textTokens.primary, fontSize: 21, fontWeight: "900" }, copy: { color: textTokens.secondary, lineHeight: 21 }, meta: { gap: 3 }, metaText: { color: textTokens.secondary, fontSize: 13 }, share: { color: accent.warm, fontWeight: "800" }, empty: { color: textTokens.secondary } });
