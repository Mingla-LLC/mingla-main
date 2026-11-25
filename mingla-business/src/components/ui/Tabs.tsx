/**
 * Tabs — #4420 Graphite Glass (spec §3.2). Underline tabs for sections inside
 * a page. The active tab: text1 label + a 2px paper underline; others text3.
 * Optional count after the label. When the tabs are wider than their row
 * they wrap onto a second line (#4490 click-test D28): a hidden horizontal
 * scroll clipped the last tab ("Te…" for Team) with nothing to say more
 * were there.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { color, space, type } from "../../constants/designSystem";

export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  count?: number;
  testID?: string;
}

export interface TabsProps<K extends string = string> {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Tabs<K extends string = string>({ items, value, onChange, testID, style }: TabsProps<K>): React.ReactElement {
  return (
    <View style={[styles.root, style]} testID={testID} accessibilityRole="tablist">
      <View style={styles.row}>
        {items.map((item) => {
          const on = item.key === value;
          return (
            <Pressable
              key={item.key}
              onPress={() => onChange(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={item.count !== undefined ? `${item.label}, ${item.count}` : item.label}
              testID={item.testID}
              style={styles.tab}
            >
              <View style={styles.labelRow}>
                <Text style={[styles.label, on ? styles.labelOn : null]} numberOfLines={1}>
                  {item.label}
                </Text>
                {item.count !== undefined ? <Text style={styles.count}>{item.count}</Text> : null}
              </View>
              <View style={[styles.underline, on ? styles.underlineOn : null]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  row: { flexDirection: "row", flexWrap: "wrap", columnGap: space[5] },
  tab: { paddingTop: space[2], minHeight: 44, justifyContent: "flex-end" },
  labelRow: { flexDirection: "row", alignItems: "center", gap: space[1], paddingBottom: space[2] },
  label: { ...type.small, fontWeight: "600", color: color.text3 },
  labelOn: { color: color.text1 },
  count: { ...type.caption, color: color.text3 },
  underline: { height: 2, borderRadius: 1, backgroundColor: color.transparent },
  underlineOn: { backgroundColor: color.paper },
});

export default Tabs;
