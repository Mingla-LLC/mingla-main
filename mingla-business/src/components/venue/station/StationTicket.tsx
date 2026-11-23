/**
 * #4490 spec 08 O3 — one ticket on a kitchen or bar board: ticket number,
 * table or pickup code, age timer (danger past the venue's target minutes),
 * this station's lines with choices and notes, who sent it, and the action for
 * its column: Accept (New), a tick per line + Ready (Cooking), Picked up and
 * Recall to cooking (Ready); Print on Cooking and Ready. A voided line is
 * struck through with who voided it; a voided ticket says so and has no action.
 * A New ticket flashes (a white ring, held still with reduced motion).
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, size, space, type } from "../../../constants/designSystem";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Pill } from "../../ui/Pill";
import { STATION_COPY } from "./stationCopy";
import { ageLabel, columnOf, isLate, ticketSender, venueTime, type StationName, type StationTicket } from "./stationModel";

export interface StationTicketCardProps {
  ticket: StationTicket;
  ageSeconds: number;
  targets: Record<StationName, number>;
  timezone: string | null;
  /** The New ring is drawn (flash phase, or always with reduced motion). */
  ringOn: boolean;
  /** This ticket has an action in flight (buttons disabled, spinner on it). */
  busy: boolean;
  printing: boolean;
  onAccept: () => void;
  onItemReady: (itemId: string) => void;
  onReady: () => void;
  onPickedUp: () => void;
  onRecall: () => void;
  onPrint: () => void;
}

