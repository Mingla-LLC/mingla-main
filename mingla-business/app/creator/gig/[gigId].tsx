import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView } from "../../../src/wrappers/SmartScrollView";
import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Input } from "../../../src/components/ui/Input";
import type { CreatorSetupStatus } from "../../../src/services/creatorProgramContract";
import { fetchCreatorSetupStatus } from "../../../src/services/creatorSetupStatusService";
import { creatorGigsService, type PublicGig } from "../../../src/services/creatorGigsService";
import { accent, canvas, spacing, text as textTokens } from "../../../src/constants/designSystem";

export default function CreatorGigDetail(): React.ReactElement {
  const { gigId } = useLocalSearchParams<{ gigId: string }>(); const router = useRouter();
  const [gig, setGig] = useState<PublicGig | null>(null); const [setup, setSetup] = useState<CreatorSetupStatus | null>(null); const [packageId, setPackageId] = useState(""); const [quote, setQuote] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { void Promise.all([creatorGigsService.detail(gigId), fetchCreatorSetupStatus()]).then(([nextGig, nextSetup]) => { setGig(nextGig); setSetup(nextSetup); const first = nextSetup.packages?.find((item) => item.format_key === nextGig.format_key) ?? nextSetup.packages?.[0]; if (first?.id) { setPackageId(String(first.id)); setQuote(String(first.price_minor ?? "")); } }).catch((e) => Alert.alert("Couldn’t load gig", e instanceof Error ? e.message : String(e))); }, [gigId]);
  const send = async () => { setBusy(true); try { const result = await creatorGigsService.sendInterest(gigId, packageId, Number(quote), note); if ((result as { ok?: boolean }).ok === false) throw new Error((result as { error?: string }).error ?? "Couldn’t send interest"); Alert.alert("Interest sent", "The host sees only your pre-hire profile, package and quote."); router.back(); } catch (e) { Alert.alert("Couldn’t send interest", e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  if (!gig) return <SafeAreaView style={styles.safe}><Text style={styles.loading}>Loading private-safe brief…</Text></SafeAreaView>;
  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}><Stack.Screen options={{ headerShown: false }} /><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>ANONYMOUS UNTIL HIRE</Text><Text style={styles.heading}>{gig.title_public}</Text><Text style={styles.lede}>{gig.brief_public}</Text>
    <GlassCard style={styles.card}><Text style={styles.title}>What is agreed upfront</Text><Text style={styles.item}>Format: {gig.format_key.replaceAll("_", " ")}</Text><Text style={styles.item}>Shoot: {gig.shoot_window.start} to {gig.shoot_window.end}</Text><Text style={styles.item}>Post by: {gig.post_by}</Text><Text style={styles.item}>Usage: {gig.usage_days} days</Text><Text style={styles.item}>Budget band: {gig.budget_band.toUpperCase()}</Text>{gig.sales_share_bps ? <Text style={styles.share}>Sales share: {(gig.sales_share_bps / 100).toFixed(0)}%</Text> : null}</GlassCard>
    <GlassCard style={styles.card}><Text style={styles.title}>Send interest</Text>{setup?.verification !== "verified" ? <><Text style={styles.warning}>Finish Creator setup before applying. Missing: {(setup?.missing ?? ["readiness checks"]).join(", ")}.</Text><Button label="Finish setup" onPress={() => router.push("/creator/setup" as never)} /></> : <><Input value={quote} onChangeText={setQuote} placeholder="Your price in minor units" variant="number" accessibilityLabel="Gig quote" /><Input value={note} onChangeText={setNote} placeholder="Optional note (no links, handles, email or phone)" multiline accessibilityLabel="Interest note" /><Button fullWidth loading={busy} label="Send interest" onPress={() => void send()} disabled={!packageId || !Number.isInteger(Number(quote)) || Number(quote) <= 0} /><Text style={styles.help}>Your handle and contact details are not shared before hire.</Text></>}</GlassCard>
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: canvas.profile }, loading: { color: textTokens.secondary, padding: spacing.lg }, content: { width: "100%", maxWidth: 820, alignSelf: "center", padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md }, eyebrow: { color: accent.warm, fontWeight: "900", letterSpacing: 1.3, marginTop: spacing.md }, heading: { color: textTokens.primary, fontSize: 34, fontWeight: "900" }, lede: { color: textTokens.secondary, fontSize: 17, lineHeight: 25 }, card: { padding: spacing.lg, gap: spacing.sm }, title: { color: textTokens.primary, fontSize: 20, fontWeight: "900" }, item: { color: textTokens.secondary }, share: { color: accent.warm, fontWeight: "800" }, warning: { color: accent.warm, lineHeight: 21 }, help: { color: textTokens.secondary, fontSize: 13 } });
