import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView } from "../../../../src/wrappers/SmartScrollView";
import { Button } from "../../../../src/components/ui/Button";
import { GlassCard } from "../../../../src/components/ui/GlassCard";
import { GigEditSheet } from "../../../../src/components/gigs/GigEditSheet";
import { creatorGigsService } from "../../../../src/services/creatorGigsService";
import { fetchReferralListingOptions, type ReferralListingOption } from "../../../../src/services/referralService";
import { supabase } from "../../../../src/services/supabase";
import { useBrand } from "../../../../src/hooks/useBrands";
import { accent, canvas, spacing, text as textTokens } from "../../../../src/constants/designSystem";
import { ProgramBackBar } from "../../../../src/components/programs/ProgramBackBar";

export default function BrandCreatorsHome(): React.ReactElement {
  const params = useLocalSearchParams<{ id: string; listingId?: string; listingKind?: "event" | "venue"; cityId?: string; currency?: string }>(); const router = useRouter();
  const [data, setData] = useState<{ gigs: Array<Record<string, unknown>>; contracts: Array<Record<string, unknown>> }>({ gigs: [], contracts: [] }); const [editing, setEditing] = useState(false);
  const { data: brand } = useBrand(params.id ?? null);
  const currency = params.currency ?? brand?.pricingCurrency ?? brand?.defaultCurrency ?? "USD";
  // A gig needs a listing and a city. Deep links may carry both; otherwise the
  // host picks them here, so the editor is always reachable from the app.
  const [listings, setListings] = useState<ReferralListingOption[]>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string }>>([]);
  const [listing, setListing] = useState<{ kind: "event" | "venue"; id: string; label: string } | null>(params.listingId ? { kind: params.listingKind ?? "event", id: params.listingId, label: "" } : null);
  const [cityId, setCityId] = useState<string | null>(params.cityId ?? null);
  useEffect(() => {
    if (!editing) return;
    void fetchReferralListingOptions(params.id).then(setListings).catch(() => setListings([]));
    void supabase.from("seeding_cities").select("id,name").eq("is_live_for_consumers", true).order("name").limit(100)
      .then(({ data: rows }) => { const next = (rows ?? []).map((row) => ({ id: String(row.id), name: String(row.name) })); setCities(next); if (!cityId && next.length === 1) setCityId(next[0].id); });
  }, [editing, params.id, cityId]);
  const load = useCallback(async () => setData(await creatorGigsService.hostHome(params.id)), [params.id]); useEffect(() => { void load().catch((e) => Alert.alert("Couldn’t load creators", e instanceof Error ? e.message : String(e))); }, [load]);
  const needsAction = data.contracts.filter((item) => ["script_sent", "delivered", "posts_submitted", "disputed"].includes(String(item.state)));
  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}><Stack.Screen options={{ headerShown: false }} /><ProgramBackBar title="Creators" fallback={`/brand/${params.id}`} /><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.hero}><View style={styles.grow}><Text style={styles.eyebrow}>PROMOTE WITH CREATORS</Text><Text style={styles.heading}>Book content with clear terms.</Text><Text style={styles.lede}>Post a private-safe brief, compare creators, fund the offer, and follow the work in one timeline.</Text></View><Button label="My creators" variant="secondary" onPress={() => router.push(`/brand/${params.id}/creators/roster` as never)} /></View>
    {needsAction.length ? <GlassCard style={styles.alert}><Text style={styles.alertTitle}>{needsAction.length} contract{needsAction.length === 1 ? "" : "s"} need your action</Text>{needsAction.map((item) => <Pressable key={String(item.id)} accessibilityLabel={`Open contract ${String(item.title)}`} onPress={() => router.push(`/brand/${params.id}/creators/contract/${item.id}` as never)}><Text style={styles.action}>{String(item.title)} · {String(item.state).replaceAll("_", " ")}</Text></Pressable>)}</GlassCard> : null}
    {!editing ? <Button fullWidth label="Post a creator gig" onPress={() => setEditing(true)} /> : listing && cityId ? <GigEditSheet brandId={params.id} listingKind={listing.kind} listingId={listing.id} cityId={cityId} currency={currency} onSaved={(gigId) => { setEditing(false); void load(); router.push(`/brand/${params.id}/creators/${gigId}/interest` as never); }} /> : <GlassCard style={styles.card}>
      <Text style={styles.cardTitle}>What should creators promote?</Text>
      {listings.length ? listings.map((item) => <Pressable key={`${item.listingKind}:${item.listingId}`} accessibilityRole="button" accessibilityState={{ selected: listing?.id === item.listingId }} onPress={() => setListing({ kind: item.listingKind, id: item.listingId, label: item.label })} style={[styles.choice, listing?.id === item.listingId && styles.choiceOn]}><Text style={styles.choiceTitle}>{item.label}</Text><Text style={styles.copy}>{item.typeLabel}</Text></Pressable>) : <Text style={styles.copy}>Publish an event or venue first. Creators promote a specific listing.</Text>}
      {listing ? <><Text style={styles.cardTitle}>Which city is the shoot in?</Text><View style={styles.chips}>{cities.map((city) => <Pressable key={city.id} accessibilityRole="button" accessibilityState={{ selected: cityId === city.id }} onPress={() => setCityId(city.id)} style={[styles.chip, cityId === city.id && styles.choiceOn]}><Text style={styles.choiceTitle}>{city.name}</Text></Pressable>)}</View></> : null}
      <Button label="Cancel" variant="secondary" onPress={() => { setEditing(false); setListing(null); }} />
    </GlassCard>}
    <Text style={styles.section}>Your gigs</Text>{data.gigs.length ? data.gigs.map((gig) => <Pressable key={String(gig.id)} accessibilityLabel={`Open gig ${String(gig.title_public)}`} onPress={() => router.push(`/brand/${params.id}/creators/${gig.id}/interest` as never)}><GlassCard style={styles.card}><View style={styles.row}><Text style={styles.cardTitle}>{String(gig.title_public)}</Text><Text style={styles.status}>{String(gig.status)}</Text></View><Text style={styles.copy}>{String(gig.brief_public)}</Text></GlassCard></Pressable>) : <GlassCard style={styles.card}><Text style={styles.cardTitle}>No gigs yet</Text><Text style={styles.copy}>Post a gig to start getting interest from verified creators.</Text></GlassCard>}
    <Text style={styles.section}>Contracts</Text>{data.contracts.map((item) => <Pressable key={String(item.id)} accessibilityLabel={`Open contract ${String(item.title)}`} onPress={() => router.push(`/brand/${params.id}/creators/contract/${item.id}` as never)}><GlassCard style={styles.card}><Text style={styles.cardTitle}>{String(item.title)}</Text><Text style={styles.copy}>{String(item.creator)} · {String(item.state).replaceAll("_", " ")}</Text></GlassCard></Pressable>)}
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: canvas.profile }, content: { width: "100%", maxWidth: 980, alignSelf: "center", padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md }, hero: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, alignItems: "flex-start", marginTop: spacing.md }, grow: { flex: 1, minWidth: 260, gap: spacing.sm }, eyebrow: { color: accent.warm, fontWeight: "900", letterSpacing: 1.3 }, heading: { color: textTokens.primary, fontSize: 34, fontWeight: "900" }, lede: { color: textTokens.secondary, lineHeight: 23 }, alert: { padding: spacing.lg, gap: spacing.sm, borderColor: accent.warm }, alertTitle: { color: accent.warm, fontWeight: "900", fontSize: 18 }, action: { color: textTokens.primary, fontWeight: "700" }, section: { color: textTokens.primary, fontSize: 21, fontWeight: "900", marginTop: spacing.sm }, card: { padding: spacing.lg, gap: spacing.sm }, row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md }, cardTitle: { color: textTokens.primary, fontSize: 18, fontWeight: "900", flex: 1 }, status: { color: accent.warm, fontWeight: "800", textTransform: "capitalize" }, copy: { color: textTokens.secondary, lineHeight: 20 }, choice: { padding: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", gap: 2 }, choiceOn: { borderColor: accent.warm, backgroundColor: "rgba(235,120,37,0.12)" }, choiceTitle: { color: textTokens.primary, fontWeight: "700" }, chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" } });
