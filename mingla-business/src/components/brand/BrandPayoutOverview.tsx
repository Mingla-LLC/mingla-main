import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  color,
  radius,
  space,
  type,
} from "../../constants/designSystem";
import { useBrandPayoutScreen } from "../../hooks/useBrandPayoutScreen";
import { formatCurrency } from "../../utils/currency";
import {
  PAYOUT_STATE_COPY,
  type HostPayoutState,
  type PayoutScreenReleaseDTO,
} from "../../utils/payoutScreen";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { KpiTile } from "../ui/KpiTile";
import { DesktopColumns } from "../ui/DesktopCanvas";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

export interface BrandPayoutOverviewProps {
  brandId: string;
  onOpenPayout: (releaseId: string) => void;
  onOpenExplainer: () => void;
  onOpenBank: () => void;
  onOpenVerification: () => void;
  onContactSupport: () => void;
  onDisconnectBank?: () => void;
  onDownloadPayouts: () => void;
  /** Current payout account when it has not appeared on a release yet. */
  bankAccountLabel?: string | null;
  bankAccountVerified?: boolean;
  /** An account-level banner is already occupying the one-alert slot. */
  suppressAttention?: boolean;
}

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const stateTone = (state: HostPayoutState): { bg: string; fg: string } => {
  if (state === "paid") return { bg: color.successTint, fg: color.success };
  if (state === "couldnt_send") {
    return { bg: color.errorTint, fg: color.errorText };
  }
  if (["late_on_us", "waiting_for_bank", "needs_you"].includes(state)) {
    return { bg: color.warningTint, fg: color.warning };
  }
  if (state === "paused" || state === "cancelled") {
    return { bg: color.fill.tile, fg: color.text2 };
  }
  return { bg: color.infoTint, fg: color.info };
};

const amountFor = (release: PayoutScreenReleaseDTO): number =>
  release.hostState === "paid"
    ? release.cashToBankCents
    : release.netReleaseCents;

const rowTiming = (release: PayoutScreenReleaseDTO): string => {
  switch (release.hostState) {
    case "waiting_for_bank":
      return "Add a bank and it goes out in the next payout run";
    case "paid":
      return release.releasedAt === null
        ? PAYOUT_STATE_COPY.paid.detail
        : `Paid ${formatDate(release.releasedAt)}${release.bankMask === null ? "" : ` to ${release.bankMask}`}`;
    case "late_on_us":
      return `Was due ${formatDate(release.dueAt)}. ${PAYOUT_STATE_COPY.late_on_us.detail}`;
    case "scheduled":
      return `Pays out ${formatDate(release.dueAt)}, about a day after payment`;
    case "sending_today":
      return "Due now. It goes out in the next payout run";
    case "on_its_way":
      return `Sent${release.bankMask === null ? "" : ` to ${release.bankMask}`}. Usually arrives in minutes, sometimes up to 1 business day`;
    default:
      return PAYOUT_STATE_COPY[release.hostState].detail;
  }
};

