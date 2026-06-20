/**
 * @mingla/offering-rendering — shared <RefundPolicyDisplay /> (refund ladder).
 *
 * ORCH-1016: extracted from mingla-business/src/components/trip/RefundPolicyDisplay.tsx
 * (ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]) so the consumer-app trip
 * detail and the business public/preview pages render the IDENTICAL ladder
 * (copy + semantics LOCKED). Package-isolated per I-MOR-0827-PACKAGE-ISOLATION:
 * imports nothing from any app src/; tokens are inlined to match the business
 * dark-canvas values (text/accent) byte-for-byte, and the RefundPolicy shape is
 * a local structural type so neither app's service layer leaks in.
 *
 * Business side becomes a re-export shim (same pattern as EventCoverMedia,
 * COMMS-0007). The ladder COPY ("Cancel N+ days before start", "No refund",
 * "CANCELLATION POLICY", "You're here…") is the LOCKED contract.
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

// ── Local structural type (mirrors mingla-business refundPolicyService) ──
export interface RefundPolicyTier {
  /** Integer >= 0 — days before trip start. */
  days_before_start: number;
  /** Integer 0-100 — refund percentage at this tier. */
  refund_pct: number;
}
export interface RefundPolicyShape {
  kind: "flexible" | "standard" | "strict" | "custom";
  /** Sorted DESC by days_before_start; refund_pct non-increasing. */
  tiers: RefundPolicyTier[];
}

// ── Inlined tokens (match mingla-business designSystem accent/text values) ──
const T = {
  accentWarm: "#eb7825",
  textPrimary: "rgba(255, 255, 255, 0.96)",
  textTertiary: "rgba(255, 255, 255, 0.52)",
  textQuaternary: "rgba(255, 255, 255, 0.32)",
  connector: "rgba(255, 255, 255, 0.04)",
  spaceXs: 4,
  spaceSm: 8,
};

export interface RefundPolicyDisplayProps {
  policy: RefundPolicyShape | null;
  /**
   * When set, highlights the currently-applicable tier with accent.warm left
   * border + "You're here →" caption. Used on buyer cancel preview only.
   * Omit for plain public/detail render.
   */
  currentTierIndex?: number;
  /** Optional days-remaining label for the "You're here" caption. */
  daysRemaining?: number;
}

interface DisplayTier {
  index: number;
  label: string;
  refundLabel: string;
  isNoRefund: boolean;
}

function buildDisplayTiers(policy: RefundPolicyShape | null): DisplayTier[] {
  if (policy === null || policy.tiers.length === 0) {
    return [];
  }
  return policy.tiers.map((tier, idx, arr) => {
    const isLast = idx === arr.length - 1;
    const isNoRefund = tier.refund_pct === 0;
    let label: string;
    if (idx === 0) {
      label = `Cancel ${tier.days_before_start}+ days before start`;
    } else if (isLast && tier.days_before_start === 0) {
      const prev = arr[idx - 1];
      label = `Cancel within ${prev.days_before_start} days`;
    } else {
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
  container: { paddingVertical: T.spaceSm },
  empty: { paddingVertical: T.spaceSm },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: T.accentWarm,
    marginBottom: T.spaceSm,
  },
  emptyCopy: { fontSize: 14, color: T.textTertiary },
  timeline: { flexDirection: "column" },
  row: { flexDirection: "row", alignItems: "stretch", paddingVertical: T.spaceXs },
  rowCurrent: {
    borderLeftWidth: 3,
    borderLeftColor: T.accentWarm,
    paddingLeft: T.spaceSm,
    backgroundColor: "transparent",
  },
  markerColumn: { width: 20, alignItems: "center" },
  marker: {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    backgroundColor: T.accentWarm,
    marginTop: 6,
  },
  markerMuted: { backgroundColor: T.textQuaternary },
  markerCurrent: {
    width: MARKER_SIZE + 4,
    height: MARKER_SIZE + 4,
    borderRadius: (MARKER_SIZE + 4) / 2,
    marginTop: 4,
  },
  connector: {
    flex: 1,
    width: CONNECTOR_WIDTH,
    backgroundColor: T.connector,
    marginTop: 4,
  },
  connectorMuted: { opacity: 0.5 },
  textColumn: { flex: 1, paddingLeft: T.spaceSm, paddingBottom: T.spaceSm },
  label: { fontSize: 14, color: T.textPrimary },
  labelMuted: { color: T.textTertiary },
  refund: { fontSize: 14, fontWeight: "600", color: T.textPrimary, marginTop: 2 },
  refundMuted: { color: T.textTertiary, fontWeight: "400" },
  youAreHere: { fontSize: 12, color: T.accentWarm, marginTop: 4, fontStyle: "italic" },
});

export default RefundPolicyDisplay;
