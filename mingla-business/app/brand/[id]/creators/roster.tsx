import React, { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView } from "../../../../src/wrappers/SmartScrollView";
import { Button } from "../../../../src/components/ui/Button";
import { GlassCard } from "../../../../src/components/ui/GlassCard";
import { Input } from "../../../../src/components/ui/Input";
import { creatorGigsService } from "../../../../src/services/creatorGigsService";
import { accent, canvas, spacing, text as textTokens } from "../../../../src/constants/designSystem";

export default function CreatorRoster(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>(); const [name, setName] = useState(""); const [handle, setHandle] = useState(""); const [email, setEmail] = useState(""); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await creatorGigsService.saveRoster(id, { name, platform: "instagram", handle, email, notes, status: "active" }); setName(""); setHandle(""); setEmail(""); setNotes(""); Alert.alert("Creator saved", "They are in your off-platform roster. No gig money moves until they join Mingla."); } catch (e) { Alert.alert("Couldn’t save creator", e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}><Stack.Screen options={{ headerShown: false }} /><ScrollView contentContainerStyle={styles.content}><Text style={styles.eyebrow}>MY CREATORS</Text><Text style={styles.heading}>Keep relationships in one place.</Text><Text style={styles.lede}>Track off-platform creators, referral links and invites. Paid gig work starts only after a creator joins and completes verification.</Text><GlassCard style={styles.card}><Text style={styles.title}>Add a creator</Text><Input value={name} onChangeText={setName} placeholder="Creator name" /><Input value={handle} onChangeText={setHandle} placeholder="Instagram handle" /><Input value={email} onChangeText={setEmail} placeholder="Email (optional)" /><Input value={notes} onChangeText={setNotes} placeholder="Private notes" multiline /><Button fullWidth loading={busy} label="Save to roster" onPress={() => void save()} disabled={name.trim().length < 2} /></GlassCard><GlassCard style={styles.card}><Text style={styles.title}>Invite to Mingla</Text><Text style={styles.lede}>The roster will use the existing host tracking link and referral member path. An invitation does not move money or create a contract.</Text></GlassCard></ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: canvas.profile }, content: { width: "100%", maxWidth: 760, alignSelf: "center", padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md }, eyebrow: { color: accent.warm, fontWeight: "900", letterSpacing: 1.3, marginTop: spacing.md }, heading: { color: textTokens.primary, fontSize: 31, fontWeight: "900" }, lede: { color: textTokens.secondary, lineHeight: 22 }, card: { padding: spacing.lg, gap: spacing.md }, title: { color: textTokens.primary, fontSize: 20, fontWeight: "900" } });
