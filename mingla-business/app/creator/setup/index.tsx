import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScrollView } from "../../../src/wrappers/SmartScrollView";
import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Input } from "../../../src/components/ui/Input";
import {
  CREATOR_FORMATS,
  CREATOR_NICHES,
  creatorProgramService,
  type CreatorSetupStatus,
} from "../../../src/services/creatorProgramService";
import { accent, canvas, glass, radius, semantic, spacing, text as textTokens } from "../../../src/constants/designSystem";

type Step = "profile" | "handles" | "packages" | "showcase" | "payout" | "agreement";
const STEPS: Array<{ key: Step; title: string; outcome: string }> = [
  { key: "profile", title: "Your creator profile", outcome: "Tell hosts who you are and what you make." },
  { key: "handles", title: "Prove one social account", outcome: "A short code in your bio confirms the account is yours." },
  { key: "packages", title: "Set your packages", outcome: "Price the Mingla formats you want to make." },
  { key: "showcase", title: "Add a showcase", outcome: "Hosts see a processed sample before they hire you." },
  { key: "payout", title: "Choose where you are paid", outcome: "Connect Stripe or a verified Paystack bank recipient." },
  { key: "agreement", title: "Review the creator agreement", outcome: "Sign the approved version before taking work." },
];

const missingFor = (step: Step, status: CreatorSetupStatus | null): boolean => {
  if (!status) return true;
  const missing = new Set(status.missing ?? []);
  return ({
    profile: !status.profile,
    handles: missing.has("verified_handle"),
    packages: missing.has("package"),
    showcase: missing.has("processed_showcase"),
    payout: missing.has("active_payout"),
    agreement: missing.has("signed_agreement"),
  })[step];
};

