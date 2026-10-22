import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
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
  if (state === "paid") return { bg: semantic.successTint, fg: semantic.success };
  if (state === "couldnt_send") {
    return { bg: semantic.errorTint, fg: semantic.error };
  }
  if (["late_on_us", "waiting_for_bank", "needs_you"].includes(state)) {
    return { bg: semantic.warningTint, fg: semantic.warning };
  }
  if (state === "paused" || state === "cancelled") {
    return { bg: glass.tint.profileElevated, fg: textTokens.secondary };
  }
  return { bg: semantic.infoTint, fg: semantic.info };
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
      <Icon name="chevR" size={18} color={textTokens.tertiary} />
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
      <GlassCard variant="base" padding={spacing.lg}>
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

  return (
    <View style={styles.container} testID="payout-overview">
      {shownAttention !== null ? (
        <GlassCard
          variant="base"
          padding={spacing.md}
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
      <GlassCard variant="elevated" padding={spacing.lg} style={styles.hero}>
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

      <View style={styles.kpis}>
        <KpiTile label="Coming to you" value={renderMoney(data?.comingToYouCents ?? 0)} sub="Sold, not sent yet" style={styles.kpi} />
        <KpiTile label="Paid this month" value={renderMoney(data?.paidThisMonthCents ?? 0)} sub="Reached your bank" style={styles.kpi} />
      </View>

      <Pressable onPress={onOpenExplainer} accessibilityRole="button" accessibilityLabel="How payouts work" style={styles.rateLine}>
        <Text style={styles.rateText}>Mingla keeps a flat 4.5%. Mingla pays card processing.</Text>
        <Text style={styles.learnText}>How payouts work</Text>
      </Pressable>

      <View style={styles.headingRow}>
        <Text style={styles.eyebrow}>PAYOUTS</Text>
      </View>
      {(data?.releases.length ?? 0) === 0 ? (
        <GlassCard variant="base" padding={spacing.lg}>
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

      {latestBank !== null ? (
        <GlassCard variant="base" padding={spacing.md}>
          <Text style={styles.title}>{latestBank}</Text>
          <Text style={styles.body}>{bankAccountVerified === true || hasSuccessfulPayout ? "Account verified" : "Account on file"}</Text>
          <View style={styles.bankActions}>
            <Button label="Change bank account" onPress={onOpenBank} variant="secondary" size="md" />
            {onDisconnectBank !== undefined ? (
              <Button label="Disconnect bank" onPress={onDisconnectBank} variant="ghost" size="md" />
            ) : null}
          </View>
        </GlassCard>
      ) : null}

      <Button label="Download payouts CSV" onPress={onDownloadPayouts} variant="secondary" size="md" leadingIcon="chart" fullWidth />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  loadingBlock: { width: "100%", borderRadius: 16, backgroundColor: glass.tint.profileElevated },
  loadingHero: { height: 132 },
  loadingRow: { height: 88 },
  hero: { borderWidth: 1, borderColor: "rgba(244,114,182,0.28)" },
  alertCard: { borderWidth: 1, borderColor: "rgba(245,158,11,0.45)", backgroundColor: "#362811" },
  errorAlertCard: { borderColor: "rgba(239,68,68,0.5)", backgroundColor: "#35171B" },
  alertTitle: { fontSize: typography.bodyLg.fontSize, lineHeight: typography.bodyLg.lineHeight, fontWeight: "700", color: textTokens.primary },
  eyebrow: { fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700", letterSpacing: 1.2, color: textTokens.tertiary },
  heroAmount: { marginTop: spacing.xs, fontSize: 34, lineHeight: 40, fontWeight: "800", color: textTokens.primary },
  title: { fontSize: typography.h3.fontSize, lineHeight: typography.h3.lineHeight, fontWeight: typography.h3.fontWeight, color: textTokens.primary },
  body: { marginTop: spacing.xs, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.secondary },
  nextDate: { marginTop: spacing.sm, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, fontWeight: "700", color: textTokens.primary },
  action: { marginTop: spacing.md, alignSelf: "flex-start" },
  kpis: { flexDirection: "row", gap: spacing.sm },
  kpi: { flex: 1 },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xs },
  rateLine: { minHeight: 44, padding: spacing.sm, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.18)", flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  rateText: { flex: 1, minWidth: 220, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.secondary },
  learnText: { fontSize: typography.buttonMd.fontSize, lineHeight: typography.buttonMd.lineHeight, fontWeight: typography.buttonMd.fontWeight, color: accent.warm },
  payoutRow: { minHeight: 88, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pressed: { backgroundColor: glass.tint.profileElevated },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border.profileBase },
  stateDot: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  payoutText: { flex: 1, minWidth: 0 },
  payoutTitle: { fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, fontWeight: "700", color: textTokens.primary },
  payoutMeta: { marginTop: 2, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, color: textTokens.secondary },
  payoutTiming: { marginTop: 2, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, color: textTokens.tertiary },
  olderPricing: { marginTop: 2, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, color: semantic.info },
  amountCol: { alignItems: "flex-end" },
  amount: { fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, fontWeight: "700", color: textTokens.primary },
  statePill: { alignSelf: "flex-end", marginTop: 3, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statePillText: { fontSize: 11, lineHeight: 14, fontWeight: "700" },
  bankActions: { marginTop: spacing.md, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});

export default BrandPayoutOverview;
