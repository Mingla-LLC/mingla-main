import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { buyerReferralKeys } from "../../hooks/queryKeys";
import { shareCanonicalFallback } from "../../services/contentShareAdapter";
import { fetchBuyerReferralLink } from "../../services/referralEarningsService";
import { mixpanelService } from "../../services/mixpanelService";
import { useAppStore } from "../../store/appStore";

export interface EarnBySharingCardProps {
  listingKind: "event" | "venue";
  listingId: string;
  title: string;
  compact?: boolean;
}

function rewardLine(link: {
  rewardKind: string;
  shareBps: number | null;
  perkText: string | null;
}): string {
  if (link.rewardKind === "cash") {
    return `Earn ${(link.shareBps ?? 0) / 100}% when an eligible friend books.`;
  }
  if (link.rewardKind === "perk") {
    return link.perkText ?? "Unlock a host perk when friends book.";
  }
  return "Earn a future-order voucher when an eligible friend books.";
}

export const EarnBySharingCard: React.FC<EarnBySharingCardProps> = ({
  listingKind,
  listingId,
  title,
  compact = false,
}) => {
  const userId = useAppStore((state) => state.user?.id ?? null);
  const offer = useQuery({
    queryKey: buyerReferralKeys.link(
      userId ?? "none",
      listingKind,
      listingId,
    ),
    queryFn: () => fetchBuyerReferralLink({ listingKind, listingId }),
    enabled: userId !== null,
    staleTime: 60_000,
    retry: 1,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const share = useCallback(async () => {
    const link = offer.data;
    if (busy || !link) return;
    setBusy(true);
    setError(null);
    try {
      const reward = rewardLine(link);
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
  }, [busy, compact, listingKind, offer.data, title]);

  if (!offer.data) return null;

  const reward = rewardLine(offer.data);

  return (
    <View style={[styles.card, compact && styles.compact]} testID="earn-by-sharing-card">
      <Text style={styles.eyebrow}>EARN BY SHARING</Text>
      <Text style={styles.title}>Friends discover it. You earn when they book.</Text>
      <Text style={styles.body}>{reward}</Text>
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