export function StationTicketCard({
  ticket,
  ageSeconds,
  targets,
  timezone,
  ringOn,
  busy,
  printing,
  onAccept,
  onItemReady,
  onReady,
  onPickedUp,
  onRecall,
  onPrint,
}: StationTicketCardProps): React.ReactElement {
  const column = columnOf(ticket);
  const voided = ticket.state === "voided";
  const late = isLate(ticket, ageSeconds, targets);
  const isNew = ticket.state === "new";
  const readyTime = ticket.readyAt !== null ? venueTime(ticket.readyAt, timezone) : null;
  const sender = ticketSender(ticket, STATION_COPY.guestOrder);
  const caption = [
    sender,
    isNew ? STATION_COPY.isNew : null,
    ticket.state === "ready"
      ? ticket.guestOrder
        ? STATION_COPY.guestTold
        : ticket.tellName !== null ? STATION_COPY.told(ticket.tellName) : null
      : null,
  ].filter((part): part is string => part !== null).join(" · ");
  const voidedLine = ticket.lines.find((l) => l.voided && l.voidedByName !== null) ?? ticket.lines.find((l) => l.voided);
  const print = (
    <Button
      label={STATION_COPY.print}
      variant="secondary"
      size="md"
      leadingIcon="receipt"
      loading={printing}
      disabled={busy || printing}
      accessibilityLabel={STATION_COPY.printTicket}
      onPress={onPrint}
      testID={`station-print-${ticket.orderId}-${ticket.station}`}
    />
  );

  return (
    <View
      style={[styles.card, isNew && ringOn && styles.ring, voided && styles.voided]}
      testID={`station-ticket-${ticket.orderId}-${ticket.station}`}
      accessibilityLabel={`${ticket.destination}, ${column}`}
    >
      <View style={styles.head}>
        <View style={styles.headText}>
          <View style={styles.numberRow}>
            <Text style={styles.number}>{`#${ticket.ticketNo}`}</Text>
            {ticket.printedCount > 0 ? <Pill variant="muted">{STATION_COPY.printed(ticket.printedCount)}</Pill> : null}
          </View>
          <Text style={[styles.destination, voided && styles.strike]} numberOfLines={2}>{ticket.destination}</Text>
          {ticket.movedFrom !== null ? <Text style={styles.caption}>{STATION_COPY.movedFrom(ticket.movedFrom)}</Text> : null}
        </View>
        {ticket.state === "ready" ? (
          <Pill variant="ok">{readyTime !== null ? STATION_COPY.readyAt(readyTime) : STATION_COPY.ready}</Pill>
        ) : (
          <Pill variant={late ? "error" : "muted"}>{ageLabel(ageSeconds)}</Pill>
        )}
      </View>
      <Text style={styles.caption} numberOfLines={2}>{caption}</Text>

      <View style={styles.lines}>
        {ticket.lines.map((line) => {
          const done = line.prepState === "ready" || line.prepState === "served";
          const tickable = column === "cooking" && !voided && !line.voided;
          const body = (
            <View style={styles.lineBody}>
              <Text style={styles.qty}>{line.quantity}</Text>
              <View style={styles.lineText}>
                <Text style={[styles.lineName, (line.voided || voided) && styles.strike, done && styles.doneText]}>
                  {line.name}
                </Text>
                {line.modifiers.length > 0 ? <Text style={styles.caption}>{line.modifiers.join(" · ")}</Text> : null}
                {line.voided ? (
                  <Text style={styles.voidText}>
                    {STATION_COPY.voidedBy(line.voidedByName, line.voidedAt !== null ? venueTime(line.voidedAt, timezone) : null)}
                  </Text>
                ) : null}
              </View>
            </View>
          );
          return (
            <View key={line.itemId} style={styles.lineWrap}>
              {tickable ? (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done, disabled: busy || done }}
                  accessibilityLabel={STATION_COPY.itemReady(line.name)}
                  disabled={busy || done}
                  onPress={() => onItemReady(line.itemId)}
                  style={({ pressed }) => [styles.tickRow, pressed && styles.pressed]}
                  testID={`station-item-ready-${line.itemId}`}
                >
                  <View style={[styles.tick, done && styles.tickOn]}>
                    {done ? <Icon name="check" size={16} color={color.ink} /> : null}
                  </View>
                  {body}
                </Pressable>
              ) : body}
              {line.notes !== null ? <Text style={styles.note}>{line.notes}</Text> : null}
            </View>
          );
        })}
      </View>

      {voided ? (
        <Text style={styles.voidText}>
          {STATION_COPY.voidedBy(voidedLine?.voidedByName ?? null,
            voidedLine?.voidedAt != null ? venueTime(voidedLine.voidedAt, timezone) : null)}
        </Text>
      ) : column === "new" ? (
        <Button label={STATION_COPY.accept} variant="primary" size="lg" fullWidth loading={busy} disabled={busy}
          onPress={onAccept} testID={`station-accept-${ticket.orderId}-${ticket.station}`} />
      ) : column === "cooking" ? (
        <View style={styles.actions}>
          <Button label={STATION_COPY.ready} variant="primary" size="lg" loading={busy} disabled={busy}
            onPress={onReady} style={styles.grow} testID={`station-ready-${ticket.orderId}-${ticket.station}`} />
          {print}
        </View>
      ) : (
        <View style={styles.actions}>
          <Button label={STATION_COPY.pickedUp} variant="primary" size="lg" loading={busy} disabled={busy}
            onPress={onPickedUp} style={styles.grow} testID={`station-picked-${ticket.orderId}-${ticket.station}`} />
          <Button label={STATION_COPY.recall} variant="secondary" size="md" leadingIcon="refund" disabled={busy}
            accessibilityLabel={STATION_COPY.recall} onPress={onRecall}
            testID={`station-recall-${ticket.orderId}-${ticket.station}`} />
          {print}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[2],
    padding: space[3],
    borderRadius: radius.lg,
    backgroundColor: color.card,
    borderWidth: 2,
    borderColor: color.line,
  },
  ring: { borderColor: color.paper },
  voided: { opacity: 0.6 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  headText: { flex: 1, gap: space[1] },
  numberRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  number: { ...type.mono, color: color.text2 },
  destination: { ...type.h2, color: color.text1 },
  caption: { ...type.small, color: color.text3 },
  lines: { gap: space[2] },
  lineWrap: { gap: space[1] },
  tickRow: { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: size.btn.md },
  pressed: { opacity: 0.7 },
  tick: {
    width: 28,
    height: 28,
    borderRadius: radius.xs,
    borderWidth: 2,
    borderColor: color.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  tickOn: { backgroundColor: color.paper, borderColor: color.paper },
  lineBody: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  qty: { ...type.row, color: color.text1, minWidth: 24 },
  lineText: { flex: 1, gap: 2 },
  // Spec 08 T21-A9: item names read from a metre and a half on a tablet.
  lineName: { ...type.title, color: color.text1 },
  doneText: { color: color.text3 },
  strike: { textDecorationLine: "line-through" },
  note: { ...type.small, color: color.warningText, paddingLeft: space[7] },
  voidText: { ...type.small, color: color.danger },
  actions: { flexDirection: "row", gap: space[2], flexWrap: "wrap", alignItems: "center" },
  grow: { flexGrow: 1 },
});
