import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { fetchEarningsSummary, type EarningsSummary } from "../../services/referralEarningsService";
import { creatorGigsService, type CreatorEarningsSummary, type EarningsRow } from "../../services/creatorGigsService";
import { payoutService } from "../../services/payoutService";
import { programErrorText } from "../../services/programResult";
import { shareCanonicalFallback } from "../../services/contentShareAdapter";
import { mixpanelService } from "../../services/mixpanelService";
import { formatMoney, formatShortDate, moneyStateWord, type MoneyState } from "../../utils/programFormat";
import { PROGRAM_COLORS as C, ProgramButton, ProgramCard, ProgramEmpty, ProgramLoadError, ProgramLoading, ProgramNotice, ProgramPill, ProgramRow, ProgramScreen, programStyles as s } from "../programs/ProgramUi";
import { Segmented } from "../programs/ProgramPickers";
import { Icon, type IconName } from "../ui/Icon";

type Filter = "all" | "gig" | "referral" | "local";

/** Referral share statuses → the three money words (reversed/expired rows are shown separately). */
const SHARE_STATE: Record<string, MoneyState | null> = {
  pending: "on_the_way", held_until_event: "on_the_way", accumulating: "on_the_way",
  releasable: "ready", failed: "ready", paid: "paid", reversed: null, unclaimed_expired: null,
};

const KIND_WORDS: Record<EarningsRow["kind"], { label: string; icon: IconName }> = {
  gig: { label: "Gig fee", icon: "videocam" },
  referral: { label: "Referral", icon: "gift-outline" },
  local: { label: "Local", icon: "map-pin" },
};

/** Referral shares as rows, for when the combined summary isn't available. */
function referralRows(summary: EarningsSummary | undefined): EarningsRow[] {
  return (summary?.shares ?? []).flatMap((share) => {
    const state = SHARE_STATE[share.status];
    return state ? [{ kind: "referral" as const, title: share.listingName, amount_minor: share.amountMinor, currency: share.currency, state, at: share.earnedAt }] : [];
  });
}

/**
 * #3872 — one Earnings screen for gig fees, referral rewards and Local pay.
 * Three words only: On the way · Ready · Paid. "Paid" appears only when the
 * server says the bank confirmed it. No provider names anywhere.
 */
