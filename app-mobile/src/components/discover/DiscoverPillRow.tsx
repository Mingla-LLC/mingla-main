import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DiscoverKind } from "../../types/discoverFeed";

interface Props {
  kinds: DiscoverKind[];
  selected: DiscoverKind;
  labels: Record<DiscoverKind, string>;
  onSelect: (kind: DiscoverKind) => void;
  targetRef?: (node: View | null) => void;
}

export interface DiscoverPillRowHandle { scrollToStart: () => void }

export const DiscoverPillRow = forwardRef<DiscoverPillRowHandle, Props>(function DiscoverPillRow(
  { kinds, selected, labels, onSelect, targetRef },
  ref,
) {
  const scrollRef = useRef<ScrollView>(null);
  useImperativeHandle(ref, () => ({ scrollToStart: () => scrollRef.current?.scrollTo({ x: 0, animated: false }) }));
  return (
    <View style={styles.target}>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {kinds.map((kind, index) => {
          const active = kind === selected;
          return (
            <Pressable
              key={kind}
              ref={index === 0 ? targetRef : undefined}
              collapsable={false}
              onPress={() => onSelect(kind)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.pill, active && styles.active]}
            >
              <Text style={[styles.label, active && styles.activeLabel]}>{labels[kind]}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});
const styles = StyleSheet.create({
  target: { marginHorizontal: 8 },
  row: { gap: 8, paddingHorizontal: 8, paddingTop: 2 },
  pill: { height: 36, borderRadius: 18, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  active: { backgroundColor: "#eb7825" },
  label: { color: "rgba(255,255,255,0.78)", fontSize: 14, fontWeight: "500" },
  activeLabel: { color: "#fff", fontWeight: "700" },
});
