import React, { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { captureDiscountEvent } from "../../analytics/discountAnalytics";
import { exportCsvText } from "../../utils/guestCsvExport";
import { Button } from "../ui/Button";

const loadDiscountService = () => import("../../services/discountService");
const DISCOUNT_QUERY_ROOT = "brand-discounts";

export interface DiscountReportViewProps {
  brandId: string;
  rank: number;
}
const escape = (value: unknown): string =>
  `"${String(value ?? "").replace(/"/g, '""')}"`;

export const DiscountReportView: React.FC<DiscountReportViewProps> = ({
  brandId,
  rank,
}) => {
  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
  const query = useQuery({
    queryKey: [DISCOUNT_QUERY_ROOT, "report", brandId, range.from, range.to],
    queryFn: async () =>
      (await loadDiscountService()).fetchDiscountReport(
        brandId,
        range.from,
        range.to,
      ),
  });
  const report = query.data;
  useEffect(() => {
    captureDiscountEvent("discount_report_viewed");
  }, []);
  const exportRows = async (): Promise<void> => {
    const rows = await (
      await loadDiscountService()
    ).fetchDiscountReportBuyers(brandId, range.from, range.to);
    const header = [
      "Order ID",
      "Buyer name",
      "Buyer email",
      "Buyer phone",
      "Paid cents",
      "Currency",
      "Created at",
    ];
    const csv = [
      header.map(escape).join(","),
      ...rows.map((row) =>
        [
          row.orderId,
          row.buyerName,
          row.buyerEmail,
          row.buyerPhone,
          row.paidCents,
          row.currency,
          row.createdAt,
        ]
          .map(escape)
          .join(","),
      ),
    ].join("\n");
    await exportCsvText(
      csv,
      `discount-buyers-${new Date().toISOString().slice(0, 10)}.csv`,
      `Export discount buyers`,
    );
  };
  if (query.isLoading) return <Text style={styles.state}>Loading report…</Text>;
  if (query.isError || !report)
    return (
      <View style={styles.stateBox}>
        <Text style={styles.state}>Couldn’t load the report.</Text>
        <Button
          label="Try again"
          onPress={() => void query.refetch()}
          variant="secondary"
        />
      </View>
    );
  return (
    <View style={styles.wrap}>
      <Text style={styles.caption}>
        Last 30 days · server-confirmed paid orders only
      </Text>
      <View style={styles.totals}>
        <Metric label="Orders" value={String(report.orders)} />
        <Metric
          label="Revenue"
          value={(report.revenueCents / 100).toFixed(2)}
        />
        <Metric
          label="Given away"
          value={(report.amountGivenAwayCents / 100).toFixed(2)}
        />
        <Metric label="New buyers" value={`${report.firstTimeBuyerPercent}%`} />
      </View>
      <View style={styles.table}>
        <Text style={styles.heading}>By discount</Text>
        {report.discounts.map((row) => (
          <View key={row.discountId} style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.name}>{row.name}</Text>
              <Text style={styles.sub}>{row.orders} orders</Text>
            </View>
            <Text style={styles.amount}>
              −{(row.amountGivenAwayCents / 100).toFixed(2)}
            </Text>
          </View>
        ))}
        {report.discounts.length === 0 ? (
          <Text style={styles.state}>No discounted orders in this period.</Text>
        ) : null}
      </View>
      {rank >= 40 ? (
        <Button
          label="Export buyer CSV"
          leadingIcon="download"
          onPress={() => void exportRows()}
          variant="secondary"
        />
      ) : (
        <Text style={styles.caption}>
          Buyer contact export requires an event manager, admin or owner.
        </Text>
      )}
    </View>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <View style={styles.metric}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.sub}>{label}</Text>
  </View>
);
const styles = StyleSheet.create({
  wrap: { padding: spacing.md, gap: spacing.md },
  caption: { color: textTokens.secondary, fontSize: 12, lineHeight: 18 },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: {
    minWidth: 130,
    flexGrow: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
  },
  metricValue: { color: textTokens.primary, fontSize: 22, fontWeight: "800" },
  table: {
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
    padding: spacing.md,
    gap: spacing.xs,
  },
  heading: {
    fontSize: 15,
    fontWeight: "800",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  rowCopy: { flex: 1 },
  name: { color: textTokens.primary, fontWeight: "700" },
  sub: { color: textTokens.secondary, fontSize: 12, marginTop: 2 },
  amount: { color: textTokens.primary, fontWeight: "800" },
  state: {
    padding: spacing.lg,
    color: textTokens.secondary,
    textAlign: "center",
  },
  stateBox: { padding: spacing.lg, gap: spacing.sm, alignItems: "center" },
});