export const EarningsWalletScreen: React.FC = () => {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const reportedUsedVoucher = useRef(false);
  const referrals = useQuery({ queryKey: ["earnings-wallet"], queryFn: fetchEarningsSummary });
  const combined = useQuery<CreatorEarningsSummary>({ queryKey: ["earnings-wallet", "combined"], queryFn: () => creatorGigsService.earningsSummary(), retry: 0 });
  const payout = useQuery({ queryKey: ["creator", "payout"], queryFn: () => payoutService.status(), retry: 0 });

  useEffect(() => { mixpanelService.track("wallet_viewed", { surface: "explorer" }); }, []);
  useEffect(() => {
    if (!reportedUsedVoucher.current && referrals.data?.vouchers.some((voucher) => voucher.status === "used")) {
      reportedUsedVoucher.current = true;
      mixpanelService.track("voucher_redeemed", { surface: "explorer_wallet" });
    }
  }, [referrals.data?.vouchers]);

  const rows = useMemo<EarningsRow[]>(() => {
    const all = combined.data?.rows ?? referralRows(referrals.data);
    return all.slice().sort((a, b) => b.at.localeCompare(a.at));
  }, [combined.data, referrals.data]);
  const currency = combined.data?.currency ?? rows[0]?.currency ?? Object.keys(referrals.data?.totals ?? {})[0] ?? "USD";
  const shown = filter === "all" ? rows : rows.filter((r) => r.kind === filter);
  const tile = (state: MoneyState): number => {
    if (filter === "all" && combined.data) {
      return state === "on_the_way" ? combined.data.on_the_way_minor : state === "ready" ? combined.data.ready_minor : combined.data.paid_minor;
    }
    return shown.filter((r) => r.state === state && r.currency === currency).reduce((sum, r) => sum + r.amount_minor, 0);
  };
  const reversed = (referrals.data?.shares ?? []).filter((x) => x.status === "reversed");

  const refresh = (): void => { void referrals.refetch(); void combined.refetch(); void payout.refetch(); };

  if (referrals.isLoading && combined.isLoading) return <ProgramScreen title="Earnings"><ProgramLoading /></ProgramScreen>;
  if (referrals.isError && combined.isError) return <ProgramScreen title="Earnings"><ProgramLoadError text={programErrorText(combined.error)} onRetry={refresh} /></ProgramScreen>;

  const showReferralExtras = filter === "all" || filter === "referral";
  const data = referrals.data;

  return <ProgramScreen title="Earnings" refreshing={referrals.isFetching || combined.isFetching} onRefresh={refresh}>
    <Segmented<Filter> value={filter} onChange={setFilter} options={[
      { value: "all", label: "All" }, { value: "gig", label: "Gigs" }, { value: "referral", label: "Referrals" }, { value: "local", label: "Local" },
    ]} />

    <View style={styles.tiles}>
      <Tile value={formatMoney(tile("on_the_way"), currency)} label="On the way" hint="Held until the work or event is done" />
      <Tile value={formatMoney(tile("ready"), currency)} label="Ready" hint="Released, heading to your bank" />
      <Tile value={formatMoney(tile("paid"), currency)} label="Paid" hint="Your bank confirmed it" />
    </View>

    {shown.length === 0 ? <ProgramEmpty title="Nothing here yet"
      text={filter === "gig" ? "Gig fees show here once a host hires you." : filter === "local" ? "Local pay shows here once a month’s review is approved." : "Share an event: when a friend books through your link, the reward shows here."} />
      : <ProgramCard>{shown.map((r, i) => <View key={`${r.kind}-${r.at}-${i}`} style={[styles.row, i < shown.length - 1 && styles.rowBorder]}>
        <View style={styles.icon}><Icon name={KIND_WORDS[r.kind].icon} size={16} color={C.accent} /></View>
        <View style={s.flex}>
          <Text style={s.strong} numberOfLines={1}>{r.title}</Text>
          <Text style={s.small}>{KIND_WORDS[r.kind].label} · {formatShortDate(r.at)}</Text>
        </View>
        <View style={styles.right}>
          <Text style={s.strong}>{formatMoney(r.amount_minor, r.currency)}</Text>
          <ProgramPill label={moneyStateWord(r.state)} tone={r.state === "paid" ? "success" : r.state === "ready" ? "accent" : "neutral"} />
        </View>
      </View>)}</ProgramCard>}
    {showReferralExtras && rows.some((r) => r.kind === "referral") ? <Text style={s.small}>Referral amounts are after Mingla’s 5% referral service fee.</Text> : null}
    {showReferralExtras && reversed.length ? <Text style={s.small}>{reversed.length} referral reward{reversed.length === 1 ? " was" : "s were"} removed after a refund.</Text> : null}

    {showReferralExtras && data ? <>
      {data.links.length ? <>
        <Text style={s.label}>Your earning links</Text>
        <ProgramCard>{data.links.map((link, i) => <View key={link.memberId} style={[styles.row, i < data.links.length - 1 && styles.rowBorder]}>
          <View style={s.flex}><Text style={s.strong}>{link.brandName}</Text><Text style={s.small}>{link.offerName}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Share ${link.brandName}`} style={styles.share} onPress={() => {
            void shareCanonicalFallback({ title: link.brandName, message: `${link.brandName}\n${link.url}`, url: link.url });
            mixpanelService.track("referral_link_shared", { listing_kind: "wallet", surface: "explorer_wallet" });
          }}><Icon name="share-outline" size={14} color={C.accent} /><Text style={s.accentText}>Share</Text></Pressable>
        </View>)}</ProgramCard>
      </> : null}
      {data.vouchers.length ? <>
        <Text style={s.label}>Vouchers</Text>
        <ProgramCard>{data.vouchers.map((v, i) => <ProgramRow key={v.id} title={v.brandName} subtitle={`${v.status === "used" ? "Used" : v.status === "expired" ? "Expired" : "Ready to use"} · until ${formatShortDate(v.expiresAt)}`} chevron={false} isLast={i === data.vouchers.length - 1} />)}</ProgramCard>
      </> : null}
      {data.perks.length ? <>
        <Text style={s.label}>Perks</Text>
        <ProgramCard>{data.perks.map((p, i) => <ProgramRow key={p.offerId} title={p.perkText} subtitle={`${p.brandName} · ${p.qualifiedSales} of ${p.threshold} bookings${p.unlocked ? " · Unlocked" : ""}`} chevron={false} isLast={i === data.perks.length - 1} />)}</ProgramCard>
      </> : null}
    </> : null}

    <ProgramCard>
      <ProgramRow icon="cash-outline" title="Payout account" subtitle={payout.data?.summary ?? (payout.isError ? "Couldn’t check right now" : "Checking…")}
        value={payout.data?.connected ? "Connected" : null} onPress={() => router.push("/payout" as never)} isLast />
    </ProgramCard>
    {payout.data && !payout.data.connected ? <ProgramButton label="Connect bank" onPress={() => router.push("/payout" as never)} /> : null}
    {combined.isError && !referrals.isError ? <ProgramNotice text="Gig and Local pay couldn’t load. Pull down to try again." /> : null}
    <Text style={s.small}>This is a record of what Mingla owes you, not a balance to withdraw. Mingla never shows money as paid until your bank confirms it.</Text>
  </ProgramScreen>;
};

const Tile: React.FC<{ value: string; label: string; hint: string }> = ({ value, label, hint }) => (
  <View style={styles.tile} accessibilityLabel={`${label}: ${value}. ${hint}`}>
    <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    <Text style={s.strong}>{label}</Text>
    <Text style={s.small}>{hint}</Text>
  </View>
);

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, padding: 12, borderRadius: 14, backgroundColor: C.field, borderWidth: 1, borderColor: C.border, gap: 2 },
  tileValue: { color: C.text, fontSize: 19, fontWeight: "900" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center" },
  right: { alignItems: "flex-end", gap: 4 },
  share: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: C.accentSoft },
});
