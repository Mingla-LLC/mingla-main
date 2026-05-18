/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — <RefundPolicyDisplay />.
 *
 * Buyer-facing visual ladder per DESIGN_ORCH-0875 §5.2. Vertical timeline with
 * marker dots — Mingla's WeTravel-beat visual win. Time-sorted (longest notice
 * first, descending by days_before_start). Past-the-refund-window tiers render
 * in text.tertiary muted style with "No refund" wording.
 *
 * Optional `currentTierIndex` prop renders a "You're here →" callout on the
 * buyer cancel preview (DESIGN §5.2). When omitted, plain timeline (public
 * trip page render).
 *
 * Per SPEC_ORCH-0875 §3.5.4.
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { RefundPolicy } from "../../services/refundPolicyService";

export interface RefundPolicyDisplayProps {
  policy: RefundPolicy | null;
  /**
   * When set, highlights the currently-applicable tier with accent.warm left
   * border + "You're here →" caption. Used on buyer cancel preview only.
   * Omit for plain public trip page render.
   */
  currentTierIndex?: number;
  /**
   * Optional days-remaining label for the "You're here" caption (e.g., "10").
   * Only used when currentTierIndex is set.
   */
  daysRemaining?: number;
}

interface DisplayTier {
  index: number;
  label: string;
  refundLabel: string;
  isNoRefund: boolean;
}

function buildDisplayTiers(policy: RefundPolicy | null): DisplayTier[] {
  if (policy === null || policy.tiers.length === 0) {
    return [];
  }
  return policy.tiers.map((tier, idx, arr) => {
    const isLast = idx === arr.length - 1;
    const next = arr[idx + 1];
    const isNoRefund = tier.refund_pct === 0;
    // Label format depends on neighbours: "Cancel 60+ days before start",
    // "Cancel 30 to 59 days before", "Cancel within 30 days".
    let label: string;
    if (idx === 0) {
      // Top tier: "Cancel N+ days before start"
      label = `Cancel ${tier.days_before_start}+ days before start`;
    } else if (isLast && tier.days_before_start === 0) {
      // Bottom tier with 0 boundary: "Cancel within N days"
      // N = previous tier's days_before_start
      const prev = arr[idx - 1];
      label = `Cancel within ${prev.days_before_start} days`;
    } else {
      // Middle tier: "Cancel N to M-1 days before"
      const prev = arr[idx - 1];
      const lower = tier.days_before_start;
      const upper = prev.days_before_start - 1;
      label = `Cancel ${lower} to ${upper} days before`;
    }
    const refundLabel = isNoRefund ? "No refund" : `${tier.refund_pct}% refund`;
    return { index: idx, label, refundLabel, isNoRefund };
  });
}

export const RefundPolicyDisplay: React.FC<RefundPolicyDisplayProps> = ({
  policy,
  currentTierIndex,
  daysRemaining,
}) => {
  const tiers = useMemo(() => buildDisplayTiers(policy), [policy]);

  if (tiers.length === 0) {
    return (
      <View
        style={styles.empty}
        accessible
        accessibilityLabel="No cancellation policy set"
      >
        <Text style={styles.eyebrow}>CANCELLATION POLICY</Text>
        <Text style={styles.emptyCopy}>
          No cancellation policy set. Contact the organizer for refund terms.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="list"
      accessibilityLabel={`Cancellation policy with ${tiers.length} tiers`}
    >
      <Text style={styles.eyebrow}>CANCELLATION POLICY</Text>
      <View style={styles.timeline}>
        {tiers.map((tier) => {
          const isCurrent =
            currentTierIndex !== undefined && currentTierIndex === tier.index;
          const isLast = tier.index === tiers.length - 1;
          return (
            <View
              key={`tier-${tier.index}`}
              style={[styles.row, isCurrent && styles.rowCurrent]}
              accessible
              accessibilityRole={undefined}
              accessibilityLabel={`Tier ${tier.index + 1}: ${tier.label}, ${tier.refundLabel}${isCurrent ? ", you are here" : ""}`}
            >
              <View style={styles.markerColumn}>
                <View
                  style={[
                    styles.marker,
                    tier.isNoRefund && styles.markerMuted,
                    isCurrent && styles.markerCurrent,
                  ]}
                />
                {!isLast && (
                  <View
                    style={[
                      styles.connector,
                      tier.isNoRefund && styles.connectorMuted,
                    ]}
                  />
                )}
              </View>
              <View style={styles.textColumn}>
                <Text style={[styles.label, tier.isNoRefund && styles.labelMuted]}>
                  {tier.label}
                </Text>
                <Text
                  style={[styles.refund, tier.isNoRefund && styles.refundMuted]}
                >
                  {tier.refundLabel}
                </Text>
                {isCurrent && daysRemaining !== undefined && (
                  <Text style={styles.youAreHere}>
                    You're here — cancelling {daysRemaining} day
                    {daysRemaining === 1 ? "" : "s"} before
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const MARKER_SIZE = 10;
const CONNECTOR_WIDTH = 1;

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
  },
  empty: {
    paddingVertical: spacing.sm,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: accent.warm,
    marginBottom: spacing.sm,
  },
  emptyCopy: {
    fontSize: 14,
    color: textTokens.tertiary,
  },
  timeline: {
    flexDirection: "column",
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: spacing.xs,
  },
  rowCurrent: {
    borderLeftWidth: 3,
    borderLeftColor: accent.warm,
    paddingLeft: spacing.sm,
    backgroundColor: "transparent",
  },
  markerColumn: {
    width: 20,
    alignItems: "center",
  },
  marker: {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    backgroundColor: accent.warm,
    marginTop: 6,
  },
  markerMuted: {
    backgroundColor: textTokens.quaternary,
  },
  markerCurrent: {
    width: MARKER_SIZE + 4,
    height: MARKER_SIZE + 4,
    borderRadius: (MARKER_SIZE + 4) / 2,
    marginTop: 4,
  },
  connector: {
    flex: 1,
    width: CONNECTOR_WIDTH,
    backgroundColor: glass.border.profileBase,
    marginTop: 4,
  },
  connectorMuted: {
    opacity: 0.5,
  },
  textColumn: {
    flex: 1,
    paddingLeft: spacing.sm,
    paddingBottom: spacing.sm,
  },
  label: {
    fontSize: 14,
    color: textTokens.primary,
  },
  labelMuted: {
    color: textTokens.tertiary,
  },
  refund: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    marginTop: 2,
  },
  refundMuted: {
    color: textTokens.tertiary,
    fontWeight: "400",
  },
  youAreHere: {
    fontSize: 12,
    color: accent.warm,
    marginTop: 4,
    fontStyle: "italic",
  },
});
