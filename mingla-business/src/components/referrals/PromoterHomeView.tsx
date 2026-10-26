import React from "react";
import {
  Alert,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery } from "@tanstack/react-query";

import {
  accent,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
import { fetchPromotingOffers } from "../../services/referralService";
import { Button } from "../ui/Button";

export const PromoterHomeView: React.FC = () => {
  const offers = useQuery({
    queryKey: ["my-promoting-offers"],
    queryFn: fetchPromotingOffers,
  });
  const offerRows = offers.data ?? [];
  return (
    <ScrollView
      style={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={offers.isFetching}
          onRefresh={() => void offers.refetch()}
        />
      }
      contentContainerStyle={styles.content}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>PROMOTING</Text>
        <Text style={styles.title}>Your links and earnings</Text>
        <Text style={styles.sub}>
          Share a host’s link. When an eligible order is attributed to you,
          Mingla records the reward automatically—there is no balance to
          withdraw manually.
        </Text>
      </View>
      {offers.isLoading ? (
        <State text="Loading your offers…" />
      ) : offers.isError ? (
        <State text="Your offers couldn’t load. Pull to try again." />
      ) : offerRows.length === 0 ? (
        <State
          title="Nothing to promote yet"
          text="When a host invites you, accept with the same email address. Your offer will appear here."
        />
      ) : (
        offerRows.map((offer) => {
          const url = `https://usemingla.com/r/${offer.linkSlug}`;
          return (
            <View key={offer.memberId} style={styles.card}>
              <Text style={styles.brand}>{offer.brandName}</Text>
              <Text style={styles.cardTitle}>{offer.offerName}</Text>
              <Text style={styles.reward}>
                {offer.rewardKind === "cash"
                  ? `${(offer.shareBps ?? 0) / 100}% of eligible sales`
                  : offer.rewardKind === "perk"
                    ? offer.perkText
                    : "Future-order voucher"}
              </Text>
              <Text style={styles.link}>{url}</Text>
              <View style={styles.actions}>
                <Button
                  size="sm"
                  label="Share link"
                  onPress={() =>
                    void Share.share({
                      message: `Take a look at ${offer.brandName}: ${url}`,
                      url,
                    })
                  }
                />
                <Button
                  size="sm"
                  variant="secondary"
                  label="Copy"
                  onPress={() => void Clipboard.setStringAsync(url)}
                />
              </View>
              <View style={styles.metrics}>
                <Metric label="Sales" value={String(offer.salesCount)} />
                <Metric
                  label="Earned"
                  value={formatCurrency(
                    offer.earnedMinor,
                    offer.currency,
                    true,
                  )}
                />
                <Metric
                  label="Paid"
                  value={formatCurrency(offer.paidMinor, offer.currency, true)}
                />
              </View>
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>What you receive</Text>
                <Text style={styles.sub}>
                  Mingla deducts its 5% referral service fee when the reward is
                  recorded. Your payout provider may also deduct a transfer fee
                  from the payout. Buyers are not charged these fees.
                </Text>
              </View>
              <Button
                variant="secondary"
                label="Payout account"
                onPress={() =>
                  Alert.alert(
                    "Payout account",
                    "Payout setup opens from your Explorer earnings wallet. Mingla never stores a withdrawable cash balance.",
                  )
                }
              />
            </View>
          );
        })
      )}
    </ScrollView>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <View style={styles.metric}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.meta}>{label}</Text>
  </View>
);
const State: React.FC<{ title?: string; text: string }> = ({ title, text }) => (
  <View style={styles.state}>
    {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
    <Text style={styles.sub}>{text}</Text>
  </View>
);
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: canvas.profile },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 80 },
  hero: { marginBottom: spacing.sm },
  eyebrow: {
    color: accent.warm,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  title: {
    color: textTokens.primary,
    fontSize: 27,
    fontWeight: "900",
    marginTop: spacing.xs,
  },
  sub: { color: textTokens.secondary, lineHeight: 20, marginTop: spacing.xs },
  card: {
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.control,
    backgroundColor: glass.tint.profileBase,
    padding: spacing.md,
  },
  brand: {
    color: accent.warm,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  cardTitle: { color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  reward: { color: textTokens.secondary, fontWeight: "700" },
  link: { color: accent.warm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: {
    minWidth: 100,
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.035)",
    padding: spacing.sm,
  },
  metricValue: { color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  meta: { color: textTokens.tertiary, fontSize: 12 },
  notice: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.35)",
    backgroundColor: "rgba(249,115,22,0.08)",
    padding: spacing.sm,
  },
  noticeTitle: { color: textTokens.primary, fontWeight: "800" },
  state: {
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: glass.border.control,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
});
