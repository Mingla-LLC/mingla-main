import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useSafeAreaInsets } from "react-native-safe-area-context";


import { useBrandPayoutScreen } from "../../hooks/useBrandPayoutScreen";
import type { Brand } from "../../store/currentBrandStore";
import { formatCurrency } from "../../utils/currency";
import { exportCsvText } from "../../utils/guestCsvExport";
import type { PayoutScreenReleaseDTO } from "../../utils/payoutScreen";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { IconChrome } from "../ui/IconChrome";
import { Segmented } from "../ui/Pill";
import { DesktopColumns } from "../ui/DesktopCanvas";
import { TopBar } from "../ui/TopBar";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

import {
  color,
  space,
  type,
} from "../../constants/designSystem";
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

const MoneyLine: React.FC<{ label: string; value: string; total?: boolean }> = ({ label, value, total = false }) => (
  <View style={[styles.moneyLine, total ? styles.totalLine : null]}>
    <Text style={[styles.moneyLabel, total ? styles.totalText : null]}>{label}</Text>
    <Text style={[styles.moneyValue, total ? styles.totalText : null]}>{value}</Text>
  </View>
);

export interface BrandFinanceReportsViewProps { brand: Brand | null; onBack: () => void }

export const BrandFinanceReportsView: React.FC<BrandFinanceReportsViewProps> = ({ brand, onBack }) => {
  const insets = useSafeAreaInsets();
  const { isWideDesktop } = useResponsiveLayout();
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
    await exportCsvText(
      rowsToCsv(releases),
      `${brand?.displayName ?? "mingla"}-payouts.csv`,
      "Export payouts",
    );
  }, [brand?.displayName, releases]);

  if (brand === null) {
    return <View style={styles.host}><TopBar leftKind="back" title="Finance" onBack={onBack} rightSlot={<View />} /><View style={styles.scroll}><GlassCard variant="base" padding={space[6]}><Text style={styles.title}>Brand not found</Text><Text style={styles.body}>Go back and choose another brand.</Text></GlassCard></View></View>;
  }

  const heroCard = (
    <GlassCard variant="elevated" padding={space[6]}>
      <Text style={styles.eyebrow}>YOU GET · {PERIOD_LABEL[period].toUpperCase()}</Text>
      <Text style={styles.hero}>{money(summary.host)}</Text>
      <Text style={styles.body}>From the payout ledger in {currency?.toUpperCase()}.</Text>
    </GlassCard>
  );
  const breakdown = (
    <GlassCard variant="base" padding={space[4]}>
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
  );
  const payouts = (
    <>
      <Text style={styles.eyebrow}>PAYOUTS</Text>
      <GlassCard variant="base" padding={0}>
        {releases.map((row, index) => <View key={row.id} style={[styles.reportRow, index > 0 ? styles.rowDivider : null]}><View style={styles.reportText}><Text style={styles.reportTitle}>{row.offeringName}</Text><Text style={styles.body}>{row.salesCount} {row.salesCount === 1 ? "sale" : "sales"} · {row.hostState.replaceAll("_", " ")}</Text></View><Text style={styles.reportAmount}>{money(row.netReleaseCents)}</Text></View>)}
      </GlassCard>
    </>
  );
  const exportsCard = (
    <>
      <Text style={styles.eyebrow}>EXPORTS</Text>
      <GlassCard variant="base" padding={space[4]}>
        <Button label="Payouts CSV" onPress={() => void exportRows()} variant="secondary" size="md" fullWidth leadingIcon="download" />
      </GlassCard>
    </>
  );
  const hasRows = releases.length > 0;

  return (
    <View style={styles.host}>
      {/* #4420 — the header download was a dead icon; it now exports (the
          same CSV as the Exports card). Desktop names it, like the mockup. */}
      <TopBar
        leftKind="back"
        title="Finance"
        onBack={onBack}
        rightSlot={
          isWideDesktop ? (
            <Button label="Payouts CSV" onPress={() => void exportRows()} variant="secondary" size="sm" leadingIcon="download" />
          ) : (
            <IconChrome icon="download" onPress={() => void exportRows()} accessibilityLabel="Export payouts CSV" />
          )
        }
      />
      <ScrollView contentContainerStyle={[styles.scroll, isWideDesktop ? styles.scrollDesktop : null, { paddingBottom: space[7] + insets.bottom }]}>
        <Segmented<TimeRange>
          options={PERIODS.map((value) => ({ key: value, label: PERIOD_LABEL[value] }))}
          value={period}
          onChange={setPeriod}
          full={!isWideDesktop}
          accessibilityLabel="Finance report period"
          style={isWideDesktop ? styles.periodsDesktop : null}
        />

        {query.isLoading ? <GlassCard variant="base" padding={space[6]}><Text style={styles.title}>Loading finance data…</Text></GlassCard> : null}
        {query.isError ? <GlassCard variant="base" padding={space[6]}><Text style={styles.title}>Couldn’t load finance data</Text><Text style={styles.body}>No totals are shown until the payout ledger answers.</Text><View style={styles.action}><Button label="Try again" onPress={() => void query.refetch()} variant="secondary" size="md" /></View></GlassCard> : null}
        {!query.isLoading && !query.isError && !hasRows ? <GlassCard variant="base" padding={space[6]}><Text style={styles.title}>No payout data in this period</Text><Text style={styles.body}>Choose another period or check back after a sale.</Text></GlassCard> : null}

        {/* #4420 — desktop (T3 8/4): total and payouts left, the money
            breakdown and exports right. Phone keeps the single column. */}
        {isWideDesktop ? (
          <DesktopColumns
            main={<View style={styles.col}>{hasRows ? <>{heroCard}{payouts}</> : null}</View>}
            aside={<View style={styles.col}>{hasRows ? breakdown : null}{exportsCard}</View>}
          />
        ) : (
          <>
            {hasRows ? <>{heroCard}{breakdown}{payouts}</> : null}
            {exportsCard}
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 }, scroll: { padding: space[4], gap: space[4] }, scrollDesktop: { paddingHorizontal: space[6] },
  periodsDesktop: { alignSelf: "flex-start" }, col: { gap: space[4] },
  title: { fontSize: type.h1.fontSize, lineHeight: type.h1.lineHeight, fontWeight: type.h1.fontWeight, color: color.text1 }, body: { marginTop: space[1], fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, color: color.text2 }, action: { marginTop: space[4], alignSelf: "flex-start" },
  eyebrow: { fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, fontWeight: "700", letterSpacing: 1.2, color: color.text3 }, hero: { marginTop: space[1], fontSize: 34, lineHeight: 40, fontWeight: "800", color: color.text1 },
  moneyLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space[4], paddingVertical: space[2] }, moneyLabel: { flex: 1, fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, color: color.text2 }, moneyValue: { fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, color: color.text1, textAlign: "right" },
  totalLine: { marginTop: space[1], paddingTop: space[4], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line }, totalText: { fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, fontWeight: "800", color: color.text1 },
  reportRow: { flexDirection: "row", alignItems: "center", gap: space[4], padding: space[4] }, rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line }, reportText: { flex: 1 }, reportTitle: { fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, fontWeight: "700", color: color.text1 }, reportAmount: { fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, fontWeight: "700", color: color.text1 },
});

export default BrandFinanceReportsView;
