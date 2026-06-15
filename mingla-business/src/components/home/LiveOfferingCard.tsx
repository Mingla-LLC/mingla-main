/**
 * LiveOfferingCard — ORCH-1143 [business Home live-card: scan parity + carousel].
 *
 * The reusable per-offering "live now" card, lifted token-for-token from the
 * former inline hero block in `app/(tabs)/home.tsx`. It renders for ANY live
 * offering kind (event / experience / trip): the live pill, name, date,
 * revenue (the hero number), an optional sold-vs-capacity progress bar, the
 * sold / capacity / scanned stat row, and a single primary action — the
 * "Scan QR codes" button.
 *
 * The parent (`home.tsx`) owns metric computation (revenue/sold/capacity/
 * progress) via `useEventSalesSummaries`; this component is presentational and
 * normalizes only `name` + `dateLine` for display (trips adapt via
 * `tripToLiveEvent`).
 *
 * ORCH-1143 — scan button on EVERY live kind (event/experience/trip). The scan
 * backend (biz_ticket_scan) + /event/[id]/scanner are event-type-agnostic —
 * INVESTIGATE_ORCH-1143 verdict A/A/A. Do NOT re-gate to kind==="event"
 * (regresses experience/trip scan). I-PROPOSED-ORCH1143-LIVE-SCAN-ALL-KINDS.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { LiveEvent } from "../../store/liveEventStore";
import type { Trip } from "../../services/tripsService";
import type { UpcomingItem } from "../../utils/upcomingBuilder";
import { formatDraftDateLine } from "../../utils/eventDateDisplay";
import { tripToLiveEvent } from "../../utils/tripToLiveEvent";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";

/** Display metrics computed by the parent (one-owner-per-truth for sales). */
export interface LiveCardMetrics {
  /** Currency-aware revenue string (e.g. "$0" / "₦1,200" / "£40"). */
  revenueLabel: string;
  /** Tickets-sold value, already formatted (or "Unable" on a summary error). */
  soldValue: string;
  /** Capacity label, already formatted ("—" / "Unlimited" / a number). */
  capacityLabel: string;
  /** Finite capacity (null ⇒ no progress bar rendered). */
  capacity: number | null;
  /** 0..1 sold-vs-capacity fraction. */
  progress: number;
}

export interface LiveOfferingCardProps {
  item: UpcomingItem;
  metrics: LiveCardMetrics;
  onScanPress: (id: string) => void;
  /** Set by the carousel parent. Undefined ⇒ full-width (single-live). */
  width?: number;
  testID?: string;
}

const getEventName = (name: string, fallback: string): string =>
  name.trim().length > 0 ? name : fallback;

export const LiveOfferingCard: React.FC<LiveOfferingCardProps> = ({
  item,
  metrics,
  onScanPress,
  width,
  testID,
}) => {
  // Display-only normalization. Trips adapt to a LiveEvent-shaped view for the
  // name + date line; events/experiences are already LiveEvent.
  const displayEvent: LiveEvent | null =
    item.kind === "trip"
      ? tripToLiveEvent(item.source as Trip)
      : (item.source as LiveEvent);

  const name = getEventName(displayEvent?.name ?? "", "Untitled");
  const dateLine =
    displayEvent !== null ? formatDraftDateLine(displayEvent) : "";

  return (
    <GlassCard
      variant="elevated"
      padding={spacing.lg}
      style={width !== undefined ? { width } : undefined}
      testID={testID}
    >
      <View style={styles.liveTagRow}>
        <Pill variant="live" livePulse>
          Live now
        </Pill>
      </View>
      <Text style={styles.offeringName}>{name}</Text>
      <Text style={styles.offeringDate}>{dateLine}</Text>

      <View style={styles.amountRow}>
        <Text style={styles.amountValue}>{metrics.revenueLabel}</Text>
        <Text style={styles.amountSuffix}> revenue</Text>
      </View>

      {metrics.capacity !== null ? (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round(metrics.progress * 100)}%` },
            ]}
          />
        </View>
      ) : null}

      <View style={styles.statRow}>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{metrics.soldValue}</Text>
          <Text style={styles.statLabel}>Tickets sold</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{metrics.capacityLabel}</Text>
          <Text style={styles.statLabel}>Capacity</Text>
        </View>
        <View style={styles.statCell}>
          {/* ORCH-1143 — honest-empty (Constitution #9): no per-offering
              scanned-count source exists. NEVER fabricate a number. */}
          <Text style={styles.statValue}>—</Text>
          <Text style={styles.statLabel}>Scanned</Text>
        </View>
      </View>

      {/* ORCH-1143 — scan button on EVERY live kind (event/experience/trip).
          The scan backend (biz_ticket_scan) + /event/[id]/scanner are
          event-type-agnostic — INVESTIGATE_ORCH-1143 verdict A/A/A. Do NOT
          re-gate to kind==="event" (regresses experience/trip scan).
          I-PROPOSED-ORCH1143-LIVE-SCAN-ALL-KINDS. */}
      <Pressable
        onPress={() => onScanPress(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`Scan tickets for ${name}`}
        style={({ pressed }) => [
          styles.scanButton,
          pressed && styles.scanButtonPressed,
        ]}
        testID="home-live-card-scan-button"
      >
        <Icon name="qr" size={18} color={accent.warm} />
        <Text style={styles.scanButtonText}>Scan QR codes</Text>
      </Pressable>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  liveTagRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  offeringName: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: 2,
  },
  offeringDate: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginBottom: 4,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: spacing.md,
  },
  amountValue: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: textTokens.primary,
  },
  amountSuffix: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "500",
    color: textTokens.tertiary,
  },
  progressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  progressFill: {
    height: "100%",
    backgroundColor: accent.warm,
    borderRadius: 999,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statCell: {
    flex: 1,
  },
  statValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
  statLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  // ORCH-1143 — contained, full-width warm-tinted primary action. Replaces the
  // bare orange text link (heroScanAction) so the scan affordance reads as a
  // clear ≥44pt button on every card, incl. inside the horizontal carousel.
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    marginTop: spacing.lg,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: accent.tint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    paddingHorizontal: spacing.md,
  },
  scanButtonPressed: {
    opacity: 0.7,
  },
  scanButtonText: {
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
    letterSpacing: typography.buttonMd.letterSpacing,
    color: accent.warm,
  },
});

export default LiveOfferingCard;
