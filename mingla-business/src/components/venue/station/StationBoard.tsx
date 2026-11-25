/**
 * #4490 spec 08 O3 — the kitchen and bar board (spec 08 §2 screen 12):
 * New · Cooking · Ready. Phone: Tabs; tablet and desk widths: three columns
 * (useFloorLayout). Header: station name, venue, connection pill, the station
 * switch, mute. One banner at a time, most urgent first: PDF failed, sound
 * locked by the browser (T17), sound needs the latest app, muted, reconnecting,
 * new order. Presentational: StationScreen owns the data, sound and actions.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { Banner, type BannerTone } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Chip, Pill, Segmented } from "../../ui/Pill";
import { STATION_COPY } from "./stationCopy";
import { STOCK_COPY } from "../stock/stockCopy";
import {
  columnTickets,
  stationNoun,
  ticketKey,
  type StationBoard as StationBoardData,
  type StationChoice,
  type StationColumn,
  type StationTicket,
} from "./stationModel";
import { StationTicketCard } from "./StationTicket";

export interface StationBanner {
  tone: BannerTone;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
  testID: string;
}

export interface StationBoardProps {
  board: StationBoardData;
  choice: StationChoice;
  onChoose: (choice: StationChoice) => void;
  columns: boolean;
  tab: StationColumn;
  onTab: (tab: StationColumn) => void;
  connection: "connecting" | "live" | "reconnecting";
  banner: StationBanner | null;
  muteLabel: string;
  onMute: () => void;
  /** #4490 O5 part C (T15): opens "Mark sold out". Absent = no control. */
  onSoldOut?: () => void;
  ageOf: (ticket: StationTicket) => number;
  ringOn: boolean;
  busyKey: string | null;
  printingKey: string | null;
  onAccept: (t: StationTicket) => void;
  onItemReady: (t: StationTicket, itemId: string) => void;
  onReady: (t: StationTicket) => void;
  onPickedUp: (t: StationTicket) => void;
  onRecall: (t: StationTicket) => void;
  onPrint: (t: StationTicket) => void;
  onClose: () => void;
  showKeepOpen: boolean;
}

const COLUMNS: readonly StationColumn[] = ["new", "cooking", "ready"];
const CHOICES: readonly { key: StationChoice; label: string }[] = [
  { key: "kitchen", label: STATION_COPY.kitchen },
  { key: "bar", label: STATION_COPY.bar },
  { key: "all", label: STATION_COPY.everything },
];

const columnTitle = (c: StationColumn): string =>
  c === "new" ? STATION_COPY.colNew : c === "cooking" ? STATION_COPY.colCooking : STATION_COPY.colReady;

