/**
 * ExperienceCheckoutFlow — buyer-side experience checkout entry.
 * META-ORCH-1059 Sub-D. Mirrors TripCheckoutFlow: a thin CTA that routes into
 * the experience buyer chain at /checkout-experience/{experienceEventId}.
 *
 * Experiences sell as ONE ticket (the whole itinerary) — there is no per-stop
 * or multi-tier selection at checkout. The single ticket_types row is resolved
 * server-side; the buyer just taps "Reserve" (DISC-1153-B: the old "Get my spot"
 * verb was retired — every experience CTA reads "Reserve" across all surfaces).
 *
 * COMMS-0014/0016 (BLOCK-grade): the underlying money path is the EXISTING
 * `ticket-checkout-create` edge fn keyed on the experience's events-row id.
 * This component adds ZERO new payment UI and ZERO money-engine code — it only
 * provides experience-specific entry copy + routing, exactly as
 * TripCheckoutFlow does for trips. Event-side /checkout/[eventId] hard-rejects
 * non-event rows by audit-test invariant, so experiences route into their own
 * chain.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { formatExperienceDateSubline } from "../../utils/experienceDateSubline";
import type {
  PublicExperience,
  PublicExperienceBrand,
} from "../../services/publicExperienceService";

export interface ExperienceCheckoutFlowProps {
  experience: PublicExperience;
  brand: PublicExperienceBrand;
  testID?: string;
}

function formatPriceMajor(priceCents: number, currency: string): string {
  if (priceCents === 0) return "Free";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(priceCents / 100);
  } catch {
    return `${(priceCents / 100).toFixed(2)} ${currency}`;
  }
}

/** True when every materialised date is in the past (the run has ended). */
function allDatesPast(isos: string[], nowMs: number = Date.now()): boolean {
  const valid = isos
    .map((iso) => new Date(iso).getTime())
    .filter((ms) => Number.isFinite(ms));
  if (valid.length === 0) return false;
  return valid.every((ms) => ms < nowMs);
}

export const ExperienceCheckoutFlow: React.FC<ExperienceCheckoutFlowProps> = ({
  experience,
  brand,
  testID,
}) => {
  const ticket = experience.ticket;
  const dateIsos = experience.dates.map((d) => d.startAt);
  const isEnded = allDatesPast(dateIsos);

  // ORCH-1117 — the inline Get-spot CTA is REMOVED (locked single-ticket rule).
  // The floating Buy bar on /exp/[brandSlug]/[experienceSlug] is now the ONLY
  // get-spot action and owns navigation to `/checkout-experience/{id}`
  // (experienceCheckoutPath). This flow keeps the ticket recap + helper only.

  if (ticket === null) {
    return (
      <View style={styles.host} testID={testID}>
        <Text style={styles.errorText}>
          This experience isn&rsquo;t on sale yet.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.host} testID={testID}>
      <Text style={styles.brandByline}>by {brand.name}</Text>
      <Text style={styles.title}>{experience.title}</Text>

      <View style={styles.ticketCard}>
        <View style={styles.ticketTextCol}>
          <Text style={styles.ticketName}>{ticket.name}</Text>
          <Text style={styles.ticketPrice}>
            {/* ORCH-1147/1153 WS3 (F-8): render the SERVER all-in, never the bare
                base. priceAllInGbp is MAJOR units (allInCents/100); formatPriceMajor
                expects CENTS (it ÷100), so ×100 back to cents. Falls back to
                priceCents when the all-in is absent/0 (absorb-fee brand: identical). */}
            {formatPriceMajor(
              typeof ticket.priceAllInGbp === "number" && ticket.priceAllInGbp > 0
                ? Math.round(ticket.priceAllInGbp * 100)
                : ticket.priceCents,
              ticket.currency,
            )}
          </Text>
          <Text style={styles.ticketSubline} numberOfLines={1}>
            {formatExperienceDateSubline({
              venueText: experience.venueText,
              dateStartIsos: dateIsos,
              whenMode: experience.whenMode,
              recurrenceRule: experience.recurrenceRule,
            })}
          </Text>
        </View>
        <View style={styles.ticketBadge}>
          <Icon name="check" size={14} color={accent.warm} />
        </View>
      </View>

      {isEnded ? (
        <View style={styles.endedBanner}>
          <Text style={styles.endedText}>This experience has ended.</Text>
        </View>
      ) : null}

      <Text style={styles.helper}>
        You&rsquo;ll enter your details + pay securely on the next screen.
        Stripe handles the payment; Mingla never sees your card.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  brandByline: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
  },
  ticketCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(235, 120, 37, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.5)",
  },
  ticketTextCol: {
    flex: 1,
  },
  ticketName: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  ticketPrice: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
    marginTop: 2,
  },
  ticketSubline: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 4,
  },
  ticketBadge: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(235, 120, 37, 0.16)",
  },
  endedBanner: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
  },
  endedText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  helper: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  errorText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
  },
});

export default ExperienceCheckoutFlow;
