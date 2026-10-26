import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Input } from "../ui/Input";
import { CREATOR_FORMATS } from "../../services/creatorProgramService";
import { creatorGigsService } from "../../services/creatorGigsService";
import { accent, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";

type Props = { brandId: string; listingKind: "event" | "venue"; listingId: string; cityId: string; currency: string; onSaved: (id: string) => void };

export function GigEditSheet({ brandId, listingKind, listingId, cityId, currency, onSaved }: Props): React.ReactElement {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [privateBrief, setPrivateBrief] = useState("");
  const [format, setFormat] = useState<(typeof CREATOR_FORMATS)[number]["key"]>(CREATOR_FORMATS[0].key);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [postBy, setPostBy] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const result = await creatorGigsService.saveGig({ brand_id: brandId, listing_kind: listingKind, listing_id: listingId, title_public: title, brief_public: brief, brief_private: privateBrief, format_key: format, deliverables: [{ platform: "instagram", kind: "reel", count: 1 }], must_tag: { disclosure: "#ad", mingla: "@usemingla" }, city_id: cityId, category: "experience", shoot_window_start: start, shoot_window_end: end, post_by: postBy, usage_days: 90, budget_band: "b2", currency, shoot_passes: 1, slots: 1, visibility: "board", status: "open" });
      if (!result.ok) throw new Error(result.reasons?.join(", ") ?? result.error ?? "The public brief needs changes.");
      onSaved(result.id!);
    } catch (error) { Alert.alert("Couldn’t publish gig", error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <GlassCard style={styles.card}>
    <Text style={styles.title}>Hire a creator</Text>
    <Text style={styles.copy}>Creators see an anonymous brief until they accept a paid offer.</Text>
    <Input value={title} onChangeText={setTitle} placeholder="Brand-free title" accessibilityLabel="Gig title" />
    <Input value={brief} onChangeText={setBrief} placeholder="What should the creator make? Keep names, links and handles out." multiline accessibilityLabel="Public brief" />
    <Input value={privateBrief} onChangeText={setPrivateBrief} placeholder="Private details revealed after acceptance" multiline accessibilityLabel="Private brief" />
    <Text style={styles.label}>Mingla format</Text>
    <View style={styles.formats}>{CREATOR_FORMATS.map((item) => <Pressable key={item.key} onPress={() => setFormat(item.key)} style={[styles.format, format === item.key && styles.selected]}><Text style={styles.formatTitle}>{item.name}</Text><Text style={styles.hint}>A proven structure creators can price consistently.</Text></Pressable>)}</View>
    <View style={styles.dates}><Input value={start} onChangeText={setStart} placeholder="Shoot start YYYY-MM-DD" /><Input value={end} onChangeText={setEnd} placeholder="Shoot end YYYY-MM-DD" /><Input value={postBy} onChangeText={setPostBy} placeholder="Post by YYYY-MM-DD" /></View>
    <Button fullWidth loading={busy} label="Publish gig" onPress={() => void save()} disabled={title.trim().length < 8 || brief.trim().length < 40 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !/^\d{4}-\d{2}-\d{2}$/.test(postBy)} />
  </GlassCard>;
}

const styles = StyleSheet.create({ card: { padding: spacing.lg, gap: spacing.md }, title: { color: textTokens.primary, fontSize: 24, fontWeight: "900" }, copy: { color: textTokens.secondary, lineHeight: 21 }, label: { color: textTokens.primary, fontWeight: "800" }, formats: { gap: spacing.sm }, format: { borderWidth: 1, borderColor: glass.border.profileBase, borderRadius: radius.md, padding: spacing.md, gap: 4 }, selected: { borderColor: accent.warm, backgroundColor: glass.tint.profileElevated }, formatTitle: { color: textTokens.primary, fontWeight: "800" }, hint: { color: textTokens.secondary, fontSize: 12 }, dates: { gap: spacing.sm } });
