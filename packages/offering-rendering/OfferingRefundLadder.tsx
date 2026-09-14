/**
 * OfferingRefundLadder — META-ORCH-1174 Leg A [trip-page-standardize]; renamed and
 * given an offering type by issue #3284 [refund terms on events and experiences].
 *
 * THE ONE promoted palette-driven cancellation-policy ladder. Replaces the two
 * near-identical forks: the business inline trip ladder (TripPreview :872-931)
 * + the consumer `app-mobile/src/components/offering/ConsumerRefundLadder.tsx`.
 * Both were already palette-driven; this is their single shared owner.
 *
 * #3284 — it now renders on THREE public pages, so it is no longer trip-named.
 * The barrel keeps `TripRefundLadder` as an alias, and the trip body imports it
 * under that name, so the trip page is unchanged. `offeringType` selects the only
 * strings that vary (design part 2 §4.7):
 *   - the first window label names the offering ("before departure" / "before
 *     the event" / "before the experience");
 *   - event and experience pages close with "To cancel, contact {host}. Refunds
 *     follow the windows above." — trips have their own buyer cancel flow;
 *   - on an event or experience whose every tier refunds 0%, the strip reads
 *     "All sales are final — no refunds." and no rows render;
 *   - on a PAID event or experience with no published terms, the section is one
 *     plain disclosure: "No refund policy set. Ask {host} before you buy|book."
 *     It states a true fact and invents no terms (design part 1 §3.10).
 * Whether to mount at all (unknown state, cancelled or ended offering, free
 * offering) is decided by the BODY, never here: this component only ever sees
 * `policy | null`.
 *
 * Accessibility (applies to trips too): the heading is a header, each row is one
 * accessible element read by its label, and the decorative check glyph is hidden
 * from assistive tech. A zero value reads in secondary text, never tertiary.
 *
 * Static content inside a scrolling body: no Animated value and no CSS transition
 * style anywhere in this file (a hidden pane freezes transitions at t=0, which
 * would paint the terms invisible).
 *
 * Pure-presentational (I-MOR-0827). Rule 9: renders ONLY when a real policy, a
 * deadline, or the paid no-policy disclosure applies. Renders its OWN
 * "Cancellation policy" section heading (so a body just drops it in).
 */

// No React import: JSX compiles through the automatic runtime on every consumer
// (as in VenueMapsActions). #3284 dropped it with `React.FC`: in the business
// typecheck graph this package cannot resolve `react`, so `React.FC` read as
// `any` and left every destructured prop implicitly typed. The props are typed
// where they are destructured instead; the rendered output is unchanged.
import { StyleSheet, Text, View } from "react-native";

import type { OfferingSurfaceStyles, ThemePalette } from "./themePalette";
import type { OfferingRefundPolicy, OfferingRefundTier } from "./offeringRefundPolicy";

export type OfferingRefundLadderType = "trip" | "event" | "experience";

const REFUND_KIND_COPY: Record<OfferingRefundPolicy["kind"], string> = {
  flexible:
    "Flexible — cancel for a full or partial refund based on how early you cancel.",
  standard:
    "Standard — partial refunds up to the cutoff, based on how early you cancel.",
  strict: "Strict — limited refunds; review the cancellation windows below.",
  custom: "Cancel for a refund based on the windows below.",
};

const ALL_SALES_FINAL_COPY = "All sales are final — no refunds.";

/** Used when the brand has no usable display name. */
const HOST_FALLBACK = "the organizer";

/** The noun the first window counts back from. */
const FIRST_WINDOW_NOUN: Record<OfferingRefundLadderType, string> = {
  trip: "departure",
  event: "the event",
  experience: "the experience",
};

