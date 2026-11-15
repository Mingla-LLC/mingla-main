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
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { formatExperienceDateSubline } from "../../utils/experienceDateSubline";
import type {
  PublicExperience,
  PublicExperienceBrand,
} from "../../services/publicExperienceService";

// issue #2101 [named-buyer checkout] — the SOLE public explanatory UI for a
// restricted sale, mounted in the content flow (Amendment 1 §A7). Renders null
// when the sale is unrestricted or the viewer is allowed.
import { TicketCheckoutAccessNotice } from "../event/TicketCheckoutAccessNotice";
// #3372 — naira shows "₦", not "NGN" (#3341 rule).
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

export interface ExperienceCheckoutFlowProps {
  experience: PublicExperience;
  brand: PublicExperienceBrand;
  testID?: string;
}

function formatPriceMajor(priceCents: number, currency: string): string {
  if (priceCents === 0) return "Free";
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(priceCents / 100),
      currency,
    );
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
          <Icon name="check" size={14} color={color.accent} />
        </View>
      </View>

      {isEnded ? (
        <View style={styles.endedBanner}>
          <Text style={styles.endedText}>This experience has ended.</Text>
        </View>
      ) : null}

      <TicketCheckoutAccessNotice eventId={experience.id} />

      <Text style={styles.helper}>
        You&rsquo;ll enter your details + pay securely on the next screen.
        Stripe handles the payment; Mingla never sees your card.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    padding: space[6],
    gap: space[4],
  },
  brandByline: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  ticketCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    padding: space[6],
    borderRadius: radiusTokens.lg,
    backgroundColor: color.accentTint,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  ticketTextCol: {
    flex: 1,
  },
  ticketName: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  ticketPrice: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: "700",
    color: color.text1,
    marginTop: 2,
  },
  ticketSubline: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: 4,
  },
  ticketBadge: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: color.accentTint,
  },
  endedBanner: {
    padding: space[4],
    borderRadius: radiusTokens.md,
    backgroundColor: color.errorTint,
    borderWidth: 1,
    borderColor: color.errorLine,
  },
  endedText: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  helper: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    textAlign: "center",
  },
  errorText: {
    fontSize: type.small.fontSize,
    color: color.text2,
    textAlign: "center",
  },
});

export default ExperienceCheckoutFlow;
