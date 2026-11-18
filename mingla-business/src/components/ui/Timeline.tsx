/**
 * Timeline — #4420 Graphite Glass (spec §3.2). A vertical history (payouts,
 * reservations): a dot per step joined by a hairline. `done` = green filled
 * dot, `current` = paper ring, `pending` = muted ring.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";

export type TimelineState = "done" | "current" | "pending";

export interface TimelineItem {
  key: string;
  title: string;
  meta?: string;
  state: TimelineState;
}

export interface TimelineProps {
  items: readonly TimelineItem[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const DOT = 12;

export const Timeline: React.FC<TimelineProps> = ({ items, testID, style }) => (
  <View style={style} testID={testID}>
    {items.map((item, index) => {
      const last = index === items.length - 1;
      return (
        <View key={item.key} style={styles.item}>
          <View style={styles.rail}>
            <View
              style={[
                styles.dot,
                item.state === "done"
                  ? styles.dotDone
                  : item.state === "current"
                    ? styles.dotCurrent
                    : styles.dotPending,
              ]}
            />
            {!last ? <View style={styles.line} /> : null}
          </View>
          <View style={[styles.body, last ? null : styles.bodyGap]}>
            <Text style={[styles.title, item.state === "pending" ? styles.pendingText : null]}>{item.title}</Text>
            {item.meta !== undefined ? <Text style={styles.meta}>{item.meta}</Text> : null}
          </View>
        </View>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  item: { flexDirection: "row", gap: space[3] },
  rail: { width: DOT, alignItems: "center" },
  dot: { width: DOT, height: DOT, borderRadius: radius.full, marginTop: 4 },
  dotDone: { backgroundColor: color.success },
  dotCurrent: { borderWidth: 2, borderColor: color.paper, backgroundColor: color.canvas },
  dotPending: { borderWidth: 2, borderColor: color.text4, backgroundColor: color.canvas },
  line: { flex: 1, width: StyleSheet.hairlineWidth * 2, backgroundColor: color.lineStrong, marginVertical: space[1] },
  body: { flex: 1, minWidth: 0, gap: 2 },
  bodyGap: { paddingBottom: space[4] },
  title: { ...type.small, fontWeight: "600", color: color.text1 },
  pendingText: { color: color.text3 },
  meta: { ...type.caption, color: color.text3 },
});

export default Timeline;
