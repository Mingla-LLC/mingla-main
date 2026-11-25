/**
 * #4490 spec 08 O5 part B — Late payments since close (close-late): money for
 * a closed day that landed after it was closed (a scan code paid late, say).
 * It is added to that day's late list and never into the closed snapshot; no
 * reopen is needed.
 */

import React from "react";
import { View } from "react-native";

import type { DaySummary } from "../../../services/venueDayCloseService";
import { formatCurrency } from "../../../utils/currency";
import { Banner } from "../../ui/Banner";
import { GlassCard } from "../../ui/GlassCard";
import { ListRow } from "../../ui/ListRow";
import { Pill } from "../../ui/Pill";
import { CLOSE_COPY } from "./dayCloseCopy";
import { dayLabel, latePaymentTitle, methodLabel } from "./dayCloseModel";

export function DayCloseLate({ summary }: { summary: DaySummary }): React.ReactElement | null {
  const late = summary.late;
  if (late.count === 0 && late.refundCount === 0) return null;
  const money = (minor: number): string => formatCurrency(minor, summary.currency, true);
  return (
    <View testID="day-close-late">
      <Banner tone="info" title={CLOSE_COPY.late} body={CLOSE_COPY.lateBody(dayLabel(summary.businessDate))} />
      <GlassCard padding={0}>
        {late.payments.map((p, i) => (
          <ListRow key={p.paymentId} divider={i > 0} icon="qr"
            title={`${latePaymentTitle(p)} · ${money(p.amountMinor + p.tipMinor)}`}
            subtitle={CLOSE_COPY.lateRow(methodLabel(p.method), p.paidAtLocal)}
            trailing={<Pill variant="info">{CLOSE_COPY.latePill}</Pill>} testID={`day-close-late-${p.paymentId}`} />
        ))}
        {late.refundCount > 0 ? (
          <ListRow divider={late.payments.length > 0} icon="refund" title={CLOSE_COPY.lateRefunds(money(late.refundMinor))} />
        ) : null}
      </GlassCard>
    </View>
  );
}
