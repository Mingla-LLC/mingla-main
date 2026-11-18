/**
 * Table — #4420 Graphite Glass (spec §3.2). Web lists with four or more
 * columns: a 44 sticky header on `fill.tableHead`, 56 rows with a hover wash,
 * `align: "right"` for numbers. Columns share the width by `flex` (default 1,
 * `minmax(0, 1fr)`): cells wrap before they overflow, and a table that still
 * cannot fit scrolls inside its own card. On phones, render `ListRow`s
 * instead (the caller chooses; Table never renders a phone layout).
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PressableStateCallbackType, StyleProp, ViewStyle } from "react-native";

import { color, space, type } from "../../constants/designSystem";

import { GlassCard } from "./GlassCard";

export interface TableColumn<Row> {
  key: string;
  title: string;
  flex?: number;
  /** Minimum width so the table scrolls instead of crushing the column. */
  minWidth?: number;
  align?: "left" | "right";
  render: (row: Row) => React.ReactNode;
}

export interface TableProps<Row> {
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  onRowPress?: (row: Row) => void;
  /**
   * The spoken name of a pressable row. Defaults to the row's plain-text
   * cells joined ("Ada Obi, Owner, Active").
   */
  rowAccessibilityLabel?: (row: Row) => string;
  selectedKey?: string | null;
  /** Shown in place of rows when `rows` is empty. */
  empty?: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const TABLE_HEADER_HEIGHT = 44;
export const TABLE_ROW_HEIGHT = 56;

export function Table<Row>({ columns, rows, rowKey, onRowPress, rowAccessibilityLabel, selectedKey, empty, testID, style }: TableProps<Row>): React.ReactElement {
  const minTableWidth = columns.reduce((sum, c) => sum + (c.minWidth ?? 0), 0);
  const cellStyle = (c: TableColumn<Row>): ViewStyle => ({
    flex: c.flex ?? 1,
    minWidth: c.minWidth ?? 0,
    alignItems: c.align === "right" ? "flex-end" : "flex-start",
  });
  const defaultRowLabel = (row: Row): string =>
    columns
      .map((c) => c.render(row))
      .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
      .join(", ");
  const renderCell = (c: TableColumn<Row>, row: Row): React.ReactNode => {
    const content = c.render(row);
    return typeof content === "string" || typeof content === "number" ? (
      <Text style={[styles.cellText, c.align === "right" ? styles.right : null]}>{content}</Text>
    ) : (
      content
    );
  };

  return (
    <GlassCard padding={0} style={style} testID={testID}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.table, { minWidth: minTableWidth }]} accessibilityRole="list">
          <View style={styles.header}>
            {columns.map((c) => (
              <View key={c.key} style={[styles.cell, cellStyle(c)]}>
                <Text style={styles.headText} numberOfLines={1}>
                  {c.title}
                </Text>
              </View>
            ))}
          </View>
          {rows.length === 0 && empty !== undefined ? <View style={styles.empty}>{empty}</View> : null}
          {rows.map((row, index) => {
            const key = rowKey(row);
            const selected = selectedKey === key;
            const cells = (hover: boolean): React.ReactNode => (
              <View
                style={[
                  styles.row,
                  index > 0 ? styles.divider : null,
                  hover ? styles.hover : null,
                  selected ? styles.selected : null,
                ]}
              >
                {columns.map((c) => (
                  <View key={c.key} style={[styles.cell, cellStyle(c)]}>
                    {renderCell(c, row)}
                  </View>
                ))}
              </View>
            );
            return onRowPress === undefined ? (
              <View key={key}>{cells(false)}</View>
            ) : (
              <Pressable
                key={key}
                onPress={() => onRowPress(row)}
                accessibilityRole="button"
                accessibilityLabel={rowAccessibilityLabel?.(row) ?? defaultRowLabel(row)}
                accessibilityState={{ selected }}
              >
                {(state: PressableStateCallbackType & { hovered?: boolean }) => cells(state.pressed || state.hovered === true)}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  table: { flex: 1 },
  header: {
    flexDirection: "row",
    minHeight: TABLE_HEADER_HEIGHT,
    alignItems: "center",
    backgroundColor: color.fill.tableHead,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
    paddingHorizontal: space[2],
  },
  row: { flexDirection: "row", minHeight: TABLE_ROW_HEIGHT, alignItems: "center", paddingHorizontal: space[2] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  hover: { backgroundColor: color.fill.rowHover },
  selected: { backgroundColor: color.fill.railOn },
  cell: { paddingHorizontal: space[3], paddingVertical: space[2], justifyContent: "center" },
  headText: { ...type.label, textTransform: "uppercase", color: color.text3 },
  cellText: { ...type.small, color: color.text1 },
  right: { textAlign: "right" },
  empty: { padding: space[6] },
});

export default Table;
