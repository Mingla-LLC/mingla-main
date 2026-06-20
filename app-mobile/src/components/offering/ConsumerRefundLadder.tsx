/**
 * ConsumerRefundLadder — ORCH-1138 Leg 1C (OQ-2 = port for parity).
 *
 * The palette-themed cancellation-policy ladder for the consumer trip detail,
 * mirroring the business FOUNDATION `RefundLadder` (TripPreview.tsx) so the
 * consumer surface matches the business/web trip page EXACTLY (themed `.strip` +
 * `.refund-ladder` rows). The consumer previously used the shared
 * `RefundPolicyDisplay`, which hardcodes warm-orange (#eb7825) — NOT the brand
 * palette. This bespoke ladder reads the SAME real `RefundPolicyShape.tiers`
 * (+ optional booking deadline) but themes off the resolved brand palette.
 *
 * Constitution rule 9: renders ONLY when a real policy and/or deadline is
 * present; an empty policy renders zero ladder rows.
 *
 * Anon-tolerant: pure presentational, no fetch, no useAuth.
 * I-MOR-0827: imports only @mingla/offering-rendering (the shared palette type) +
 * react-native — no mingla-business/src import.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { OfferingSurfaceStyles, ThemePalette } from "@mingla/offering-rendering";

import type { RefundPolicyShape } from "../../hooks/useConsumerTripDetail";

const REFUND_KIND_COPY: Record<RefundPolicyShape["kind"], string> = {
  flexible:
    "Flexible — cancel for a full or partial refund based on how early you cancel.",
  standard:
    "Standard — partial refunds up to the cutoff, based on how early you cancel.",
  strict: "Strict — limited refunds; review the cancellation windows below.",
  custom: "Cancel for a refund based on the windows below.",
};

function refundTierLabel(
  tier: { days_before_start: number },
  index: number,
  tiers: readonly { days_before_start: number }[],
): string {
  const isLast = index === tiers.length - 1;
  if (index === 0) return `${tier.days_before_start}+ days before departure`;
  if (isLast && tier.days_before_start === 0) {
    const prev = tiers[index - 1];
    return `Under ${prev.days_before_start} days`;
  }
  const prev = tiers[index - 1];
  return `${tier.days_before_start}–${prev.days_before_start - 1} days before`;
}

function formatDeadline(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

export interface ConsumerRefundLadderProps {
  policy: RefundPolicyShape | null;
  bookingDeadline: string | null;
  palette: ThemePalette;
  surface: OfferingSurfaceStyles;
  /** Bold (700-weight) loaded family for the section title (native bold). */
  boldFamily: string;
}

export const ConsumerRefundLadder: React.FC<ConsumerRefundLadderProps> = ({
  policy,
  bookingDeadline,
  palette,
  surface,
  boldFamily,
}) => {
  const tiers = policy !== null ? policy.tiers : [];
  const deadlineLabel = formatDeadline(bookingDeadline);

  // rule 9 — nothing to render.
  if (policy === null && deadlineLabel === null) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.secTitle, surface.primaryText, { fontFamily: boldFamily }]}>
        Cancellation policy
      </Text>
      {policy !== null ? (
        <View style={[styles.strip, surface.card]}>
          <Text style={[styles.stripGlyph, { color: palette.accent }]}>✓</Text>
          <Text style={[styles.stripText, surface.secondaryText]}>
            {REFUND_KIND_COPY[policy.kind]}
          </Text>
        </View>
      ) : null}
      {tiers.length > 0 ? (
        <View style={styles.refundLadder}>
          {tiers.map((tier, index) => {
            const isZero = tier.refund_pct === 0;
            return (
              <View
                key={`rl-${index}`}
                style={[
                  styles.rlRow,
                  index > 0
                    ? { borderTopWidth: 1, borderTopColor: palette.panelBorder }
                    : null,
                ]}
                accessibilityLabel={`${refundTierLabel(tier, index, tiers)}: ${
                  isZero ? "no refund" : `${tier.refund_pct}% refund`
                }`}
              >
                <Text style={[styles.rlLabel, surface.secondaryText]}>
                  {refundTierLabel(tier, index, tiers)}
                </Text>
                <Text
                  style={[
                    styles.rlPct,
                    {
                      color: isZero
                        ? palette.tertiaryText
                        : palette.primaryText,
                    },
                  ]}
                >
                  {isZero ? "No refund" : `${tier.refund_pct}% refund`}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {deadlineLabel !== null ? (
        <View style={[styles.strip, surface.card]}>
          <Text style={[styles.stripGlyph, { color: palette.accent }]}>⏱</Text>
          <Text style={[styles.stripText, surface.secondaryText]}>
            Bookings close {deadlineLabel}.
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginTop: 24,
  },
  secTitle: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  strip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  stripGlyph: {
    fontSize: 15,
    fontWeight: "900",
    marginTop: 1,
  },
  stripText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  refundLadder: {
    marginTop: 8,
  },
  rlRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 7,
  },
  rlLabel: {
    flexShrink: 1,
    fontSize: 13,
  },
  rlPct: {
    fontSize: 13,
    fontWeight: "800",
  },
});

export default ConsumerRefundLadder;
