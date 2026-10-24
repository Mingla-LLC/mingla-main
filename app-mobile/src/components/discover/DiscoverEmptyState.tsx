import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../ui/Icon";
import { useTranslation } from "react-i18next";

interface Props {
  mode: "filters" | "city";
  title: string;
  body: string;
  primaryLabel: string;
  undoLabel?: string;
  primaryA11y?: string;
  doneA11y?: string;
  subscribed?: boolean;
  loading?: boolean;
  nearest?: { label: string; total: number } | null;
  onPrimary: () => void;
  onUndo?: () => void;
  onNearest?: () => void;
}

export function DiscoverEmptyState(props: Props): React.ReactElement {
  const { t } = useTranslation("discover");
  return (
    <View style={styles.root}>
      <Icon name={props.mode === "city" ? "location-outline" : "calendar-outline"} size={48} color="rgba(255,255,255,.45)" />
      <Text style={styles.title}>{props.title}</Text>
      <Text style={styles.body}>{props.body}</Text>
      {props.subscribed ? (
        <View style={styles.confirmation} accessibilityLabel={props.doneA11y}>
          <Icon name="checkmark" size={17} color="#fff" />
          <Text style={styles.primaryText}>{props.primaryLabel}</Text>
          <Pressable onPress={props.onUndo} disabled={props.loading} style={styles.undo} accessibilityRole="button">
            {props.loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.undoText}>{props.undoLabel}</Text>}
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={props.onPrimary} disabled={props.loading} style={styles.primary} accessibilityRole="button" accessibilityLabel={props.primaryA11y}>
          {props.loading ? <ActivityIndicator size="small" color="#fff" /> : <Icon name={props.mode === "city" ? "notifications-outline" : "refresh"} size={17} color="#fff" />}
          <Text style={styles.primaryText}>{props.primaryLabel}</Text>
        </Pressable>
      )}
      {props.nearest ? (
        <Pressable onPress={props.onNearest} style={styles.nearest} accessibilityRole="button">
          <Text style={styles.nearestLabel}>{t("empty.see_city", { city: props.nearest.label, count: props.nearest.total })}</Text>
          <Text style={styles.nearestCount}>›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 18, paddingTop: 36, alignItems: "center", gap: 10 }, title: { color: "#fff", fontSize: 17, fontWeight: "600", textAlign: "center" }, body: { color: "rgba(255,255,255,.65)", fontSize: 15, textAlign: "center", lineHeight: 21 },
  primary: { minHeight: 44, borderRadius: 22, paddingHorizontal: 18, backgroundColor: "#eb7825", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, primaryText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  confirmation: { minHeight: 44, borderRadius: 22, paddingLeft: 16, paddingRight: 4, backgroundColor: "rgba(255,255,255,.12)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  undo: { minHeight: 44, minWidth: 52, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" }, undoText: { color: "#eb7825", fontSize: 14, fontWeight: "700" },
  nearest: { marginTop: 14, minHeight: 48, width: "100%", borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,.1)", backgroundColor: "rgba(255,255,255,.06)", paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, nearestLabel: { color: "#fff", fontSize: 15 }, nearestCount: { color: "rgba(255,255,255,.55)", fontSize: 13 },
});
