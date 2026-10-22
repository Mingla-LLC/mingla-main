import React, { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { accent, glass, spacing, text as textTokens, typography } from "../../constants/designSystem";
import { useBrandPayoutScreen } from "../../hooks/useBrandPayoutScreen";
import type { Brand } from "../../store/currentBrandStore";
import { formatCurrency } from "../../utils/currency";
import type { PayoutScreenReleaseDTO } from "../../utils/payoutScreen";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { TopBar } from "../ui/TopBar";

type TimeRange = "7d" | "30d" | "90d" | "ytd" | "all";
const PERIODS: TimeRange[] = ["7d", "30d", "90d", "ytd", "all"];
const PERIOD_LABEL: Record<TimeRange, string> = { "7d": "7d", "30d": "30d", "90d": "90d", ytd: "YTD", all: "All" };

const cutoffFor = (period: TimeRange): number => {
  if (period === "all") return 0;
  if (period === "ytd") return new Date(new Date().getFullYear(), 0, 1).getTime();
  return Date.now() - Number.parseInt(period, 10) * 86_400_000;
};

const escapeCsv = (value: unknown): string => `"${String(value ?? "").replaceAll('"', '""')}"`;
const rowsToCsv = (rows: readonly PayoutScreenReleaseDTO[]): string => [
  ["payout_id", "offering", "provider", "currency", "status", "due_at", "paid_at", "buyers_paid_cents", "refunds_cents", "disputes_cents", "mingla_fee_cents", "earlier_refund_withheld_cents", "maturity_recredit_cents", "host_gets_cents", "bank_transfer_fee_cents", "stamp_duty_cents", "transfer_fee_credit_owed_cents", "sent_to_bank_cents"],
  ...rows.map((row) => [row.id, row.offeringName, row.provider, row.currency, row.hostState, row.dueAt, row.releasedAt ?? "", row.grossCents, row.refundedCents, row.disputedCents, row.minglaFeeCents, row.permanentDebtWithheldCents + row.temporaryDebtWithheldCents, row.maturityRecreditCents, row.netReleaseCents, row.transferFeeCents, row.stampDutyCents, row.transferFeeCreditCents, row.cashToBankCents]),
].map((row) => row.map(escapeCsv).join(",")).join("\n");

const downloadCsv = async (filename: string, csv: string): Promise<void> => {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return;
  }
  await Share.share({ title: filename, message: csv });
};

const MoneyLine: React.FC<{ label: string; value: string; total?: boolean }> = ({ label, value, total = false }) => (
  <View style={[styles.moneyLine, total ? styles.totalLine : null]}>
    <Text style={[styles.moneyLabel, total ? styles.totalText : null]}>{label}</Text>
    <Text style={[styles.moneyValue, total ? styles.totalText : null]}>{value}</Text>
  </View>
);

export interface BrandFinanceReportsViewProps { brand: Brand | null; onBack: () => void }