export function StationBoard(props: StationBoardProps): React.ReactElement {
  const { board, choice, columns } = props;
  const byColumn: Record<StationColumn, StationTicket[]> = {
    new: columnTickets(board.tickets, "new"),
    cooking: columnTickets(board.tickets, "cooking"),
    ready: columnTickets(board.tickets, "ready"),
  };
  const emptyText = (c: StationColumn): string =>
    c === "new"
      ? choice === "all" ? STATION_COPY.emptyNewAll : STATION_COPY.emptyNew(stationNoun(choice))
      : c === "cooking" ? STATION_COPY.emptyCooking : STATION_COPY.emptyReady;
  const title = choice === "bar" ? STATION_COPY.bar : choice === "kitchen" ? STATION_COPY.kitchen : STATION_COPY.everything;

  const renderColumn = (c: StationColumn): React.ReactElement => (
    <View style={styles.columnBody}>
      {byColumn[c].length === 0 ? (
        <Text style={styles.empty} testID={`station-empty-${c}`}>{emptyText(c)}</Text>
      ) : byColumn[c].map((t) => (
        <StationTicketCard
          key={ticketKey(t)}
          ticket={t}
          ageSeconds={props.ageOf(t)}
          targets={board.targetMinutes}
          timezone={board.timezone}
          ringOn={props.ringOn}
          busy={props.busyKey === ticketKey(t)}
          printing={props.printingKey === ticketKey(t)}
          onAccept={() => props.onAccept(t)}
          onItemReady={(itemId) => props.onItemReady(t, itemId)}
          onReady={() => props.onReady(t)}
          onPickedUp={() => props.onPickedUp(t)}
          onRecall={() => props.onRecall(t)}
          onPrint={() => props.onPrint(t)}
        />
      ))}
    </View>
  );

  return (
    <View style={styles.root} testID="station-board">
      {/* #4490 08-O5 fix 6: on a phone (no columns) the header is a stack:
          the title block takes the full width on top and the buttons wrap
          underneath. Fix 5 relied on flex-wrap with a shrinkable title, which
          iOS laid out on one line and cut to "Eve…" / "T4490…" / "RECO…". */}
      <View style={columns ? styles.header : styles.headerPhone} testID="station-header">
        <View style={columns ? styles.headText : styles.headTextPhone}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={columns ? 1 : undefined} testID="station-title">{title}</Text>
          <View style={styles.subRow}>
            <Text style={styles.caption} numberOfLines={columns ? 1 : undefined}>{board.venueName}</Text>
            <Pill variant={props.connection === "reconnecting" ? "warn" : "ok"} testID="station-connection">
              {props.connection === "reconnecting" ? STATION_COPY.reconnecting : STATION_COPY.live}
            </Pill>
          </View>
        </View>
        {/* #4490 08-O5 fix 5: the buttons are their own group ("Kitchen" keeps
            its width; it broke as "Kitch / en"). */}
        <View style={styles.headActions} testID="station-head-actions">
          {props.onSoldOut !== undefined ? (
            <Button label={STOCK_COPY.boardButton} variant="secondary" size="md" leadingIcon="flag" onPress={props.onSoldOut}
              testID="station-sold-out" />
          ) : null}
          <Button label={props.muteLabel} variant="secondary" size="md" leadingIcon="bell" onPress={props.onMute}
            testID="station-mute" />
          <Button label={STATION_COPY.close} variant="ghost" size="md" onPress={props.onClose} testID="station-close" />
        </View>
      </View>
      <View style={styles.chips}>
        {CHOICES.map((c) => (
          <Chip key={c.key} label={c.label} selected={c.key === choice} onPress={() => props.onChoose(c.key)}
            testID={`station-switch-${c.key}`} />
        ))}
      </View>
      {props.banner !== null ? (
        <Banner tone={props.banner.tone} title={props.banner.title} body={props.banner.body}
          action={props.banner.action} testID={props.banner.testID} style={styles.banner} />
      ) : null}
      {columns ? (
        <View style={styles.columns}>
          {COLUMNS.map((c) => (
            <View key={c} style={styles.column} testID={`station-column-${c}`}>
              <View style={styles.columnHead}>
                <Text style={styles.columnTitle}>{columnTitle(c)}</Text>
                <Pill variant="muted">{String(byColumn[c].length)}</Pill>
              </View>
              <ScrollView style={styles.grow} contentContainerStyle={styles.scroll}>{renderColumn(c)}</ScrollView>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.grow}>
          <Segmented
            options={COLUMNS.map((c) => ({ key: c, label: columnTitle(c), count: byColumn[c].length, testID: `station-tab-${c}` }))}
            value={props.tab}
            onChange={props.onTab}
            style={styles.tabs}
          />
          <ScrollView style={styles.grow} contentContainerStyle={styles.scroll}>{renderColumn(props.tab)}</ScrollView>
        </View>
      )}
      {props.showKeepOpen ? <Text style={styles.keepOpen}>{`${STATION_COPY.keepOpen}.`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: space[3], paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[3] },
  header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space[2], rowGap: space[3] },
  // At least room for "Everything" in h1 before the buttons wrap below it.
  headText: { flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 0, gap: space[1] },
  headerPhone: { flexDirection: "column", alignItems: "stretch", rowGap: space[3] },
  headTextPhone: { alignSelf: "stretch", gap: space[1] },
  headActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  title: { ...type.h1, color: color.text1 },
  subRow: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  caption: { ...type.small, color: color.text3, flexShrink: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  banner: { alignSelf: "stretch" },
  columns: { flex: 1, flexDirection: "row", gap: space[3], minHeight: 0 },
  column: { flex: 1, minWidth: 0, gap: space[2] },
  columnHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  columnTitle: { ...type.h2, color: color.text1 },
  columnBody: { gap: space[3] },
  tabs: { marginBottom: space[2] },
  grow: { flex: 1 },
  scroll: { paddingBottom: space[4], gap: space[3] },
  empty: { ...type.small, color: color.text3, textAlign: "center", paddingVertical: space[7] },
  keepOpen: { ...type.small, color: color.text3, textAlign: "center" },
});
