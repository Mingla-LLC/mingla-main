/**
 * #4490 spec 08 O5 part B — Count the cash (close-count): one counted total
 * against what the drawer should hold (float + cash payments and cash tips +
 * cash at the door - cash refunds - paid outs, all the server's), the
 * difference in words, then Close the day. The client sends only the counted
 * total; the server works the difference out again and keeps the snapshot.
 *
 * Rendered inside Close the day's own sheet (one sheet at a time).
 */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";
import type { DaySummary } from "../../../services/venueDayCloseService";
import { formatCurrency } from "../../../utils/currency";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { KeyValue } from "../../ui/KeyValue";
import { MoneyField } from "../../ui/MoneyField";
import { SheetScrollLayout } from "../../ui/SheetScrollLayout";
import { CLOSE_COPY } from "./dayCloseCopy";
import { countPreview, differenceWords } from "./dayCloseModel";

export interface DayCloseCountProps {
  summary: DaySummary;
  busy: boolean;
  error: string | null;
  onAddPaidOut: () => void;
  onClose: (countedMinor: number) => void;
}

export function DayCloseCount({ summary, busy, error, onAddPaidOut, onClose }: DayCloseCountProps): React.ReactElement {
  const [counted, setCounted] = useState<number | null>(null);
  const cash = summary.totals.cash;
  const currency = summary.currency;
  const money = (minor: number): string => formatCurrency(minor, currency, true);
  const diff = countPreview(cash.expectedMinor, counted);
  const words = diff === null ? null : differenceWords(diff, currency);
  return (
    <SheetScrollLayout
      keyboardAware
      contentStyle={styles.body}
      footer={
        <Button label={CLOSE_COPY.closeDay} variant="primary" size="lg" fullWidth loading={busy}
          disabled={counted === null || busy} onPress={() => { if (counted !== null) onClose(counted); }} testID="day-close-confirm" />
      }
    >
      <View style={styles.card}>
        <KeyValue
          testID="day-close-expected"
          items={[
            { key: "float", label: CLOSE_COPY.float, value: money(cash.floatMinor) },
            { key: "cash", label: CLOSE_COPY.cashPayments, value: money(cash.cashPaymentsMinor) },
            { key: "tips", label: CLOSE_COPY.cashTips, value: money(cash.cashTipsMinor) },
            ...(cash.doorCashMinor > 0 ? [{ key: "door", label: CLOSE_COPY.doorCash, value: money(cash.doorCashMinor) }] : []),
            { key: "refunds", label: CLOSE_COPY.cashRefunds, value: `−${money(cash.cashRefundsMinor)}` },
            ...cash.paidOuts.map((p) => ({ key: p.id, label: `${CLOSE_COPY.paidOut} · ${p.note}`, value: `−${money(p.amountMinor)}` })),
            { key: "expected", label: CLOSE_COPY.expected, value: money(cash.expectedMinor), separator: true, total: true },
          ]}
        />
        <Button label={CLOSE_COPY.addPaidOut} variant="ghost" size="sm" leadingIcon="plus" onPress={onAddPaidOut}
          testID="day-close-count-paid-out" />
      </View>
      <MoneyField label={CLOSE_COPY.counted} valueMinor={counted} onChangeMinor={setCounted} currency={currency}
        placeholder={CLOSE_COPY.countedHint} accessibilityLabel={CLOSE_COPY.counted} testID="day-close-counted" />
      {words !== null ? (
        <View style={styles.diff} testID="day-close-difference">
          <Text style={styles.diffLabel}>{CLOSE_COPY.difference}</Text>
          <Text style={[styles.diffValue, words.tone === "ok" ? styles.ok : styles.warn]}>{words.text}</Text>
        </View>
      ) : null}
      {error !== null ? <Banner tone="danger" title={error} testID="day-close-count-error" /> : null}
    </SheetScrollLayout>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[4], paddingBottom: space[4], paddingHorizontal: space[1] },
  card: { gap: space[2], padding: space[4], borderRadius: radius.lg, backgroundColor: color.card2 },
  diff: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: space[4], borderRadius: radius.lg, backgroundColor: color.card2 },
  diffLabel: { ...type.row, color: color.text1 },
  diffValue: { ...type.stat },
  ok: { color: color.successText },
  warn: { color: color.warningText },
});