export const BrandFinanceReportsView: React.FC<BrandFinanceReportsViewProps> = ({ brand, onBack }) => {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<TimeRange>("30d");
  const query = useBrandPayoutScreen(brand?.id ?? null);
  const releases = useMemo(() => {
    const cutoff = cutoffFor(period);
    return (query.data?.releases ?? []).filter((row) => new Date(row.lastSaleAt ?? row.dueAt).getTime() >= cutoff);
  }, [period, query.data?.releases]);
  const summary = useMemo(() => releases.reduce((sum, row) => ({
    gross: sum.gross + row.grossCents,
    refunds: sum.refunds + row.refundedCents,
    disputes: sum.disputes + row.disputedCents,
    fee: sum.fee + row.minglaFeeCents,
    debt: sum.debt + row.permanentDebtWithheldCents + row.temporaryDebtWithheldCents,
    recredit: sum.recredit + row.maturityRecreditCents,
    bankFee: sum.bankFee + row.transferFeeCents,
    stampDuty: sum.stampDuty + row.stampDutyCents,
    creditsOwed: sum.creditsOwed + row.transferFeeCreditCents,
    host: sum.host + row.netReleaseCents,
    paid: sum.paid + (row.hostState === "paid" ? row.cashToBankCents : 0),
  }), { gross: 0, refunds: 0, disputes: 0, fee: 0, debt: 0, recredit: 0, bankFee: 0, stampDuty: 0, creditsOwed: 0, host: 0, paid: 0 }), [releases]);
  const hasStripe = releases.some((row) => row.provider === "stripe");
  const currency = query.data?.currency ?? brand?.defaultCurrency ?? null;
  const money = (cents: number): string => currency === null ? "—" : formatCurrency(cents, currency, true);
  const exportRows = useCallback(async (): Promise<void> => {
    await downloadCsv(`${brand?.displayName ?? "mingla"}-payouts.csv`, rowsToCsv(releases));
  }, [brand?.displayName, releases]);

  if (brand === null) {
    return <View style={styles.host}><TopBar leftKind="back" title="Finance" onBack={onBack} rightSlot={<View />} /><View style={styles.scroll}><GlassCard variant="base" padding={spacing.lg}><Text style={styles.title}>Brand not found</Text><Text style={styles.body}>Go back and choose another brand.</Text></GlassCard></View></View>;
  }

  return (
    <View style={styles.host}>
      <TopBar leftKind="back" title="Finance" onBack={onBack} rightSlot={<Icon name="download" size={20} color={textTokens.primary} />} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: spacing.xl + insets.bottom }]}>
        <View style={styles.periods}>
          {PERIODS.map((value) => <Pressable key={value} onPress={() => setPeriod(value)} accessibilityRole="button" accessibilityState={{ selected: period === value }} style={[styles.period, period === value ? styles.periodSelected : null]}><Text style={styles.periodText}>{PERIOD_LABEL[value]}</Text></Pressable>)}
        </View>

        {query.isLoading ? <GlassCard variant="base" padding={spacing.lg}><Text style={styles.title}>Loading finance data…</Text></GlassCard> : null}
        {query.isError ? <GlassCard variant="base" padding={spacing.lg}><Text style={styles.title}>Couldn’t load finance data</Text><Text style={styles.body}>No totals are shown until the payout ledger answers.</Text><View style={styles.action}><Button label="Try again" onPress={() => void query.refetch()} variant="secondary" size="md" /></View></GlassCard> : null}
        {!query.isLoading && !query.isError && releases.length === 0 ? <GlassCard variant="base" padding={spacing.lg}><Text style={styles.title}>No payout data in this period</Text><Text style={styles.body}>Choose another period or check back after a sale.</Text></GlassCard> : null}

        {releases.length > 0 ? <>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.eyebrow}>YOU GET · {PERIOD_LABEL[period].toUpperCase()}</Text>
            <Text style={styles.hero}>{money(summary.host)}</Text>
            <Text style={styles.body}>From the payout ledger in {currency?.toUpperCase()}.</Text>
          </GlassCard>
          <GlassCard variant="base" padding={spacing.md}>
            <MoneyLine label="Buyers paid" value={money(summary.gross)} />
            {summary.refunds > 0 ? <MoneyLine label="Refunds" value={`−${money(summary.refunds)}`} /> : null}
            {summary.disputes > 0 ? <MoneyLine label="Disputes" value={`−${money(summary.disputes)}`} /> : null}
            {summary.debt > 0 ? <MoneyLine label="Refund after an earlier payout" value={`−${money(summary.debt)}`} /> : null}
            <MoneyLine label="Mingla fee" value={`−${money(summary.fee)}`} />
            {summary.recredit > 0 ? <MoneyLine label="Returned from an earlier hold" value={`+${money(summary.recredit)}`} /> : null}
            <MoneyLine label="Card processing" value="Mingla pays" />
            {hasStripe ? <MoneyLine label="Stripe automatic-tax fee (~0.5%)" value="Paid by you" /> : null}
            <MoneyLine label="You get" value={money(summary.host)} total />
            {summary.bankFee > 0 ? <MoneyLine label="Bank transfer fee" value={`−${money(summary.bankFee)}`} /> : null}
            {summary.stampDuty > 0 ? <MoneyLine label="Stamp duty" value={`−${money(summary.stampDuty)}`} /> : null}
            <MoneyLine label="Paid to bank" value={money(summary.paid)} />
            {summary.creditsOwed > 0 ? <MoneyLine label="Mingla owes back" value={money(summary.creditsOwed)} /> : null}
          </GlassCard>
          <Text style={styles.eyebrow}>PAYOUTS</Text>
          <GlassCard variant="base" padding={0}>
            {releases.map((row, index) => <View key={row.id} style={[styles.reportRow, index > 0 ? styles.rowDivider : null]}><View style={styles.reportText}><Text style={styles.reportTitle}>{row.offeringName}</Text><Text style={styles.body}>{row.salesCount} {row.salesCount === 1 ? "sale" : "sales"} · {row.hostState.replaceAll("_", " ")}</Text></View><Text style={styles.reportAmount}>{money(row.netReleaseCents)}</Text></View>)}
          </GlassCard>
        </> : null}

        <Text style={styles.eyebrow}>EXPORTS</Text>
        <GlassCard variant="base" padding={spacing.md}>
          <Button label="Payouts CSV" onPress={() => void exportRows()} variant="secondary" size="md" fullWidth leadingIcon="download" />
        </GlassCard>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 }, scroll: { padding: spacing.md, gap: spacing.md }, periods: { flexDirection: "row", gap: 6 },
  period: { flex: 1, minHeight: 38, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  periodSelected: { borderColor: accent.border, backgroundColor: accent.tint }, periodText: { fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700", color: textTokens.primary },
  title: { fontSize: typography.h3.fontSize, lineHeight: typography.h3.lineHeight, fontWeight: typography.h3.fontWeight, color: textTokens.primary }, body: { marginTop: spacing.xs, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.secondary }, action: { marginTop: spacing.md, alignSelf: "flex-start" },
  eyebrow: { fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700", letterSpacing: 1.2, color: textTokens.tertiary }, hero: { marginTop: spacing.xs, fontSize: 34, lineHeight: 40, fontWeight: "800", color: textTokens.primary },
  moneyLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.md, paddingVertical: spacing.sm }, moneyLabel: { flex: 1, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.secondary }, moneyValue: { fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.primary, textAlign: "right" },
  totalLine: { marginTop: spacing.xs, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border.profileBase }, totalText: { fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, fontWeight: "800", color: textTokens.primary },
  reportRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md }, rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border.profileBase }, reportText: { flex: 1 }, reportTitle: { fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, fontWeight: "700", color: textTokens.primary }, reportAmount: { fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, fontWeight: "700", color: textTokens.primary },
});

export default BrandFinanceReportsView;
