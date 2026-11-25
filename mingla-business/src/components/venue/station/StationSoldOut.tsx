/**
 * #4490 spec 08 O5 part C (T15) — "Mark sold out" on the station board: the
 * station's items with their count and how many live tickets carry them;
 * "Sold out" sets the count to 0 (never switches the item off) and "Back on"
 * undoes only a mark the kitchen made tonight. Counts are a manager's, in Menu.
 * The body of a Sheet the station screen owns (never a second sheet).
 */
import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { color, space, type } from "../../../constants/designSystem";
import {
  fetchStationStock,
  setStationSoldOut,
  StockError,
  type StationStockItem,
} from "../../../services/venueStockService";
import { refreshStockReads } from "../../../hooks/stockRefresh";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Spinner } from "../../ui/Spinner";
import { STOCK_COPY, stockErrorCopy } from "../stock/stockCopy";
import { STATION_COPY } from "./stationCopy";
import type { StationChoice } from "./stationModel";

export const stationStockKey = (venueId: string, station: StationChoice) =>
  ["stationStock", venueId, station] as const;

export interface StationSoldOutBodyProps {
  venueId: string;
  station: StationChoice;
  /** "19:58" in the venue's zone. */
  timeOf: (iso: string) => string;
  onClose: () => void;
  /** A mark landed: the screen shows "{item} is sold out" with Undo. */
  onMarked: (item: { menuItemId: string; name: string }) => void;
}

export function StationSoldOutBody({
  venueId,
  station,
  timeOf,
  onClose,
  onMarked,
}: StationSoldOutBodyProps): React.ReactElement {
  const queryClient = useQueryClient();
  const query = useQuery<StationStockItem[]>({
    queryKey: stationStockKey(venueId, station),
    queryFn: () => fetchStationStock(venueId, station),
    staleTime: 5_000,
  });
  const [search, setSearch] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter((i) => term.length === 0 || i.name.toLowerCase().includes(term));
  }, [query.data, search]);

  const act = async (item: StationStockItem, on: boolean): Promise<void> => {
    if (busy !== null) return;
    setBusy(item.menuItemId);
    setError(null);
    try {
      await setStationSoldOut(venueId, item.menuItemId, on);
      refreshStockReads(queryClient, venueId);
      await queryClient.invalidateQueries({ queryKey: ["stationStock", venueId] });
      if (on) onMarked({ menuItemId: item.menuItemId, name: item.name });
    } catch (err) {
      setError(stockErrorCopy(err instanceof StockError ? err.code : "stock_failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.sheet} testID="station-sold-out-sheet-body">
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.h2} accessibilityRole="header">{STOCK_COPY.boardTitle}</Text>
          <Text style={styles.muted}>{STOCK_COPY.boardSub}</Text>
        </View>
        <Button label={STATION_COPY.close} variant="ghost" size="sm" onPress={onClose} testID="station-sold-out-close" />
      </View>
      <Input
        value={search}
        onChangeText={setSearch}
        placeholder={STOCK_COPY.boardSearch}
        accessibilityLabel={STOCK_COPY.boardSearch}
        testID="station-sold-out-search"
      />
      {query.isPending ? (
        <View style={styles.center}><Spinner /></View>
      ) : query.isError ? (
        <View style={styles.center}>
          <Text style={styles.error} accessibilityRole="alert">
            {stockErrorCopy(query.error instanceof StockError ? query.error.code : "stock_failed")}
          </Text>
          <Button label={STATION_COPY.tryAgain} variant="secondary" size="md" onPress={() => void query.refetch()} />
        </View>
      ) : items.length === 0 ? (
        <Text style={styles.muted} testID="station-sold-out-empty">{STOCK_COPY.boardEmpty}</Text>
      ) : (
        <View style={styles.list}>
          {items.map((item) => {
            const sub = item.soldOut
              ? STOCK_COPY.boardMarked(timeOf(item.markedAt ?? item.outAt ?? ""), item.markedBy)
              : STOCK_COPY.boardRow(item.stockLeft, item.openTickets);
            return (
              <View key={item.menuItemId} style={styles.row} testID={`station-sold-out-row-${item.menuItemId}`}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{item.name}</Text>
                  <Text style={item.soldOut ? styles.rowSubOut : styles.rowSub}>{sub}</Text>
                </View>
                {item.soldOut ? (
                  item.canUndo ? (
                    <Button label={STOCK_COPY.boardBackOn} variant="secondary" size="md"
                      loading={busy === item.menuItemId} disabled={busy !== null && busy !== item.menuItemId}
                      onPress={() => void act(item, false)} testID={`station-back-on-${item.menuItemId}`} />
                  ) : null
                ) : (
                  <Button label={STOCK_COPY.boardMark} variant="destructive" size="md"
                    loading={busy === item.menuItemId} disabled={busy !== null && busy !== item.menuItemId}
                    onPress={() => void act(item, true)} testID={`station-mark-${item.menuItemId}`} />
                )}
              </View>
            );
          })}
        </View>
      )}
      {error !== null ? <Text style={styles.error} accessibilityRole="alert" testID="station-sold-out-error">{error}</Text> : null}
      <Text style={styles.muted}>{STOCK_COPY.boardFooter}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: space[3], paddingHorizontal: space[4], paddingBottom: space[6] },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  headText: { flex: 1, gap: space[1] },
  h2: { ...type.h2, color: color.text1 },
  muted: { ...type.small, color: color.text2 },
  center: { alignItems: "center", gap: space[2], paddingVertical: space[4] },
  list: { gap: space[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  rowText: { flex: 1, minWidth: 0, gap: space[1] },
  rowTitle: { ...type.row, color: color.text1 },
  rowSub: { ...type.caption, color: color.text2 },
  rowSubOut: { ...type.caption, color: color.errorText },
  error: { ...type.small, color: color.errorText },
});
