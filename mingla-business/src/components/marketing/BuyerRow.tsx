/**
 * BuyerRow — single shared row component (ORCH-0815-A2-ui).
 *
 * Used by THREE surfaces (per I-PROPOSED-BT single-source invariant):
 *   - Brand Customers tab (`mingla-business/app/brand/[id]/customers.tsx`)
 *   - Event Buyers tab    (`mingla-business/app/event/[id]/buyers/index.tsx`)
 *   - Marketing → Audience detail (sub-ORCH-B)
 *
 * Renders per design §7.3 + §7.7:
 *   Line 1 — display name
 *   Line 2 — masked email · order count · total spend
 *   Line 3 — last event · relative date
 *   Line 4 — consent state chips (email OK / sms OK / transactional only)
 *
 * Press feedback: 120ms background flash to glass.tint.profileElevated.
 *
 * Accessibility: ≥44pt tap (96pt row height) + `accessibilityLabel`
 * describing the buyer's identity, order count, total spend, and consent
 * state (I-38 + I-39).
 */

import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { BuyerRowData } from "../../types/marketing";

export interface BuyerRowProps {
  buyer: BuyerRowData;
  onPress?: (buyer: BuyerRowData) => void;
}

const ROW_HEIGHT = 96;

function formatRelativeDate(iso: string | null): string {
  if (iso === null) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / day);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

function formatSpend(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(2);
  // Honest currency display per Constitution #10 — never localize-by-guess.
  // Callers may pass currency in any ISO-4217 form; "USD" → "$"; otherwise
  // fall back to the raw code so the value is never fabricated.
  const symbolMap: Record<string, string> = {
    USD: "$",
    GBP: "£",
    EUR: "€",
  };
  const symbol = symbolMap[currency.toUpperCase()] ?? `${currency} `;
  return `${symbol}${major}`;
}

export const BuyerRow: React.FC<BuyerRowProps> = ({ buyer, onPress }) => {
  const handlePress = (): void => {
    if (onPress !== undefined) onPress(buyer);
  };

  const consentLine = useMemo(() => {
    if (buyer.consent.email_marketing_ok && buyer.consent.sms_marketing_ok) {
      return { text: "marketing OK · SMS OK", tone: "ok" as const };
    }
    if (buyer.consent.email_marketing_ok) {
      return { text: "marketing OK", tone: "ok" as const };
    }
    if (buyer.consent.unsubscribed_global_scope) {
      return { text: "unsubscribed (all brands)", tone: "muted" as const };
    }
    if (buyer.consent.unsubscribed_brand_scope) {
      return { text: "unsubscribed", tone: "muted" as const };
    }
    return { text: "transactional only", tone: "muted" as const };
  }, [buyer.consent]);

  const accessibilityLabel = useMemo(() => {
    const contact = buyer.masked_email ?? buyer.masked_phone ?? "no contact";
    const eventBit =
      buyer.last_event_name !== null
        ? `last event ${buyer.last_event_name} ${formatRelativeDate(buyer.last_purchase_at)}`
        : "no event history";
    return `${buyer.display_name}, ${contact}, ${buyer.order_count} ${
      buyer.order_count === 1 ? "order" : "orders"
    }, ${formatSpend(buyer.total_spend_minor, buyer.total_spend_currency)} total, ${eventBit}, ${consentLine.text}`;
  }, [buyer, consentLine.text]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.row,
        pressed ? styles.rowPressed : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
    >
      <View style={styles.stack}>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
          {buyer.display_name}
        </Text>
        <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
          {buyer.masked_email ?? buyer.masked_phone ?? "no contact"}
          {" · "}
          {buyer.order_count} {buyer.order_count === 1 ? "order" : "orders"}
          {" · "}
          {formatSpend(buyer.total_spend_minor, buyer.total_spend_currency)}
        </Text>
        <Text style={styles.subMeta} numberOfLines={1} ellipsizeMode="tail">
          {buyer.last_event_name !== null
            ? `Last: ${buyer.last_event_name} · ${formatRelativeDate(buyer.last_purchase_at)}`
            : "No event history"}
        </Text>
        <Text
          style={[
            styles.consent,
            consentLine.tone === "ok" ? styles.consentOk : styles.consentMuted,
          ]}
          numberOfLines={1}
        >
          {consentLine.text}
        </Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  rowPressed: {
    backgroundColor: glass.tint.profileElevated,
  },
  stack: {
    gap: spacing.xxs,
  },
  name: {
    ...typography.body,
    color: textTokens.primary,
  },
  meta: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  subMeta: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  consent: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  consentOk: {
    color: semantic.success,
  },
  consentMuted: {
    color: textTokens.tertiary,
  },
});