const PayoutRow: React.FC<{
  release: PayoutScreenReleaseDTO;
  onPress: () => void;
}> = ({ release, onPress }) => {
  const copy = PAYOUT_STATE_COPY[release.hostState];
  const tone = stateTone(release.hostState);
  const timing = rowTiming(release);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${release.offeringName}, ${copy.label}, ${formatCurrency(amountFor(release), release.currency, true)}`}
      accessibilityHint="Opens this payout's sales and fee breakdown"
      style={({ pressed }) => [styles.payoutRow, pressed ? styles.pressed : null]}
    >
      <View style={[styles.stateDot, { backgroundColor: tone.bg }]}>
        <Icon
          name={release.hostState === "paid" ? "check" : release.hostState === "on_its_way" ? "send" : "clock"}
          size={16}
          color={tone.fg}
        />
      </View>
      <View style={styles.payoutText}>
        <Text style={styles.payoutTitle} numberOfLines={1}>{release.offeringName}</Text>
        <Text style={styles.payoutMeta} numberOfLines={2}>
          {release.salesCount} {release.salesCount === 1 ? "sale" : "sales"}
          {release.lastSaleAt === null ? "" : ` · sold ${formatDate(release.lastSaleAt)}`}
        </Text>
        <Text style={styles.payoutTiming} numberOfLines={2}>{timing}</Text>
        {release.olderPricing ? (
          <Text style={styles.olderPricing}>Older pricing</Text>
        ) : null}
      </View>
      <View style={styles.amountCol}>
        <Text style={styles.amount} numberOfLines={1}>
          {formatCurrency(amountFor(release), release.currency, true)}
        </Text>
        <View style={[styles.statePill, { backgroundColor: tone.bg }]}>
          <Text style={[styles.statePillText, { color: tone.fg }]}>{copy.label}</Text>
        </View>
      </View>
      <Icon name="chevR" size={18} color={color.text3} />
    </Pressable>
  );
};

export const BrandPayoutOverview: React.FC<BrandPayoutOverviewProps> = ({
  brandId,
  onOpenPayout,
  onOpenExplainer,
  onOpenBank,
  onOpenVerification,
  onContactSupport,
  onDisconnectBank,
  onDownloadPayouts,
  bankAccountLabel = null,
  bankAccountVerified,
  suppressAttention = false,
}) => {
  const query = useBrandPayoutScreen(brandId);
  const { isWideDesktop } = useResponsiveLayout();
  const data = query.data ?? null;
  const unpaid = useMemo(
    () => [...(data?.releases.filter((release) =>
      release.hostState !== "paid" && release.hostState !== "cancelled"
    ) ?? [])]
      .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt)),
    [data],
  );
  const next = unpaid[0] ?? null;
  const attention = useMemo(() => {
    const priority: HostPayoutState[] = [
      "paused", "waiting_for_bank", "couldnt_send", "needs_you",
    ];
    for (const state of priority) {
      const match = unpaid.find((release) => release.hostState === state);
      if (match !== undefined) return { kind: "state" as const, release: match };
    }
    const debt = unpaid.find((release) =>
      release.permanentDebtWithheldCents + release.temporaryDebtWithheldCents > 0
    );
    if (debt !== undefined) return { kind: "debt" as const, release: debt };
    const late = unpaid.find((release) => release.hostState === "late_on_us");
    return late === undefined ? null : { kind: "state" as const, release: late };
  }, [unpaid]);
  const shownAttention = suppressAttention ? null : attention;
  const currency = data?.currency ?? data?.releases[0]?.currency ?? null;

  if (query.isLoading) {
    return (
      <View style={styles.container} testID="payout-overview-loading">
        <View style={[styles.loadingBlock, styles.loadingHero]} />
        <View style={[styles.loadingBlock, styles.loadingRow]} />
      </View>
    );
  }
  if (query.isError) {
    return (
      <GlassCard variant="base" padding={space[6]}>
        <Text style={styles.title}>Couldn’t load payouts</Text>
        <Text style={styles.body}>Your money data is safe. Check your connection and try again.</Text>
        <View style={styles.action}><Button label="Try again" onPress={() => void query.refetch()} variant="secondary" size="md" /></View>
      </GlassCard>
    );
  }

  const heroLabel = data?.payoutsPaused
    ? "PAYOUTS PAUSED"
    : next?.hostState === "waiting_for_bank"
      ? "WAITING FOR YOUR BANK"
      : "NEXT PAYOUT";
  const heroAmount = next === null ? 0 : amountFor(next);
  const latestBank = bankAccountLabel ??
    data?.releases.find((release) => release.bankMask !== null)?.bankMask ?? null;
  const hasSuccessfulPayout = data?.releases.some((release) => release.hostState === "paid") ?? false;
  const renderMoney = (cents: number): string => currency === null
    ? "—"
    : formatCurrency(cents, currency, true);

  const heroCard = (
    <GlassCard variant="elevated" padding={space[6]} style={styles.hero}>
      <Text style={styles.eyebrow}>{heroLabel}</Text>
      <Text style={styles.heroAmount}>
        {renderMoney(heroAmount)}
      </Text>
      {next !== null ? (
        <Text style={styles.nextDate}>
          {rowTiming(next)}
        </Text>
      ) : <Text style={styles.body}>New sales will appear here.</Text>}
    </GlassCard>
  );
  const kpiTiles = (
    <View style={[styles.kpis, isWideDesktop ? styles.kpisWideTiles : null]}>
      <KpiTile label="Coming to you" value={renderMoney(data?.comingToYouCents ?? 0)} sub="Sold, not sent yet" style={styles.kpi} />
      <KpiTile label="Paid this month" value={renderMoney(data?.paidThisMonthCents ?? 0)} sub="Reached your bank" style={styles.kpi} />
    </View>
  );
  const rateLine = (
    <Pressable onPress={onOpenExplainer} accessibilityRole="button" accessibilityLabel="How payouts work" style={styles.rateLine}>
      <Text style={styles.rateText}>Mingla keeps a flat 4.5%. Mingla pays card processing.</Text>
      <Text style={styles.learnText}>How payouts work</Text>
    </Pressable>
  );
  const payoutsList = (
    <>
      <View style={styles.headingRow}>
        <Text style={styles.eyebrow}>PAYOUTS</Text>
      </View>
      {(data?.releases.length ?? 0) === 0 ? (
        <GlassCard variant="base" padding={space[6]}>
          <Text style={styles.title}>No payouts yet</Text>
          <Text style={styles.body}>Your first payout will be scheduled about a day after a payment.</Text>
        </GlassCard>
      ) : (
        <GlassCard variant="base" padding={0}>
          {data?.releases.map((release, index) => (
            <View key={release.id} style={index > 0 ? styles.divider : null}>
              <PayoutRow release={release} onPress={() => onOpenPayout(release.id)} />
            </View>
          ))}
        </GlassCard>
      )}
    </>
  );
  const bankCard = latestBank !== null ? (
    <GlassCard variant="base" padding={space[4]}>
      <Text style={styles.title}>{latestBank}</Text>
      <Text style={styles.body}>{bankAccountVerified === true || hasSuccessfulPayout ? "Account verified" : "Account on file"}</Text>
      <View style={styles.bankActions}>
        <Button label="Change bank account" onPress={onOpenBank} variant="secondary" size="md" />
        {onDisconnectBank !== undefined ? (
          <Button label="Disconnect bank" onPress={onDisconnectBank} variant="ghost" size="md" />
        ) : null}
      </View>
    </GlassCard>
  ) : null;
  const csvButton = (
    <Button label="Download payouts CSV" onPress={onDownloadPayouts} variant="secondary" size="md" leadingIcon="chart" fullWidth />
  );

  return (
    <View style={styles.container} testID="payout-overview">
      {shownAttention !== null ? (
        <GlassCard
          variant="base"
          padding={space[4]}
          style={[
            styles.alertCard,
            shownAttention.kind === "state" && ["needs_you", "couldnt_send"].includes(shownAttention.release.hostState)
              ? styles.errorAlertCard
              : null,
          ]}
        >
          <Text style={styles.alertTitle}>{shownAttention.kind === "debt" ? "Refund after an earlier payout" : PAYOUT_STATE_COPY[shownAttention.release.hostState].label}</Text>
          <Text style={styles.body}>{shownAttention.kind === "debt"
            ? `${renderMoney(shownAttention.release.permanentDebtWithheldCents + shownAttention.release.temporaryDebtWithheldCents)} will come out of your next payout.`
            : PAYOUT_STATE_COPY[shownAttention.release.hostState].detail}</Text>
          {shownAttention.kind === "state" && (shownAttention.release.hostState === "waiting_for_bank" || shownAttention.release.hostState === "couldnt_send") ? (
            <View style={styles.action}><Button label={shownAttention.release.hostState === "waiting_for_bank" ? "Add a bank" : "Check bank details"} onPress={onOpenBank} variant="primary" size="md" /></View>
          ) : null}
          {shownAttention.kind === "state" && shownAttention.release.hostState === "needs_you" ? (
            <View style={styles.action}><Button label="Finish verification" onPress={onOpenVerification} variant="primary" size="md" /></View>
          ) : null}
          {shownAttention.kind === "state" && shownAttention.release.hostState === "paused" ? (
            <View style={styles.action}><Button label="Contact support" onPress={onContactSupport} variant="secondary" size="md" /></View>
          ) : null}
          {shownAttention.kind === "state" && shownAttention.release.hostState === "late_on_us" ? (
            <View style={styles.action}><Button label="Ask about this payout" onPress={onContactSupport} variant="secondary" size="md" /></View>
          ) : null}
        </GlassCard>
      ) : null}
      {/* #4420 — desktop: the next payout and both totals in one row, then
          payouts (8) beside the bank, CSV and fee line (4). Phone keeps the
          single column in the same order as before. */}
      <View style={isWideDesktop ? styles.kpisWide : styles.container}>
        <View style={isWideDesktop ? styles.heroWide : null}>{heroCard}</View>
        {kpiTiles}
      </View>
      {isWideDesktop ? (
        <DesktopColumns
          main={<View style={styles.container}>{payoutsList}</View>}
          aside={
            <View style={styles.container}>
              {bankCard}
              {csvButton}
              {rateLine}
            </View>
          }
        />
      ) : (
        <>
          {rateLine}
          {payoutsList}
          {bankCard}
          {csvButton}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: space[4] },
  loadingBlock: { width: "100%", borderRadius: 16, backgroundColor: color.fill.tile },
  loadingHero: { height: 132 },
  loadingRow: { height: 88 },
  hero: { borderWidth: 1, borderColor: color.line },
  alertCard: { borderWidth: 1, borderColor: color.line, backgroundColor: color.card },
  errorAlertCard: { borderColor: color.errorLine, backgroundColor: color.card },
  alertTitle: { fontSize: type.row.fontSize, lineHeight: type.row.lineHeight, fontWeight: "700", color: color.text1 },
  eyebrow: { fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, fontWeight: "700", letterSpacing: 1.2, color: color.text3 },
  heroAmount: { marginTop: space[1], fontSize: 34, lineHeight: 40, fontWeight: "800", color: color.text1 },
  title: { fontSize: type.h1.fontSize, lineHeight: type.h1.lineHeight, fontWeight: type.h1.fontWeight, color: color.text1 },
  body: { marginTop: space[1], fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, color: color.text2 },
  nextDate: { marginTop: space[2], fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, fontWeight: "700", color: color.text1 },
  action: { marginTop: space[4], alignSelf: "flex-start" },
  kpis: { flexDirection: "row", gap: space[2] },
  kpisWide: { flexDirection: "row", alignItems: "stretch", gap: space[4] },
  heroWide: { flex: 1.4, minWidth: 0 },
  kpisWideTiles: { flex: 2, minWidth: 0, gap: space[4] },
  kpi: { flex: 1 },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space[1] },
  // #4420 — the fee line is a quiet pane (the mockup), not a dashed box.
  rateLine: { minHeight: 44, paddingVertical: space[3], paddingHorizontal: space[4], borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line, backgroundColor: color.card, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: space[2] },
  rateText: { flex: 1, minWidth: 220, fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, color: color.text2 },
  learnText: { fontSize: type.btnSm.fontSize, lineHeight: type.btnSm.lineHeight, fontWeight: type.btnSm.fontWeight, color: color.text1 },
  payoutRow: { minHeight: 88, padding: space[4], flexDirection: "row", alignItems: "center", gap: space[2] },
  pressed: { backgroundColor: color.fill.tile },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  stateDot: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  payoutText: { flex: 1, minWidth: 0 },
  payoutTitle: { fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, fontWeight: "700", color: color.text1 },
  payoutMeta: { marginTop: 2, fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, color: color.text2 },
  payoutTiming: { marginTop: 2, fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, color: color.text3 },
  olderPricing: { marginTop: 2, fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, color: color.info },
  amountCol: { alignItems: "flex-end" },
  amount: { fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, fontWeight: "700", color: color.text1 },
  statePill: { alignSelf: "flex-end", marginTop: 3, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statePillText: { fontSize: 11, lineHeight: 14, fontWeight: "700" },
  bankActions: { marginTop: space[4], flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});

export default BrandPayoutOverview;
