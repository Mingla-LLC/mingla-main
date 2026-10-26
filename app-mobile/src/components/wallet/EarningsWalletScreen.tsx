import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { fetchEarningsSummary } from "../../services/referralEarningsService";
import { shareCanonicalFallback } from "../../services/contentShareAdapter";
import { mixpanelService } from "../../services/mixpanelService";
import { PayoutAccountSheet } from "./PayoutAccountSheet";

const money = (minor: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch { return `${currency} ${(minor / 100).toFixed(2)}`; }
};
const humanStatus = (status: string) => ({
  pending: "On the way",
  held_until_event: "Held until the experience",
  releasable: "Ready for automatic payout",
  accumulating: "Building toward provider minimum",
  paid: "Paid",
  reversed: "Reversed after refund",
  failed: "Payout needs attention",
  unclaimed_expired: "Claim window ended",
}[status] ?? status.replaceAll("_", " "));

export const EarningsWalletScreen: React.FC = () => {
  const router = useRouter();
  const [payoutOpen, setPayoutOpen] = useState(false);
  const reportedUsedVoucher = useRef(false);
  const query = useQuery({
    queryKey: ["earnings-wallet"],
    queryFn: fetchEarningsSummary,
  });
  useEffect(() => {
    mixpanelService.track("wallet_viewed", { surface: "explorer" });
  }, []);
  useEffect(() => {
    if (!reportedUsedVoucher.current && query.data?.vouchers.some((voucher) => voucher.status === "used")) {
      reportedUsedVoucher.current = true;
      mixpanelService.track("voucher_redeemed", { surface: "explorer_wallet" });
    }
  }, [query.data?.vouchers]);
  const currencyRows = useMemo(
    () => Object.entries(query.data?.totals ?? {}),
    [query.data?.totals],
  );
  return (
    <View style={styles.page}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={styles.back}>‹ Back</Text></Pressable>
        <Text style={styles.topTitle}>Earnings & rewards</Text>
        <View style={styles.spacer} />
      </View>
      {query.isLoading ? (
        <View style={styles.center}><ActivityIndicator color="#f97316" /></View>
      ) : query.isError || !query.data ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Your earnings could not load</Text>
          <Pressable onPress={() => void query.refetch()} style={styles.primary}><Text style={styles.primaryText}>Try again</Text></Pressable>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor="#f97316" />}
          contentContainerStyle={styles.content}
        >
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>YOUR REFERRAL REWARDS</Text>
            <Text style={styles.heroTitle}>Every reward, in plain English.</Text>
            <Text style={styles.body}>Rewards move from “on the way” to automatic payout after the experience and refund window. This is a record of what Mingla owes you—not a cash balance or withdrawal account.</Text>
          </View>

          {currencyRows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No rewards yet</Text>
              <Text style={styles.body}>Share an eligible event or venue. When a friend books through your personal link, the reward appears here.</Text>
            </View>
          ) : currencyRows.map(([currency, total]) => (
            <View key={currency} style={styles.summaryCard}>
              <Text style={styles.currency}>{currency}</Text>
              <View style={styles.metricGrid}>
                <Metric label="On the way" value={money(total.onWayMinor, currency)} />
                <Metric label="Ready" value={money(total.readyMinor, currency)} />
                <Metric label="Paid" value={money(total.paidMinor, currency)} />
                <Metric label="Reversed" value={money(total.reversedMinor, currency)} />
              </View>
            </View>
          ))}

          <Section title="Your earning links" subtitle="Share again without hunting for the original experience.">
            {query.data.links.length === 0 ? <Text style={styles.body}>Eligible personal links will appear here.</Text> : query.data.links.map((link) => (
              <View key={link.memberId} style={styles.rowCard}>
                <View style={styles.rowGrow}>
                  <Text style={styles.rowTitle}>{link.brandName}</Text>
                  <Text style={styles.meta}>{link.offerName}</Text>
                </View>
                <Pressable onPress={() => {
                  void shareCanonicalFallback({
                    title: link.brandName,
                    message: `${link.brandName}\n${link.url}`,
                    url: link.url,
                  });
                  mixpanelService.track("referral_link_shared", { listing_kind: "wallet", surface: "explorer_wallet" });
                }} style={styles.secondary}><Text style={styles.secondaryText}>Share</Text></Pressable>
              </View>
            ))}
          </Section>

          <Section title="Reward activity" subtitle="Amounts shown are after Mingla’s 5% referral service fee. Your payout provider may deduct its own transfer fee.">
            {query.data.shares.length === 0 ? <Text style={styles.body}>No attributed purchases yet.</Text> : query.data.shares.map((share) => (
              <View key={share.id} style={styles.rowCard}>
                <View style={styles.rowGrow}>
                  <Text style={styles.rowTitle}>{share.listingName}</Text>
                  <Text style={styles.meta}>{humanStatus(share.status)} · {new Date(share.earnedAt).toLocaleDateString()}</Text>
                </View>
                <Text style={styles.amount}>{money(share.amountMinor, share.currency)}</Text>
              </View>
            ))}
          </Section>

          <Section title="Vouchers" subtitle="Host-funded rewards you can use on a future order.">
            {query.data.vouchers.length === 0 ? <Text style={styles.body}>No vouchers yet.</Text> : query.data.vouchers.map((voucher) => (
              <View key={voucher.id} style={styles.rowCard}>
                <View style={styles.rowGrow}><Text style={styles.rowTitle}>{voucher.brandName}</Text><Text style={styles.meta}>{voucher.status} · expires {new Date(voucher.expiresAt).toLocaleDateString()}</Text></View>
              </View>
            ))}
          </Section>

          <Section title="Perks" subtitle="Progress toward experience rewards from hosts.">
            {query.data.perks.length === 0 ? <Text style={styles.body}>No perk offers joined yet.</Text> : query.data.perks.map((perk) => (
              <View key={perk.offerId} style={styles.rowCard}>
                <View style={styles.rowGrow}><Text style={styles.rowTitle}>{perk.perkText}</Text><Text style={styles.meta}>{perk.brandName} · {perk.qualifiedSales}/{perk.threshold} eligible bookings{perk.unlocked ? " · Unlocked" : ""}</Text></View>
              </View>
            ))}
          </Section>

          <View style={styles.payoutCard}>
            <Text style={styles.rowTitle}>Payout account</Text>
            <Text style={styles.body}>Stripe: {query.data.payoutAccount.stripe.status} · Paystack: {query.data.payoutAccount.paystack.status}</Text>
            <Pressable onPress={() => setPayoutOpen(true)} style={styles.primary}><Text style={styles.primaryText}>Set up or update</Text></Pressable>
          </View>
        </ScrollView>
      )}
      <PayoutAccountSheet visible={payoutOpen} onClose={() => setPayoutOpen(false)} onSaved={() => void query.refetch()} />
    </View>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.meta}>{label}</Text></View>;
