/**
 * #4490 spec 08 O5 part B — open checks block the close (close-day,
 * "blocked"): each blocking check offers Pay, Void and Move to tomorrow on one
 * row. Pay and Void open the Till's Open checks (the check is paid or voided
 * there, with its own rights and PIN rules); Move to tomorrow is done here.
 * A check waiting on a scan code is listed but never blocks: if the guest
 * pays later it lands as a late payment for the day.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import type { DayOpenCheck } from "../../../services/venueDayCloseService";
import { formatCurrency } from "../../../utils/currency";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { GlassCard } from "../../ui/GlassCard";
import { Pill } from "../../ui/Pill";
import { CLOSE_COPY } from "./dayCloseCopy";
import { ageLabel, personName } from "./dayCloseModel";
// #4490 08-O5 fix 5: an unnamed check reads "Check #<ref>" here and in the Till.
import { checkTitle } from "../till/checkLabel";

export interface DayCloseChecksProps {
  checks: readonly DayOpenCheck[];
  currency: string;
  busySaleId: string | null;
  onOpenInTill: () => void;
  onMove: (check: DayOpenCheck) => void;
  /** #4490 08-O5 fix 6: phone width (< 600). Each blocking check stacks its
   *  name on top and Pay, Void and Move to tomorrow underneath, so the name is
   *  never crushed to "Che…" beside the buttons. */
  stacked?: boolean;
}

export function DayCloseChecks({ checks, currency, busySaleId, onOpenInTill, onMove, stacked = false }: DayCloseChecksProps): React.ReactElement | null {
  const blocking = checks.filter((c) => c.blocks);
  const waiting = checks.filter((c) => !c.blocks && c.waitingForScan);
  if (blocking.length === 0 && waiting.length === 0) return null;
  return (
    <View style={styles.root} testID="day-close-checks">
      {blocking.length > 0 ? (
        <Banner tone="warning" title={CLOSE_COPY.checksOpen(blocking.length)} body={CLOSE_COPY.checksOpenBody}
          testID="day-close-blocked" />
      ) : null}
      {blocking.length > 0 ? (
        <GlassCard padding={0}>
          {blocking.map((c, i) => (
            <View key={c.saleId} style={[stacked ? styles.rowStacked : styles.row, i > 0 && styles.divider]} testID={`day-close-check-${c.saleId}`}>
              <View style={stacked ? styles.rowTextStacked : styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={stacked ? 2 : 1}>
                  {`${checkTitle({ id: c.saleId, label: c.label })} · ${formatCurrency(c.dueMinor, currency, true)}`}
                </Text>
                <Text style={styles.rowSub} numberOfLines={stacked ? 2 : 1}>{`${personName(c.server)} · ${ageLabel(c.ageMinutes)}`}</Text>
              </View>
              <View style={styles.actions}>
                <Button label={CLOSE_COPY.pay} variant="secondary" size="sm" onPress={onOpenInTill}
                  testID={`day-close-check-pay-${c.saleId}`} />
                <Button label={CLOSE_COPY.void} variant="secondary" size="sm" onPress={onOpenInTill}
                  testID={`day-close-check-void-${c.saleId}`} />
                <Button label={CLOSE_COPY.moveToTomorrow} variant="secondary" size="sm" loading={busySaleId === c.saleId}
                  disabled={busySaleId !== null} onPress={() => onMove(c)} testID={`day-close-check-move-${c.saleId}`} />
              </View>
            </View>
          ))}
        </GlassCard>
      ) : null}
      {waiting.length > 0 ? (
        <GlassCard padding={0} testID="day-close-waiting">
          {waiting.map((c, i) => (
            <View key={c.saleId} style={[styles.row, i > 0 && styles.divider]}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {`${checkTitle({ id: c.saleId, label: c.label })} · ${formatCurrency(c.dueMinor, currency, true)}`}
                </Text>
                <Text style={styles.rowSub}>{CLOSE_COPY.waitingForScanBody}</Text>
              </View>
              <Pill variant="info">{CLOSE_COPY.waitingForScan}</Pill>
            </View>
          ))}
        </GlassCard>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[3] },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3], padding: space[4] },
  rowStacked: { flexDirection: "column", alignItems: "stretch", gap: space[3], padding: space[4] },
  rowTextStacked: { alignSelf: "stretch", gap: space[1] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  rowText: { flexGrow: 1, flexShrink: 1, flexBasis: 200, gap: space[1] },
  rowTitle: { ...type.row, color: color.text1 },
  rowSub: { ...type.caption, color: color.text2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
