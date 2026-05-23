// ORCH-0908: Thin strip banner that pins above the message list in a
// collab session's group chat (mounted by BoardDiscussion.tsx between
// the header and the FlatList). Renders when the session has a card
// with is_locked=true AND the corresponding calendar_entries row has
// a scheduled_at value.
//
// Per SPEC §2A.12: 48px tall, full-width, accent amber background,
// lock icon + card title (bold, 1 line) + formatted scheduled date
// (muted, 1 line), tap navigates to the card detail. Hides when
// session.status flips back to 'active' (cycle restart) per Q-banner-persist
// operator default.

import { useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  AccessibilityInfo,
} from "react-native";
import Icon from "../ui/Icon";

interface LockedPlanBannerProps {
  cardTitle: string;
  scheduledAtIso: string | null;
  onPress?: () => void;
}

function formatScheduledAt(iso: string): string {
  try {
    const dt = new Date(iso);
    // Per-user local time zone; uses device locale via Intl.
    return dt.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function LockedPlanBanner({
  cardTitle,
  scheduledAtIso,
  onPress,
}: LockedPlanBannerProps): JSX.Element | null {
  const formattedDate = useMemo(
    () => (scheduledAtIso ? formatScheduledAt(scheduledAtIso) : null),
    [scheduledAtIso],
  );

  // Banner only renders when we have both a card title and a real scheduled date
  // (Constitution #9: no fabricated data — placeholder schedules from the
  // auto-lock cascade should NOT render until rpc_admin_schedule_locked_card
  // has overwritten with a user-picked time).
  if (!cardTitle || !formattedDate) {
    return null;
  }

  const a11yLabel = `Locked-in plan: ${cardTitle}, scheduled for ${formattedDate}. Tap to view.`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.banner,
        pressed && styles.bannerPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.iconWrap}>
        <Icon name="lock-closed" size={18} color="#92400E" />
      </View>
      <View style={styles.textWrap}>
        <Text
          style={styles.title}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {cardTitle}
        </Text>
        <Text
          style={styles.subtitle}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {formattedDate}
        </Text>
      </View>
      {onPress ? (
        <Icon name="chevron-forward" size={18} color="#92400E" />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#FEF3C7",
    borderBottomWidth: 1,
    borderBottomColor: "#FCD34D",
  },
  bannerPressed: {
    backgroundColor: "#FDE68A",
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FDE68A",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  textWrap: {
    flex: 1,
    flexDirection: "column",
    justifyContent: "center",
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#78350F",
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "400",
    color: "#92400E",
    lineHeight: 16,
    marginTop: 1,
  },
});
