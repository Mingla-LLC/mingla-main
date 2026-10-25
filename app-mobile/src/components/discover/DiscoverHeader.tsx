import React, { forwardRef, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../ui/Icon";
import type { DiscoverKind } from "../../types/discoverFeed";
import { DiscoverPillRow, type DiscoverPillRowHandle } from "./DiscoverPillRow";

interface Props {
  title: string;
  cityUnsetLabel: string;
  cityLabel: string | null;
  cityA11y: string;
  visibleKinds: DiscoverKind[];
  selectedKind: DiscoverKind;
  kindLabels: Record<DiscoverKind, string>;
  resultLabel: string;
  filterLabel: string;
  filterCount: number;
  filterOpen: boolean;
  filterDisabled: boolean;
  onCityPress: () => void;
  onKindSelect: (kind: DiscoverKind) => void;
  onFilterPress: (anchorBottom: number) => void;
  pillTargetRef: (node: View | null) => void;
  filterTargetRef: (node: View | null) => void;
}

export const DiscoverHeader = forwardRef<DiscoverPillRowHandle, Props>(function DiscoverHeader(
  props,
  ref,
) {
  const filterRef = useRef<View | null>(null);
  const setFilterRef = (node: View | null): void => {
    filterRef.current = node;
    props.filterTargetRef(node);
  };
  const openFilters = (): void => {
    filterRef.current?.measureInWindow((_x, y, _width, height) => props.onFilterPress(y + height + 8));
  };
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">{props.title}</Text>
        <Pressable onPress={props.onCityPress} style={styles.city} accessibilityLabel={props.cityA11y} accessibilityRole="button">
          <Icon name="location-outline" size={14} color="#fff" />
          <Text numberOfLines={1} style={styles.cityText}>{props.cityLabel ?? props.cityUnsetLabel}</Text>
          <Icon name="chevron-down" size={14} color="rgba(255,255,255,.75)" />
        </Pressable>
      </View>
      {props.visibleKinds.length > 0 ? (
        <DiscoverPillRow
          ref={ref}
          kinds={props.visibleKinds}
          selected={props.selectedKind}
          labels={props.kindLabels}
          onSelect={props.onKindSelect}
          targetRef={props.pillTargetRef}
        />
      ) : null}
      <View style={styles.filterRow}>
        <Pressable
          ref={setFilterRef}
          onPress={openFilters}
          disabled={props.filterDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: props.filterDisabled, expanded: props.filterOpen }}
          style={[styles.filter, props.filterOpen && styles.filterOpen, props.filterDisabled && styles.disabled]}
        >
          <Icon name="options-outline" size={16} color="#fff" />
          <Text style={styles.filterText} numberOfLines={1}>{props.filterLabel}</Text>
          {props.filterCount > 0 ? <Text style={styles.badge}>{props.filterCount}</Text> : null}
          <Icon name={props.filterOpen ? "chevron-up" : "chevron-down"} size={14} color="#fff" />
        </Pressable>
        <Text style={styles.result}>{props.resultLabel}</Text>
      </View>
    </View>
  );
});
const styles = StyleSheet.create({
  header: { backgroundColor: "rgba(22,24,28,.94)", borderBottomColor: "rgba(255,255,255,.12)", borderBottomWidth: 1, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, paddingBottom: 10 },
  titleRow: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { color: "#fff", fontSize: 32, lineHeight: 38, fontWeight: "700" },
  city: { maxWidth: "58%", height: 32, borderRadius: 999, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,.12)" },
  cityText: { color: "#fff", fontSize: 13, fontWeight: "500", flexShrink: 1 },
  filterRow: { paddingHorizontal: 16, paddingTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  filter: { height: 36, maxWidth: "72%", paddingHorizontal: 11, borderRadius: 18, borderWidth: 1, borderColor: "transparent", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,.12)" },
  filterOpen: { borderColor: "rgba(235,120,37,.75)" },
  disabled: { opacity: 0.45 },
  filterText: { color: "#fff", fontSize: 13, fontWeight: "500", flexShrink: 1 },
  badge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, color: "#fff", backgroundColor: "#eb7825", fontSize: 10, fontWeight: "700", textAlign: "center", lineHeight: 16 },
  result: { color: "rgba(255,255,255,.55)", fontSize: 12 },
});
