import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { shareCanonicalFallback } from "../../services/contentShareAdapter";
import { fetchBuyerReferralLink } from "../../services/referralEarningsService";
import { mixpanelService } from "../../services/mixpanelService";

export interface EarnBySharingCardProps {
  listingKind: "event" | "venue";
  listingId: string;
  title: string;
  compact?: boolean;
  onUnavailable?: () => void;
}

export const EarnBySharingCard: React.FC<EarnBySharingCardProps> = ({
  listingKind,
  listingId,
  title,
  compact = false,
  onUnavailable,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const share = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const link = await fetchBuyerReferralLink({ listingKind, listingId });
      if (!link) {
        onUnavailable?.();
        setError("This experience does not have an earning offer right now.");
        return;
      }
      const reward = link.rewardKind === "cash"
        ? `Earn ${(link.shareBps ?? 0) / 100}% when an eligible friend books.`
        : link.rewardKind === "perk"
          ? link.perkText ?? "Unlock a host perk when friends book."
          : "Earn a future-order voucher when an eligible friend books.";
      await shareCanonicalFallback({
        title,
        message: `${title}\n${reward}\n${link.url}`,
        url: link.url,
      });
      mixpanelService.track("referral_link_shared", {
        listing_kind: listingKind,
        surface: compact ? "purchase_success" : "listing",
      });
    } catch {
      setError("Your earning link could not be prepared. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, compact, listingId, listingKind, onUnavailable, title]);

  return (
    <View style={[styles.card, compact && styles.compact]} testID="earn-by-sharing-card">
      <Text style={styles.eyebrow}>EARN BY SHARING</Text>
      <Text style={styles.title}>Friends discover it. You earn when they book.</Text>
      {!compact ? (
        <Text style={styles.body}>
          Your personal link handles attribution automatically. Any buyer discount appears before checkout.
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share your earning link"
        disabled={busy}
        onPress={() => void share()}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>{busy ? "Preparing…" : "Share & earn"}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginVertical: 12,
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.38)",
    backgroundColor: "rgba(249,115,22,0.10)",
    gap: 8,
  },
  compact: { marginHorizontal: 0, marginVertical: 8 },
  eyebrow: { color: "#fb923c", fontSize: 11, fontWeight: "800", letterSpacing: 1.1 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800", lineHeight: 23 },
  body: { color: "rgba(255,255,255,0.72)", fontSize: 14, lineHeight: 20 },
  button: {
    alignSelf: "flex-start",
    marginTop: 4,
    borderRadius: 999,
    backgroundColor: "#f97316",
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  pressed: { opacity: 0.78 },
  buttonText: { color: "#fff", fontWeight: "800" },
  error: { color: "#fecaca", fontSize: 12, lineHeight: 17 },
});
