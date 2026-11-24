/**
 * #4490 spec 08 O5 part B — Day closed (close-done): the closed snapshot as the
 * server stored it (late money is listed under it, never added in here) (who
 * closed it and when, takings, tips, cash counted and the difference in
 * words), the late list, Export (one row per payment), Print (the day-close
 * PDF) and Reopen this day (money rights, a fresh PIN on a Till device,
 * within 7 days). Earlier closes of the day stay listed.
 */

import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import type { DaySummary } from "../../../services/venueDayCloseService";
import { formatCurrency } from "../../../utils/currency";
import { Button } from "../../ui/Button";
import { GlassCard } from "../../ui/GlassCard";
import { KpiTile } from "../../ui/KpiTile";
import { ListRow } from "../../ui/ListRow";
import { CLOSE_COPY } from "./dayCloseCopy";
import { DayCloseLate } from "./DayCloseLate";
import { closedTileBasis, dayLabel, differenceWords, personName } from "./dayCloseModel";

export interface DayCloseDoneProps {
  summary: DaySummary;
  exporting: boolean;
  printing: boolean;
  onExport: () => void;
  onPrint: () => void;
  onReopen: () => void;
}

export function DayCloseDone({ summary, exporting, printing, onExport, onPrint, onReopen }: DayCloseDoneProps): React.ReactElement {
  const money = (minor: number): string => formatCurrency(minor, summary.currency, true);
  const close = summary.close;
  const diff = close?.differenceMinor ?? null;
  const words = diff === null ? null : differenceWords(diff, summary.currency);
  const { width } = useWindowDimensions();
  const tileStyle: StyleProp<ViewStyle> = [styles.tile, { flexBasis: closedTileBasis(width) }];
  return (
    <View style={styles.root} testID="day-close-done">
      <GlassCard>
        <View style={styles.head}>
          <Text style={styles.h1} accessibilityRole="header">{CLOSE_COPY.closed}</Text>
          <Text style={styles.sub}>
            {close?.closedAtLocal
              ? `${dayLabel(summary.businessDate)} · ${CLOSE_COPY.closedBy(close.closedAtLocal, personName(close.closedBy))}`
              : dayLabel(summary.businessDate)}
          </Text>
        </View>
        <View style={styles.tiles}>
          <KpiTile style={tileStyle} label={CLOSE_COPY.takings} wrapValue
            value={money(summary.totals.takings.amountMinor)} sub={CLOSE_COPY.payments(summary.totals.takings.count)}
            testID="day-close-done-takings" />
          <KpiTile style={tileStyle} label={CLOSE_COPY.tips} wrapValue value={money(summary.totals.takings.tipMinor)}
            testID="day-close-done-tips" />
          <KpiTile style={tileStyle} label={CLOSE_COPY.cashCounted} wrapValue
            value={close?.cashCountedMinor !== null && close?.cashCountedMinor !== undefined ? money(close.cashCountedMinor) : "--"}
            testID="day-close-done-cash" />
          <KpiTile style={tileStyle} label={CLOSE_COPY.difference} wrapValue
            value={words?.text ?? "--"} testID="day-close-done-difference" />
        </View>
      </GlassCard>
      <DayCloseLate summary={summary} />
      <View style={styles.actions}>
        <Button label={CLOSE_COPY.export} variant="secondary" leadingIcon="download" style={styles.grow} loading={exporting}
          disabled={exporting} onPress={onExport} testID="day-close-export" />
        <Button label={CLOSE_COPY.print} variant="secondary" leadingIcon="receipt" style={styles.grow} loading={printing}
          disabled={printing} onPress={onPrint} testID="day-close-print" />
        {close?.canReopen ? (
          <Button label={CLOSE_COPY.reopen} variant="secondary" style={styles.grow} onPress={onReopen} testID="day-close-reopen" />
        ) : null}
      </View>
      <Text style={styles.hint}>{CLOSE_COPY.reopenHint}</Text>
      {summary.history.length > 0 ? (
        <GlassCard padding={0} testID="day-close-history">
          <Text style={styles.cardTitle}>{CLOSE_COPY.history}</Text>
          {summary.history.map((h, i) => (
            <ListRow key={`${h.closedAtLocal ?? ""}-${i}`} divider={i > 0}
              title={CLOSE_COPY.historyRow(h.closedAtLocal ?? "--", h.reopenedAtLocal ?? "--", personName(h.reopenedBy), h.reason)}
              value={h.differenceMinor !== null ? differenceWords(h.differenceMinor, summary.currency).text : undefined} />
          ))}
        </GlassCard>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[4] },
  head: { gap: space[1], marginBottom: space[3] },
  h1: { ...type.h1, color: color.text1 },
  sub: { ...type.small, color: color.text2 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  tile: { flexGrow: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  grow: { flexGrow: 1 },
  hint: { ...type.caption, color: color.text3 },
  cardTitle: { ...type.label, color: color.text3, paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[1] },
});