const Section: React.FC<{ title: string; subtitle: string; children: React.ReactNode }> = ({ title, subtitle, children }) => <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.meta}>{subtitle}</Text><View style={styles.list}>{children}</View></View>;
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#09090b" },
  topbar: { paddingTop: 58, paddingHorizontal: 18, paddingBottom: 14, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  back: { color: "#fb923c", fontWeight: "700", fontSize: 16 },
  topTitle: { color: "#fff", fontWeight: "800", fontSize: 17, textAlign: "center", flex: 1 },
  spacer: { width: 48 },
  content: { padding: 18, paddingBottom: 54, gap: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  hero: { paddingVertical: 10, gap: 7 },
  eyebrow: { color: "#fb923c", fontSize: 11, fontWeight: "800", letterSpacing: 1.1 },
  heroTitle: { color: "#fff", fontSize: 30, lineHeight: 35, fontWeight: "900" },
  body: { color: "rgba(255,255,255,0.67)", lineHeight: 20 },
  summaryCard: { padding: 17, borderRadius: 20, backgroundColor: "rgba(249,115,22,0.11)", borderWidth: 1, borderColor: "rgba(249,115,22,0.32)", gap: 12 },
  currency: { color: "#fb923c", fontWeight: "900" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  metric: { minWidth: "46%", flex: 1, padding: 12, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.055)" },
  metricValue: { color: "#fff", fontSize: 18, fontWeight: "900" },
  meta: { color: "rgba(255,255,255,0.52)", fontSize: 12, lineHeight: 17 },
  section: { padding: 17, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.045)", gap: 5 },
  sectionTitle: { color: "#fff", fontSize: 19, fontWeight: "900" },
  list: { marginTop: 8, gap: 8 },
  rowCard: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.07)" },
  rowGrow: { flex: 1 },
  rowTitle: { color: "#fff", fontWeight: "800", fontSize: 15 },
  amount: { color: "#fb923c", fontWeight: "900" },
  emptyCard: { padding: 20, borderRadius: 20, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.18)", gap: 7 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  payoutCard: { padding: 18, borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", gap: 10 },
  primary: { alignSelf: "flex-start", paddingHorizontal: 17, paddingVertical: 11, borderRadius: 999, backgroundColor: "#f97316" },
  primaryText: { color: "#fff", fontWeight: "800" },
  secondary: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: "rgba(249,115,22,0.45)" },
  secondaryText: { color: "#fb923c", fontWeight: "800" },
});
