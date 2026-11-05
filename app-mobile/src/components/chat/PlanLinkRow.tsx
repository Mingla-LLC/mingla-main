/**
 * Issue #4261 amendment 1 (6.5 #4) — a place that is not on Mingla shows a
 * link row instead of a Mingla card: its own link (website, menu, tickets) or
 * "Open in Maps". The tap opens inside Mingla (the caller routes it through
 * `useOpenInMingla`).
 */
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import type { ChatPlanLink } from "../../types/chatPlans";

interface PlanLinkRowProps {
  /** The place's own link, or null for "Open in Maps". */
  link: Pick<ChatPlanLink, "domain" | "title"> | null;
  /** Line 2 for the maps row (the address, else the name). */
  mapsSubtitle?: string | null;
  compact?: boolean;
  onPress: () => void;
  testID?: string;
}

export function PlanLinkRow({ link, mapsSubtitle, compact = false, onPress, testID }: PlanLinkRowProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const primary = link ? link.title?.trim() || link.domain : t("chat:plan_open_in_maps");
  const secondary = link ? link.domain : mapsSubtitle ?? null;
  return (
    <TouchableOpacity
      style={[styles.row, compact && styles.rowCompact]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="link"
      accessibilityLabel={link ? t("chat:plan_open_link_a11y", { domain: link.domain }) : t("chat:plan_open_in_maps")}
      testID={testID ?? (link ? "plan-link-row" : "plan-maps-row")}
    >
      <View style={styles.tile}>
        <Icon name={link ? "link" : "map-outline"} size={18} color={link ? chatTokens.tagChat : chatTokens.textPrimary} />
      </View>
      <View style={styles.text}>
        <Text style={styles.primary} numberOfLines={1}>{primary}</Text>
        {secondary ? <Text style={styles.secondary} numberOfLines={1}>{secondary}</Text> : null}
      </View>
      <Icon name="open-outline" size={16} color={chatTokens.textSoft} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: chatTokens.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
  },
  rowCompact: { minHeight: 48 },
  tile: { width: 36, height: 36, borderRadius: 10, backgroundColor: chatTokens.strip, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0 },
  primary: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  secondary: { color: chatTokens.textSoft, fontSize: 12 },
});