export default function CreatorSetupScreen(): React.ReactElement {
  const router = useRouter();
  const [status, setStatus] = useState<CreatorSetupStatus | null>(null);
  const [step, setStep] = useState<Step>("profile");
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [dob, setDob] = useState("");
  const [languages, setLanguages] = useState("English");
  const [niches, setNiches] = useState<string[]>([]);
  const [platform, setPlatform] = useState("instagram");
  const [handle, setHandle] = useState("");
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [handleId, setHandleId] = useState<string | null>(null);
  const [formatKey, setFormatKey] = useState<(typeof CREATOR_FORMATS)[number]["key"]>(CREATOR_FORMATS[0].key);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [turnaround, setTurnaround] = useState("3");
  const agreementVersion = process.env.EXPO_PUBLIC_CREATOR_AGREEMENT_VERSION?.trim() ?? "";

  const refresh = useCallback(async () => {
    const next = await creatorProgramService.status();
    setStatus(next);
    const firstMissing = STEPS.find((item) => missingFor(item.key, next));
    if (firstMissing) setStep(firstMissing.key);
  }, []);
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);

  const current = useMemo(() => STEPS.find((item) => item.key === step) ?? STEPS[0], [step]);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await action(); await refresh(); Alert.alert("Saved", message); }
    catch (error) { Alert.alert("Couldn’t save", error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen options={{ title: "Creator setup", headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>MINGLA CREATOR</Text>
          <Text style={styles.heading}>Get ready to be hired.</Text>
          <Text style={styles.lede}>Complete these six checks once. You’ll always see exactly what is left.</Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round((STEPS.filter((item) => !missingFor(item.key, status)).length / STEPS.length) * 100)}%` }]} /></View>
          <Button variant="ghost" size="sm" label="Refresh readiness checks" loading={busy} onPress={() => void run(() => creatorProgramService.recompute(), "Your readiness checks are up to date.")} />
        </View>

        <View style={styles.stepRail}>
          {STEPS.map((item, index) => {
            const done = !missingFor(item.key, status);
            const selected = item.key === step;
            return <Pressable key={item.key} onPress={() => setStep(item.key)} style={[styles.stepChip, selected && styles.stepChipSelected]} accessibilityRole="button">
              <Text style={[styles.stepNumber, done && styles.stepDone]}>{done ? "✓" : index + 1}</Text>
              <Text style={[styles.stepLabel, selected && styles.stepLabelSelected]}>{item.title}</Text>
            </Pressable>;
          })}
        </View>

        <GlassCard style={styles.card}>
          <Text style={styles.cardTitle}>{current.title}</Text>
          <Text style={styles.cardOutcome}>{current.outcome}</Text>

          {step === "profile" && <View style={styles.form}>
            <Input value={displayName} onChangeText={setDisplayName} placeholder="Display name" accessibilityLabel="Display name" />
            <Input value={bio} onChangeText={setBio} placeholder="Short bio (280 characters)" multiline accessibilityLabel="Creator bio" />
            <Input value={dob} onChangeText={setDob} placeholder="Date of birth — YYYY-MM-DD" accessibilityLabel="Date of birth" />
            <Input value={languages} onChangeText={setLanguages} placeholder="Languages, separated by commas" accessibilityLabel="Languages" />
            <Text style={styles.fieldLabel}>Pick up to five niches</Text>
            <View style={styles.choiceWrap}>{CREATOR_NICHES.map((item) => <Pressable key={item} onPress={() => setNiches((value) => value.includes(item) ? value.filter((x) => x !== item) : value.length < 5 ? [...value, item] : value)} style={[styles.choice, niches.includes(item) && styles.choiceSelected]}><Text style={styles.choiceText}>{item}</Text></Pressable>)}</View>
            <Button fullWidth loading={busy} label="Save profile" onPress={() => void run(() => creatorProgramService.saveProfile({ displayName, bio, dateOfBirth: dob, niches, languages: languages.split(",").map((x) => x.trim()).filter(Boolean), usageAdsOptIn: false }), "Your creator profile is saved.")} disabled={displayName.trim().length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(dob)} />
          </View>}

          {step === "handles" && <View style={styles.form}>
            <Text style={styles.fieldLabel}>Platform</Text>
            <View style={styles.choiceWrap}>{["instagram","tiktok","youtube","x","snapchat"].map((item) => <Pressable key={item} onPress={() => setPlatform(item)} style={[styles.choice, platform === item && styles.choiceSelected]}><Text style={styles.choiceText}>{item}</Text></Pressable>)}</View>
            <Input value={handle} onChangeText={setHandle} placeholder="Handle without @" accessibilityLabel="Social handle" />
            {verificationCode && <View style={styles.codeBox}><Text style={styles.code}>{verificationCode}</Text><Text style={styles.codeHelp}>Put this exact code in your public bio, then come back and check it.</Text></View>}
            <Button fullWidth loading={busy} label={verificationCode ? "Save a new code" : "Get verification code"} onPress={() => void run(async () => { const saved = await creatorProgramService.saveHandle({ platform, handle }); setVerificationCode(saved.verify_code); setHandleId(saved.id); }, "Your code is ready for your public bio.")} disabled={handle.trim().length < 1} />
            {handleId && <Button fullWidth variant="secondary" loading={busy} label="Check my public bio" onPress={() => void run(() => creatorProgramService.verifyHandle(handleId), "We checked the account. Your setup status is updated.")} />}
          </View>}

          {step === "packages" && <View style={styles.form}>
            <Text style={styles.fieldLabel}>Format</Text>
            {CREATOR_FORMATS.map((item) => <Pressable key={item.key} onPress={() => setFormatKey(item.key)} style={[styles.formatCard, formatKey === item.key && styles.formatCardSelected]}><Text style={styles.formatTitle}>{item.name}</Text><Text style={styles.formatHint}>Set your own price and turnaround.</Text></Pressable>)}
            <Input value={price} onChangeText={setPrice} placeholder="Price in minor units (for example 50000)" variant="number" accessibilityLabel="Package price" />
            <Input value={currency} onChangeText={(value) => setCurrency(value.toUpperCase())} placeholder="Currency, for example NGN" accessibilityLabel="Currency" />
            <Input value={turnaround} onChangeText={setTurnaround} placeholder="Turnaround days" variant="number" accessibilityLabel="Turnaround days" />
            <Button fullWidth loading={busy} label="Save package" onPress={() => void run(() => creatorProgramService.savePackage({ formatKey, platforms: [platform], priceMinor: Number(price), currency, turnaroundDays: Number(turnaround), includesUsageDays: 90 }), "Hosts can now match your format and price.")} disabled={!Number.isInteger(Number(price)) || Number(price) <= 0 || currency.length !== 3} />
          </View>}

          {step === "showcase" && <View style={styles.form}><Text style={styles.info}>Upload one vertical video up to 90 seconds and 150 MB. Mingla processes a private review copy; the original is not kept.</Text><Button fullWidth label="Choose showcase video" onPress={() => router.push("/creator/setup/showcase" as never)} /></View>}
          {step === "payout" && <View style={styles.form}><Text style={styles.info}>Connect Stripe where supported, or verify a Paystack bank recipient. You are paid to your provider account—Mingla does not create a wallet balance.</Text><Button fullWidth label="Set up payouts" onPress={() => router.push("/partner/earnings" as never)} /></View>}
          {step === "agreement" && <View style={styles.form}><Text style={styles.info}>{agreementVersion ? `Approved agreement version: ${agreementVersion}` : "The agreement is waiting for Seth’s approved legal version. The screen is built, but signing stays safely disabled until that version is configured."}</Text><Button fullWidth loading={busy} label="Sign creator agreement" disabled={!agreementVersion} onPress={() => void run(() => creatorProgramService.signAgreement(agreementVersion), "Your agreement signature is recorded.")} /></View>}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: canvas.profile },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md, maxWidth: 920, width: "100%", alignSelf: "center" },
  hero: { gap: spacing.sm, paddingVertical: spacing.lg },
  eyebrow: { color: accent.warm, fontSize: 12, fontWeight: "800", letterSpacing: 1.6 },
  heading: { color: textTokens.primary, fontSize: 34, lineHeight: 40, fontWeight: "900" },
  lede: { color: textTokens.secondary, fontSize: 16, lineHeight: 23, maxWidth: 620 },
  progressTrack: { height: 8, borderRadius: radius.full, backgroundColor: glass.tint.chrome.idle, overflow: "hidden", marginTop: spacing.sm },
  progressFill: { height: 8, borderRadius: radius.full, backgroundColor: accent.warm },
  stepRail: { gap: spacing.sm },
  stepChip: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: glass.border.profileBase, paddingHorizontal: spacing.md, backgroundColor: glass.tint.profileBase },
  stepChipSelected: { borderColor: accent.warm, backgroundColor: glass.tint.profileElevated },
  stepNumber: { color: textTokens.secondary, fontWeight: "900", width: 24 },
  stepDone: { color: semantic.success },
  stepLabel: { color: textTokens.secondary, fontWeight: "700", flex: 1 },
  stepLabelSelected: { color: textTokens.primary },
  card: { padding: spacing.lg, gap: spacing.sm },
  cardTitle: { color: textTokens.primary, fontSize: 24, fontWeight: "900" },
  cardOutcome: { color: textTokens.secondary, fontSize: 15, lineHeight: 22, marginBottom: spacing.sm },
  form: { gap: spacing.md },
  fieldLabel: { color: textTokens.primary, fontSize: 14, fontWeight: "800" },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { minHeight: 40, justifyContent: "center", borderRadius: radius.full, borderWidth: 1, borderColor: glass.border.profileBase, paddingHorizontal: spacing.md, backgroundColor: glass.tint.profileBase },
  choiceSelected: { borderColor: accent.warm, backgroundColor: glass.tint.profileElevated },
  choiceText: { color: textTokens.primary, fontSize: 13, fontWeight: "700", textTransform: "capitalize" },
  codeBox: { borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, backgroundColor: glass.tint.profileElevated, borderWidth: 1, borderColor: accent.warm },
  code: { color: textTokens.primary, fontSize: 25, letterSpacing: 2, fontWeight: "900" },
  codeHelp: { color: textTokens.secondary, lineHeight: 20 },
  formatCard: { borderRadius: radius.md, borderWidth: 1, borderColor: glass.border.profileBase, padding: spacing.md, gap: spacing.xs },
  formatCardSelected: { borderColor: accent.warm },
  formatTitle: { color: textTokens.primary, fontWeight: "800" },
  formatHint: { color: textTokens.secondary, fontSize: 13 },
  info: { color: textTokens.secondary, fontSize: 15, lineHeight: 23 },
});
