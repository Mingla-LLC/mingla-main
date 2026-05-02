/**
 * OrderListCard — row in the Orders list (J-M1).
 *
 * Mirrors design-package screens-ops.jsx:204-227. Avatar with hsl bg
 * (per memory rule — translates design-package oklch); buyer name +
 * order ID (mono) + qty×ticket name + relative time + total + status
 * pill on the right.
 *
 * Per Cycle 9c spec §3.4.1.
 */

import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { OrderRecord } from "../../store/orderStore";
import { formatGbpRound } from "../../utils/currency";

import { Pill } from "../ui/Pill";

export interface OrderListCardProps {
  order: OrderRecord;
  onPress: () => void;
}

const RELATIVE_TIME_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

const formatRelativeTime = (iso: string): string => {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const delta = now - then;
  if (delta < RELATIVE_TIME_MS.minute) return "just now";
  if (delta < RELATIVE_TIME_MS.hour) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.minute)}m ago`;
  }
  if (delta < RELATIVE_TIME_MS.day) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.hour)}h ago`;
  }
  return `${Math.floor(delta / RELATIVE_TIME_MS.day)}d ago`;
};

const hashStringToHue = (s: string): number => {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

interface StatusPillSpec {
  variant: "info" | "warn" | "draft" | "accent";
  label: string;
  strikethrough: boolean;
  amountColor: string;
}

const statusPillSpec = (status: OrderRecord["status"]): StatusPillSpec => {
  switch (status) {
    case "paid":
      return {
        variant: "info",
        label: "PAID",
        strikethrough: false,
        amountColor: textTokens.primary,
      };
    case "refunded_full":
      return {
        variant: "warn",
        label: "REFUNDED",
        strikethrough: true,
        amountColor: textTokens.tertiary,
      };
    case "refunded_partial":
      return {
        variant: "accent",
        label: "PARTIAL",
        strikethrough: false,
        amountColor: textTokens.primary,
      };
    case "cancelled":
      return {
        variant: "draft",
        label: "CANCELLED",
        strikethrough: true,
        amountColor: textTokens.tertiary,
      };
    default: {
      const _exhaust: never = status;
      return _exhaust;
    }
  }
};

const summarizeLines = (lines: OrderRecord["lines"]): string => {
  if (lines.length === 0) return "—";
  if (lines.length === 1) {
    const line = lines[0];
    return `${line.quantity}× ${line.ticketNameAtPurchase}`;
  }
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  return `${totalQty} tickets`;
};

export const OrderListCard: React.FC<OrderListCardProps> = ({
  order,
  onPress,
}) => {
  const { spec, hue, initials, amountLabel, subline } = useMemo(() => {
    return {
      spec: statusPillSpec(order.status),
      hue: hashStringToHue(order.id),
      initials: getInitials(order.buyer.name),
      amountLabel: order.totalGbpAtPurchase === 0
        ? "Free"
        : formatGbpRound(order.totalGbpAtPurchase),
      subline: `${order.id} · ${summarizeLines(order.lines)} · ${formatRelativeTime(order.paidAt)}`,
    };
  }, [order]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Order from ${order.buyer.name}, ${summarizeLines(order.lines)}, ${amountLabel}, ${spec.label}`}
      style={({ pressed }) => [styles.host, pressed && styles.hostPressed]}
    >
      <View
        style={[
          styles.avatar,
          { backgroundColor: `hsl(${hue}, 60%, 45%)` },
        ]}
      >
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {order.buyer.name.trim().length > 0 ? order.buyer.name : "Anonymous"}
        </Text>
        <Text style={styles.subline} numberOfLines={1}>
          {subline}
        </Text>
      </View>
      <View style={styles.right}>
        <Text
          style={[
            styles.amount,
            { color: spec.amountColor },
            spec.strikethrough && styles.amountStrike,
          ]}
        >
          {amountLabel}
        </Text>
        <View style={styles.pillSlot}>
          <Pill variant={spec.variant}>{spec.label}</Pill>
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  hostPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
  subline: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  right: {
    alignItems: "flex-end",
    gap: 4,
    flexShrink: 0,
  },
  amount: {
    fontSize: 14,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  amountStrike: {
    textDecorationLine: "line-through",
  },
  pillSlot: {
    transform: [{ scale: 0.85 }],
  },
});

export default OrderListCard;
