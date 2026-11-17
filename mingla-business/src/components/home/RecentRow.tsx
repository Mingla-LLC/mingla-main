import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  color,
  space,
  type,
} from "../../constants/designSystem";
import type { BusinessRecentPointer } from "../../store/businessRecentStore";
import { formatRelativeTime } from "../../utils/relativeTime";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";

const typeLabel = (row: BusinessRecentPointer): string =>
  row.entityType === "rsvp"
    ? "RSVP"
    : row.entityType[0].toUpperCase() + row.entityType.slice(1);

const isLive = (row: BusinessRecentPointer): boolean => row.status === "live";

export function RecentRow({
  row,
  onPress,
}: {
  row: BusinessRecentPointer;
  onPress: () => void;
}): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const live = isLive(row);
  const status = live
    ? "Live"
    : row.status === "draft" || row.localDraft
      ? "Draft"
      : typeLabel(row);
  const opened = `Opened ${formatRelativeTime(row.lastOpenedAt)}`;
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${typeLabel(row)}: ${row.title?.trim() || "Title unavailable"}. ${status}. ${opened}.`}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        Platform.OS === "web" && focused && styles.rowFocused,
      ]}
    >
      <EventCoverMedia
        hue={24}
        mediaUrl={row.coverUrl ?? null}
        posterUrl={row.coverPosterUrl ?? null}
        mediaType={row.coverType ?? null}
        radius={12}
        label=""
        height={56}
        width={56}
      />
      <View style={styles.rowText}>
        <View style={styles.metaRow}>
          {live ? (
            <Pill variant="live">Live</Pill>
          ) : row.status === "draft" || row.localDraft ? (
            <Pill variant="draft">Draft</Pill>
          ) : null}
          <Text style={styles.type}>{typeLabel(row)}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {row.title?.trim() || "--"}
        </Text>
        <Text style={styles.opened}>{opened}</Text>
      </View>
      <Icon name="chevR" size={18} color={color.text3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    padding: space[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  rowPressed: { opacity: 0.72 },
  rowFocused: { borderColor: color.lineStrong, borderWidth: 2 },
  rowText: { flex: 1, minWidth: 0 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    marginBottom: 2,
  },
  type: {
    color: color.text3,
    fontSize: type.label.fontSize,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  title: {
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
  },
  opened: {
    color: color.text2,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
  },
});
