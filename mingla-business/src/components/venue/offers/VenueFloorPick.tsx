/**
 * #4490 P5-3 — "Pick my table" (`pr-table`, `prm-table`): the same floor the
 * host drew, in the venue's own theme. Tables that fit and are free are
 * outlined; taken, staff-chosen or wrong-size tables step back AND say so in
 * a word ("Taken", "Wrong size"); the chosen one reads "Yours". Every table is
 * also a row in the list under the map (44 px), so nothing is map-only on a
 * phone, and joined tables for bigger parties are rows too.
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";
import { accentFill, accentOutline } from "@mingla/offering-rendering/themeAccentStyle";
import { opaqueAccentWashColor } from "@mingla/offering-rendering/themePalette";

import { defaultTableSize, LANDMARK_LABEL, parseRoom, PLAN_WIDTH, roomHeight, type TableShape } from "../features/floor/floorRoom";
import type { GuestTableOption } from "../../../services/venueTableGuestService";
import { optionTitle, tableA11y, tableWord } from "./tablePickModel";

export interface VenueFloorPickProps {
  palette: ThemePalette;
  options: readonly GuestTableOption[];
  spacePlans: Readonly<Record<string, unknown>>;
  selectedKey: string | null;
  onSelect: (option: GuestTableOption) => void;
  money: (minor: number) => string;
  testID?: string;
}

export const optionKey = (o: Pick<GuestTableOption, "tableIds">): string => [...o.tableIds].sort().join("+");

function radiusFor(shape: TableShape): number {
  return shape === "round" || shape === "high_top" ? 999 : shape === "sofa" ? 18 : shape === "booth" ? 12 : 8;
}

export function VenueFloorPick({ palette, options, spacePlans, selectedKey, onSelect, money, testID = "venue-floor-pick" }: VenueFloorPickProps): React.ReactElement {
  const spaces = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of options) if (o.spaceId !== null && !seen.has(o.spaceId)) seen.set(o.spaceId, o.spaceName ?? "Tables");
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [options]);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  // Start on the area with the most tables drawn on its floor.
  const placedCount = (id: string): number => options.filter((o) => o.spaceId === id && o.planX !== null && o.planY !== null).length;
  const current =
    spaces.find((s) => s.id === spaceId) ??
    [...spaces].sort((a, b) => placedCount(b.id) - placedCount(a.id))[0] ??
    null;
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent): void => {
    const w = e.nativeEvent.layout.width;
    if (Math.abs(w - width) > 0.5) setWidth(w);
  };
  const room = parseRoom(current !== null ? spacePlans[current.id] : null);
  const scale = width / PLAN_WIDTH;
  const height = roomHeight(room.shape) * scale;
  const inSpace = options.filter((o) => current === null || o.spaceId === current.id);
  const placed = inSpace.filter((o) => o.kind === "table" && o.planX !== null && o.planY !== null);
  const singles = inSpace.filter((o) => o.kind === "table");
  const joins = inSpace.filter((o) => o.kind === "join");

  const row = (o: GuestTableOption): React.ReactElement => {
    const key = optionKey(o);
    const selected = key === selectedKey;
    const free = o.status === "free";
    return (
      <Pressable
        key={key}
        onPress={free ? () => onSelect(o) : undefined}
        disabled={!free}
        accessibilityRole="button"
        accessibilityLabel={tableA11y(o, selected, money)}
        accessibilityState={{ selected, disabled: !free }}
        style={[
          styles.row,
          selected
            ? accentOutline(palette, { background: palette.accentWash, opaqueBackground: opaqueAccentWashColor(palette) })
            : { borderColor: palette.panelBorder, backgroundColor: palette.card },
          !free ? styles.rowOff : null,
        ]}
        testID={`${testID}-row-${key}`}
      >
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: palette.primaryText }]}>{optionTitle(o)}</Text>
          <Text style={[styles.rowMeta, { color: palette.secondaryText }]}>
            {[
              tableWord(o, selected),
              o.minSpendMinor > 0 ? `spend at least ${money(o.minSpendMinor)}` : null,
              o.holdPerGuestMinor !== null && o.holdPerGuestMinor > 0
                ? `${money(o.holdPerGuestMinor)} a guest to hold`
                : o.holdMinor !== null && o.holdMinor > 0
                  ? `${money(o.holdMinor)} to hold this table`
                  : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        <Text style={[styles.rowAction, { color: free ? palette.accent : palette.tertiaryText }]}>{selected ? "Yours" : free ? "Choose" : tableWord(o, false)}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.host} testID={testID}>
      {spaces.length > 1 ? (
        <View style={styles.chips} accessibilityRole="tablist" accessibilityLabel="Seating areas">
          {spaces.map((s) => {
            const on = s.id === current?.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSpaceId(s.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={s.name}
                style={[styles.chip, on ? accentOutline(palette, { background: palette.accentWash, opaqueBackground: opaqueAccentWashColor(palette) }) : { borderColor: palette.panelBorder, backgroundColor: "transparent" }]}
              >
                <Text style={[styles.chipText, { color: palette.primaryText }]}>{s.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {placed.length > 0 ? (
        <View onLayout={onLayout} style={styles.measure}>
          {width > 0 ? (
            <View
              style={[
                styles.room,
                { width, height, borderColor: palette.panelBorder, backgroundColor: palette.card, borderRadius: room.shape === "round" ? 999 : 20 },
              ]}
              accessibilityLabel={`Floor plan of ${current?.name ?? "the venue"}`}
            >
              {room.landmarks.map((l) => (
                <View
                  key={l.id}
                  pointerEvents="none"
                  accessibilityLabel={LANDMARK_LABEL[l.kind]}
                  style={[
                    styles.landmark,
                    {
                      left: l.x * scale,
                      top: l.y * scale,
                      width: l.w * scale,
                      height: l.h * scale,
                      borderColor: palette.panelBorder,
                      transform: [{ rotate: `${l.rotation}deg` }],
                    },
                  ]}
                >
                  <Text numberOfLines={1} style={[styles.landmarkText, { color: palette.tertiaryText }]}>
                    {LANDMARK_LABEL[l.kind]}
                  </Text>
                </View>
              ))}
              {placed.map((o) => {
                const key = optionKey(o);
                const selected = key === selectedKey;
                const free = o.status === "free";
                const size = defaultTableSize(o.shape, o.capacity);
                const w = (o.planW ?? size.w) * scale;
                const h = (o.planH ?? size.h) * scale;
                return (
                  <Pressable
                    key={key}
                    onPress={free ? () => onSelect(o) : undefined}
                    disabled={!free}
                    accessibilityRole="button"
                    accessibilityLabel={tableA11y(o, selected, money)}
                    accessibilityState={{ selected, disabled: !free }}
                    style={[
                      styles.table,
                      {
                        left: (o.planX ?? 0) * scale,
                        top: (o.planY ?? 0) * scale,
                        width: w,
                        height: h,
                        borderRadius: radiusFor(o.shape),
                        transform: [{ rotate: `${o.rotation}deg` }],
                        ...(selected
                          ? accentFill(palette)
                          : free
                            ? accentOutline(palette, { background: palette.page, opaqueBackground: palette.page })
                            : { borderColor: palette.panelBorder, backgroundColor: palette.page }),
                        borderWidth: selected ? 0 : free ? 2 : 1,
                        borderStyle: free || selected ? "solid" : "dashed",
                        opacity: free || selected ? 1 : 0.5,
                      },
                    ]}
                    testID={`${testID}-table-${key}`}
                  >
                    <Text numberOfLines={1} style={[styles.tableName, { color: selected ? palette.accentText : palette.primaryText }]}>
                      {o.names[0] ?? ""}
                    </Text>
                    {w >= 48 && h >= 30 ? (
                      <Text numberOfLines={1} style={[styles.tableWord, { color: selected ? palette.accentText : palette.secondaryText }]}>
                        {tableWord(o, selected)}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={{ height: 200 }} />
          )}
        </View>
      ) : null}
      {placed.length > 0 ? (
        <View style={styles.legend} accessibilityLabel="Legend: outlined fits your party, filled is your table, faded is taken or the wrong size">
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { ...accentOutline(palette, { opaqueBackground: palette.page }), borderWidth: 2 }]} />
            <Text style={[styles.legendText, { color: palette.secondaryText }]}>Fits your party</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, accentFill(palette)]} />
            <Text style={[styles.legendText, { color: palette.secondaryText }]}>Yours</Text>
          </View>
          <Text style={[styles.legendText, { color: palette.tertiaryText }]}>Faded: taken or the wrong size</Text>
        </View>
      ) : null}
      <View style={styles.list} accessibilityLabel="Tables">
        {singles.map(row)}
      </View>
      {joins.length > 0 ? (
        <View style={styles.list}>
          <Text style={[styles.sub, { color: palette.secondaryText }]}>Joined tables for your group</Text>
          {joins.map(row)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: 12 },
  measure: { width: "100%" },
  room: { position: "relative", borderWidth: 2, overflow: "hidden" },
  landmark: { position: "absolute", borderWidth: 1, borderStyle: "dashed", borderRadius: 8, alignItems: "center", justifyContent: "center" },
  landmarkText: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4 },
  table: { position: "absolute", alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  tableName: { fontSize: 12, lineHeight: 15, fontWeight: "700" },
  tableWord: { fontSize: 10, lineHeight: 12, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "600" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14, alignItems: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 14, height: 14, borderRadius: 4 },
  legendText: { fontSize: 13, lineHeight: 18 },
  list: { gap: 8 },
  sub: { fontSize: 13, fontWeight: "600", letterSpacing: 0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, borderWidth: 1 },
  rowOff: { opacity: 0.7 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowMeta: { fontSize: 13, lineHeight: 18 },
  rowAction: { fontSize: 14, fontWeight: "700" },
});
