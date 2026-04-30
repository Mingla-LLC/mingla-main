/**
 * Wizard Step 7 — Preview.
 *
 * Designer source: screens-creator.jsx lines 279-305 (CreatorStep7).
 * Two cards:
 *   - Mini event card (tappable → /event/[id]/preview)
 *   - Stripe-state-aware "Ready to publish" status card
 *
 * Status card variants per spec §3.9 Step 7:
 *   - paid + Stripe active OR free-only → green check "Ready to publish"
 *   - paid + Stripe NOT active → warn "Stripe required for paid tickets"
 *   - free-only + Stripe NOT active → green check "Ready to publish (free event)"
 *   - validation errors anywhere → warn "Some fields are missing"
 *
 * Free events bypass the Stripe gate per spec AC#33 / T-CYCLE-3-23.
 *
 * Per Cycle 3 spec §3.9 Step 7.
 */

import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  type Brand,
  type BrandStripeStatus,
} from "../../store/currentBrandStore";
import { computePublishability } from "../../utils/draftEventValidation";
import { formatGbpRound } from "../../utils/currency";
import {
  formatDraftDateLine,
  formatDraftDateSubline,
} from "../../utils/eventDateDisplay";

import { EventCover } from "../ui/EventCover";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

import { type StepBodyProps } from "./types";

interface CreatorStep7PreviewProps extends StepBodyProps {
  brand: Brand | null;
  onTapMiniCard: () => void;
}

const formatPriceLine = (tickets: { isFree: boolean; priceGbp: number | null }[]): string => {
  if (tickets.length === 0) return "No tickets yet";
  const allFree = tickets.every((t) => t.isFree);
  if (allFree) return "Free";
  const paidPrices = tickets
    .filter((t) => !t.isFree && t.priceGbp !== null)
    .map((t) => t.priceGbp ?? 0);
  if (paidPrices.length === 0) return "Free";
  const minPrice = Math.min(...paidPrices);
  return `From ${formatGbpRound(minPrice)}`;
};

export const CreatorStep7Preview: React.FC<CreatorStep7PreviewProps> = ({
  draft,
  brand,
  onTapMiniCard,
}) => {
  const stripeStatus: BrandStripeStatus = brand?.stripeStatus ?? "not_connected";
  const publishability = computePublishability(draft, stripeStatus);

  const handleMiniCardPress = useCallback((): void => {
    onTapMiniCard();
  }, [onTapMiniCard]);

  // Mini card content
  const dateLine = formatDraftDateLine(draft);
  const subline = formatDraftDateSubline(draft);
  const titleLine = draft.name.length > 0 ? draft.name : "Untitled event";
  const venueLine =
    draft.format === "online"
      ? "Online"
      : draft.venueName ?? "Set a venue in Step 3";
  const priceLine = formatPriceLine(draft.tickets);

  return (
    <View>
      {/* Mini event card — tappable to /event/[id]/preview */}
      <Pressable
        onPress={handleMiniCardPress}
        accessibilityRole="button"
        accessibilityLabel="Preview public page"
        style={styles.miniCard}
      >
        <View style={styles.miniCover}>
          <EventCover hue={draft.coverHue} radius={0} label="" height={140} />
        </View>
        <View style={styles.miniBody}>
          <Text style={styles.miniDate}>{dateLine}</Text>
          <Text style={styles.miniTitle} numberOfLines={1}>
            {titleLine}
          </Text>
          <Text style={styles.miniVenue} numberOfLines={1}>
            {venueLine} · {priceLine}
          </Text>
          {subline !== null ? (
            <View style={styles.recurrencePillRow}>
              <View style={styles.recurrencePill}>
                <Text style={styles.recurrencePillLabel}>{subline}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </Pressable>

      {/* Status card */}
      <View style={styles.statusCardWrap}>
        {publishability.status === "ready" ? (
          <ReadyCard
            isFreeOnly={!publishability.hasPaidTickets}
            brandSlug={brand?.slug ?? "your-brand"}
            draftName={titleLine}
          />
        ) : publishability.status === "blocked-stripe" ? (
          <StripeBlockedCard />
        ) : (
          <ErrorsBlockedCard count={publishability.errorCount} />
        )}
      </View>

      {/* Preview public page — relocated from dock to content flow.
          Sits directly under the Ready-to-publish status card so it
          reads as the natural follow-up to the publish summary, while
          the dock cleans up to a uniform Back + Publish across Steps
          2-7. */}
      <Pressable
        onPress={handleMiniCardPress}
        accessibilityRole="button"
        accessibilityLabel="Preview public page"
        style={styles.previewLinkBtn}
      >
        <Icon name="eye" size={16} color={accent.warm} />
        <Text style={styles.previewLinkLabel}>Preview public page</Text>
      </Pressable>
    </View>
  );
};

interface ReadyCardProps {
  isFreeOnly: boolean;
  brandSlug: string;
  draftName: string;
}

const ReadyCard: React.FC<ReadyCardProps> = ({ isFreeOnly, brandSlug, draftName }) => (
  <GlassCard variant="base" padding={spacing.md}>
    <View style={styles.statusRow}>
      <Icon name="check" size={20} color={semantic.success} />
      <View style={styles.statusTextCol}>
        <Text style={styles.statusTitle}>
          {isFreeOnly ? "Ready to publish (free event)" : "Ready to publish"}
        </Text>
        <Text style={styles.statusSub}>
          Tickets will go live at mingla.com/e/{brandSlug}/
          {draftName.toLowerCase().replace(/\s+/g, "-").slice(0, 24) || "event"}.
        </Text>
      </View>
    </View>
  </GlassCard>
);

const StripeBlockedCard: React.FC = () => (
  <GlassCard variant="base" padding={spacing.md} style={styles.warnCard}>
    <View style={styles.statusRow}>
      <Icon name="flag" size={20} color={accent.warm} />
      <View style={styles.statusTextCol}>
        <Text style={styles.statusTitle}>Stripe required for paid tickets</Text>
        <Text style={styles.statusSub}>
          Connect Stripe to publish. Free tickets can be published any time.
        </Text>
      </View>
    </View>
  </GlassCard>
);

interface ErrorsBlockedCardProps {
  count: number;
}

const ErrorsBlockedCard: React.FC<ErrorsBlockedCardProps> = ({ count }) => (
  <GlassCard variant="base" padding={spacing.md} style={styles.warnCard}>
    <View style={styles.statusRow}>
      <Icon name="flag" size={20} color={accent.warm} />
      <View style={styles.statusTextCol}>
        <Text style={styles.statusTitle}>
          {count === 1 ? "1 thing to fix" : `${count} things to fix`}
        </Text>
        <Text style={styles.statusSub}>
          Tap Publish to see what's missing.
        </Text>
      </View>
    </View>
  </GlassCard>
);

const styles = StyleSheet.create({
  miniCard: {
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    marginBottom: spacing.md,
  },
  miniCover: {
    height: 140,
    width: "100%",
  },
  miniBody: {
    padding: spacing.md,
  },
  miniDate: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: 4,
  },
  miniTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: textTokens.primary,
  },
  miniVenue: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
  recurrencePillRow: {
    flexDirection: "row",
    marginTop: spacing.xs,
  },
  recurrencePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  recurrencePillLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  statusCardWrap: {
    marginBottom: spacing.sm,
  },
  previewLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  previewLinkLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  statusTextCol: {
    flex: 1,
  },
  statusTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  statusSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
    lineHeight: typography.caption.lineHeight * 1.4,
  },
  warnCard: {
    borderColor: accent.border,
    borderWidth: 1,
  },
});