function refundTierLabel(
  tier: { days_before_start: number },
  index: number,
  tiers: readonly { days_before_start: number }[],
  offeringType: OfferingRefundLadderType,
): string {
  const isLast = index === tiers.length - 1;
  if (index === 0) {
    return `${tier.days_before_start}+ days before ${FIRST_WINDOW_NOUN[offeringType]}`;
  }
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

const resolveHost = (hostName: string | null): string => {
  const trimmed = hostName === null ? "" : hostName.trim();
  return trimmed.length > 0 ? trimmed : HOST_FALLBACK;
};

const everyTierRefundsNothing = (tiers: readonly OfferingRefundTier[]): boolean =>
  tiers.length > 0 && tiers.every((tier) => tier.refund_pct === 0);

export interface OfferingRefundLadderProps {
  policy: OfferingRefundPolicy | null;
  /**
   * Trips only. Events and experiences never pass it: per-tier sale windows are
   * their single cutoff authority (#3284 §3.3). Default null.
   */
  bookingDeadline?: string | null;
  /** Selects the copy table. Default "trip" keeps every trip string unchanged. */
  offeringType?: OfferingRefundLadderType;
  /**
   * Read only when `policy === null` on an event or experience: true renders the
   * no-policy disclosure, false renders nothing (there is no money to refund).
   * Default true.
   */
  isPaid?: boolean;
  /** The brand's display name for the closing line and the disclosure. */
  hostName?: string | null;
  palette: ThemePalette;
  surface: OfferingSurfaceStyles;
  /** Bold (700-weight) loaded family for the section title (native bold). */
  fontFamily?: string;
  testID?: string;
}

/** Kept for one release so trip-named imports still type-check. */
export type TripRefundLadderProps = OfferingRefundLadderProps;

export const OfferingRefundLadder = ({
  policy,
  bookingDeadline = null,
  offeringType = "trip",
  isPaid = true,
  hostName = null,
  palette,
  surface,
  fontFamily,
  testID,
}: OfferingRefundLadderProps) => {
  const isTrip = offeringType === "trip";
  const tiers = policy !== null ? policy.tiers : [];
  const deadlineLabel = isTrip ? formatDeadline(bookingDeadline) : null;
  const allSalesFinal = !isTrip && policy !== null && everyTierRefundsNothing(tiers);
  const showDisclosure = !isTrip && policy === null && isPaid;

  // rule 9 — nothing to render.
  if (policy === null && deadlineLabel === null && !showDisclosure) return null;

  const titleStyle = fontFamily !== undefined ? { fontFamily } : null;
  const host = resolveHost(hostName);

  return (
    <View style={styles.section} testID={testID}>
      <Text
        accessibilityRole="header"
        style={[styles.secTitle, surface.primaryText, titleStyle]}
      >
        Cancellation policy
      </Text>
      {policy !== null ? (
        <View style={[styles.strip, surface.card]}>
          {allSalesFinal ? null : (
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[styles.stripGlyph, { color: palette.accent }]}
            >
              ✓
            </Text>
          )}
          <Text style={[styles.stripText, surface.secondaryText]}>
            {allSalesFinal ? ALL_SALES_FINAL_COPY : REFUND_KIND_COPY[policy.kind]}
          </Text>
        </View>
      ) : null}
      {showDisclosure ? (
        <View style={[styles.strip, surface.card]}>
          <Text style={[styles.stripText, surface.secondaryText]}>
            {`No refund policy set. Ask ${host} before you ${
              offeringType === "experience" ? "book" : "buy"
            }.`}
          </Text>
        </View>
      ) : null}
      {tiers.length > 0 && !allSalesFinal ? (
        <View style={styles.refundLadder}>
          {tiers.map((tier, index) => {
            const isZero = tier.refund_pct === 0;
            const label = refundTierLabel(tier, index, tiers, offeringType);
            return (
              <View
                key={`rl-${index}`}
                accessible
                style={[
                  styles.rlRow,
                  index > 0
                    ? { borderTopWidth: 1, borderTopColor: palette.panelBorder }
                    : null,
                ]}
                accessibilityLabel={`${label}: ${
                  isZero ? "no refund" : `${tier.refund_pct}% refund`
                }`}
              >
                <Text style={[styles.rlLabel, surface.secondaryText]}>
                  {label}
                </Text>
                <Text
                  style={[
                    styles.rlPct,
                    {
                      color: isZero ? palette.secondaryText : palette.primaryText,
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
      {!isTrip && policy !== null && !allSalesFinal ? (
        <Text style={[styles.closingNote, surface.secondaryText]}>
          {`To cancel, contact ${host}. Refunds follow the windows above.`}
        </Text>
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
  section: { marginTop: 24 },
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
  stripGlyph: { fontSize: 15, fontWeight: "900", marginTop: 1 },
  stripText: { flex: 1, fontSize: 13, lineHeight: 18 },
  refundLadder: { marginTop: 8 },
  rlRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 7,
  },
  rlLabel: { flexShrink: 1, fontSize: 13 },
  rlPct: { fontSize: 13, fontWeight: "800" },
  closingNote: { fontSize: 13, lineHeight: 18, marginTop: 12 },
});

export default OfferingRefundLadder;
