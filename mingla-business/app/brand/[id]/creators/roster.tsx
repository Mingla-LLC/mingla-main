import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "../../../../src/components/ui/Button";
import { GlassCard } from "../../../../src/components/ui/GlassCard";
import { Input } from "../../../../src/components/ui/Input";
import {
  creatorGigsService,
  type CreatorRosterRow,
} from "../../../../src/services/creatorGigsService";
import { postHogService } from "../../../../src/services/postHogService";
import { shareBusinessCanonicalFallback } from "../../../../src/services/contentShareAdapter";
import {
  fetchReferralOffers,
  inviteReferralMembers,
  type ReferralOffer,
} from "../../../../src/services/referralService";
import { ScrollView } from "../../../../src/wrappers/SmartScrollView";
import {
  accent,
  canvas,
  semantic,
  spacing,
  text as textTokens,
} from "../../../../src/constants/designSystem";

type InvitedMember = { id?: unknown };

const formatMoney = (minor: number, currency: string | null): string => {
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(minor / 100);
  } catch {
    return `${code} ${(minor / 100).toFixed(2)}`;
  }
};

export default function CreatorRoster(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rows, setRows] = useState<CreatorRosterRow[]>([]);
  const [offers, setOffers] = useState<ReferralOffer[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [nextRows, nextOffers] = await Promise.all([
      creatorGigsService.listRoster(id),
      fetchReferralOffers(id),
    ]);
    const invitable = nextOffers.filter(
      (offer) =>
        offer.status === "active" &&
        (offer.audience === "invited" || offer.audience === "both"),
    );
    setRows(nextRows);
    setOffers(invitable);
    setSelectedOfferId((current) =>
      current && invitable.some((offer) => offer.id === current)
        ? current
        : (invitable[0]?.id ?? null),
    );
  }, [id]);

  useEffect(() => {
    void load().catch((error) =>
      Alert.alert(
        "Couldn’t load your creators",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }, [load]);

  const selectedOffer = useMemo(
    () => offers.find((offer) => offer.id === selectedOfferId) ?? null,
    [offers, selectedOfferId],
  );

  const save = async (): Promise<void> => {
    setBusyKey("save");
    try {
      await creatorGigsService.saveRoster(id, {
        name,
        platform: "instagram",
        handle,
        email,
        notes,
        status: "active",
      });
      postHogService.capture("roster_creator_added");
      setName("");
      setHandle("");
      setEmail("");
      setNotes("");
      await load();
      Alert.alert(
        "Creator saved",
        "They are now in your private roster. No gig money moves until they join Mingla and accept a paid contract.",
      );
    } catch (error) {
      Alert.alert(
        "Couldn’t save creator",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const invite = async (row: CreatorRosterRow): Promise<void> => {
    if (!row.email || !selectedOffer) return;
    setBusyKey(row.id);
    try {
      const result = await inviteReferralMembers(selectedOffer.id, [
        { email: row.email, displayName: row.name },
      ]);
      const member = (result.members[0] ?? null) as InvitedMember | null;
      if (!member || typeof member.id !== "string") {
        throw new Error("The invitation was created but did not return its tracking record.");
      }
      await creatorGigsService.linkRosterInvite(row.id, member.id);
      postHogService.capture("roster_invite_sent");
      await load();
      const delivered = result.delivery[0]?.sent === true;
      Alert.alert(
        delivered ? "Invite sent" : "Invite created",
        delivered
          ? `${row.name} received a secure invitation and personal tracking link.`
          : "The secure invitation and tracking link were created, but email delivery needs attention.",
      );
    } catch (error) {
      Alert.alert(
        "Couldn’t invite creator",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const shareLink = async (row: CreatorRosterRow): Promise<void> => {
    if (!row.link_slug) return;
    await shareBusinessCanonicalFallback({
      title: `${row.name}'s Mingla link`,
      message: `${row.name}'s Mingla link: https://usemingla.com/r/${row.link_slug}`,
      url: `https://usemingla.com/r/${row.link_slug}`,
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>MY CREATORS</Text>
        <Text style={styles.heading}>Keep every creator relationship together.</Text>
        <Text style={styles.lede}>
          Save off-platform contacts, invite them through an active promoter offer,
          and see their tracked sales. Paid gig work starts only after they join,
          verify, and accept a contract.
        </Text>

        <GlassCard style={styles.card}>
          <Text style={styles.title}>Add a creator</Text>
          <Input value={name} onChangeText={setName} placeholder="Creator name" />
          <Input
            value={handle}
            onChangeText={setHandle}
            placeholder="Instagram handle"
          />
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder="Email (needed to invite)"
            variant="email"
          />
          <Input
            value={notes}
            onChangeText={setNotes}
            placeholder="Private notes"
            multiline
          />
          <Button
            fullWidth
            loading={busyKey === "save"}
            label="Save to roster"
            onPress={() => void save()}
            disabled={name.trim().length < 2 || busyKey !== null}
          />
        </GlassCard>

        <GlassCard style={styles.card}>
          <Text style={styles.title}>Invitation offer</Text>
          {offers.length === 0 ? (
            <Text style={styles.copy}>
              Create and activate a referral offer for invited promoters before
              sending creator invitations.
            </Text>
          ) : (
            <View style={styles.offerRow}>
              {offers.map((offer) => (
                <Pressable
                  key={offer.id}
                  accessibilityLabel={`Select referral offer ${offer.name}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: offer.id === selectedOfferId }}
                  onPress={() => setSelectedOfferId(offer.id)}
                  style={[
                    styles.offerChip,
                    offer.id === selectedOfferId && styles.offerChipSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.offerChipText,
                      offer.id === selectedOfferId && styles.offerChipTextSelected,
                    ]}
                  >
                    {offer.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {selectedOffer ? (
            <Text style={styles.copy}>
              Invites use “{selectedOffer.name}”. Each creator receives a private,
              expiring join link and gets a personal sales link after joining.
            </Text>
          ) : null}
        </GlassCard>

        <Text style={styles.section}>Roster</Text>
        {rows.length === 0 ? (
          <GlassCard style={styles.card}>
            <Text style={styles.title}>No creators saved yet</Text>
            <Text style={styles.copy}>
              Add someone you already work with. This roster is private to your team.
            </Text>
          </GlassCard>
        ) : (
          rows.map((row) => (
            <GlassCard key={row.id} style={styles.card}>
              <View style={styles.rosterHeader}>
                <View style={styles.grow}>
                  <Text style={styles.title}>{row.name}</Text>
                  <Text style={styles.copy}>
                    {[row.handle ? `@${row.handle.replace(/^@/, "")}` : null, row.email]
                      .filter(Boolean)
                      .join(" · ") || "No contact details yet"}
                  </Text>
                </View>
                <Text style={styles.status}>{row.status.replaceAll("_", " ")}</Text>
              </View>
              {row.notes ? <Text style={styles.notes}>{row.notes}</Text> : null}
              {row.referral_member_id ? (
                <View style={styles.metrics}>
                  <View>
                    <Text style={styles.metric}>{row.sales_count}</Text>
                    <Text style={styles.metricLabel}>tracked sales</Text>
                  </View>
                  <View>
                    <Text style={styles.metric}>
                      {formatMoney(row.revenue_minor, row.currency)}
                    </Text>
                    <Text style={styles.metricLabel}>attributed revenue</Text>
                  </View>
                  {row.offer_name ? (
                    <View>
                      <Text style={styles.metric}>{row.offer_name}</Text>
                      <Text style={styles.metricLabel}>offer</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.actions}>
                {!row.referral_member_id ? (
                  <Button
                    label="Invite to Mingla"
                    size="sm"
                    loading={busyKey === row.id}
                    disabled={!row.email || !selectedOffer || busyKey !== null}
                    onPress={() => void invite(row)}
                  />
                ) : null}
                {row.link_slug ? (
                  <Button
                    label="Share tracked link"
                    size="sm"
                    variant="secondary"
                    onPress={() => void shareLink(row)}
                  />
                ) : null}
              </View>
              {!row.email && !row.referral_member_id ? (
                <Text style={styles.warning}>Add an email address to send an invitation.</Text>
              ) : null}
            </GlassCard>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: canvas.profile },
  content: {
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  eyebrow: {
    color: accent.warm,
    fontWeight: "900",
    letterSpacing: 1.3,
    marginTop: spacing.md,
  },
  heading: { color: textTokens.primary, fontSize: 31, fontWeight: "900" },
  lede: { color: textTokens.secondary, lineHeight: 22 },
  section: {
    color: textTokens.primary,
    fontSize: 21,
    fontWeight: "900",
    marginTop: spacing.sm,
  },
  card: { padding: spacing.lg, gap: spacing.md },
  title: { color: textTokens.primary, fontSize: 19, fontWeight: "900" },
  copy: { color: textTokens.secondary, lineHeight: 20 },
  notes: { color: textTokens.secondary, fontStyle: "italic", lineHeight: 20 },
  offerRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  offerChip: {
    borderWidth: 1,
    borderColor: textTokens.tertiary,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  offerChipSelected: { borderColor: accent.warm, backgroundColor: accent.warm },
  offerChipText: { color: textTokens.secondary, fontWeight: "800" },
  offerChipTextSelected: { color: "#ffffff" },
  rosterHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  grow: { flex: 1, gap: spacing.xs },
  status: { color: accent.warm, fontWeight: "900", textTransform: "capitalize" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  metric: { color: textTokens.primary, fontWeight: "900" },
  metricLabel: { color: textTokens.secondary, fontSize: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  warning: { color: semantic.warning, fontWeight: "700", fontSize: 13 },
});
