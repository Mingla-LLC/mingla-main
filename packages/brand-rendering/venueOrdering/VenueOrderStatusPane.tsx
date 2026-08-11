// ===========================================================================
// Issue #1793 — the live order card the guest watches.
//
// SET-B: may sell, may never touch money. Every number here is read off
// `venue-order-status`, which computed them from the persisted order row.
//
// TWO CONTRACTS THIS FILE CARRIES.
//
// 1. D-3a — A COUNTER ORDER IS NEVER PROMISED DELIVERY. The branch is not a
//    guess about where the guest might be sitting; it is `pickup_code`, which
//    the server mints in exactly one branch (no spot) and never in the other.
//    All the copy comes from `venueOrderProgressCopy`, which is a pure function
//    with its own regression, so the promise cannot drift from the record.
//
// 2. D-7a — THE GUEST ALWAYS HAS A WAY OUT WHILE THE ORDER IS UNSERVED, and
//    nothing moves on a timer. Before the venue picks the order up, Cancel is a
//    full automatic refund. After they pick it up, the same button becomes a
//    REQUEST the venue answers, and this card says so plainly rather than
//    pretending the guest still has the money in their hand. Both flags are the
//    SERVER's (`canCancel` / `canRequestRefund`) — this file never derives
//    either from a timestamp of its own.
// ===========================================================================

// The package-local React bridge (see PublicVenueTabs.tsx): files under
// packages/ cannot discover the app's React peer, so importing "react"
// directly here would emit unresolved-peer diagnostics in both apps'
// isolated typecheck sandboxes. One bridge, reused by every shared renderer.
import { BrandRenderingReact as React } from "../PublicVenueTabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  offeringSurfaceStyles,
  ThemePalette,
} from "@mingla/offering-rendering";

import { formatMenuPrice } from "../PublicMenuSections";
import type { VenueOrderLiveStatus } from "./venueOrderingTypes";
import { venueOrderHandover, venueOrderProgressCopy } from "./venueOrderingRules";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

export interface VenueOrderStatusPaneProps {
  palette: ThemePalette;
  surface: Surface;
  live: VenueOrderLiveStatus;
  buyerName: string;
  actionPending: boolean;
  actionError: string | null;
  onCancel: () => void;
  onRequestRefund: () => void;
  /** Another round on the SAME sitting — the tip is not asked again (OQ-2). */
  onOrderMore: (() => void) | null;
}

export const VenueOrderStatusPane: React.FC<VenueOrderStatusPaneProps> = ({
  palette,
  surface,
  live,
  buyerName,
  actionPending,
  actionError,
  onCancel,
  onRequestRefund,
  onOrderMore,
}) => {
  const handover = venueOrderHandover(live, buyerName);
  const copy = venueOrderProgressCopy(live.fulfillmentStatus, handover);
  const money = (cents: number): string =>
    formatMenuPrice(cents, live.totals.currency) ?? "—";
  const awaitingPayment = live.paymentStatus === "pending";

  return (
    <View style={styles.wrap}>
      <View style={[styles.card, surface.cardStrong, styles.hero]}>
        {handover.kind === "counter" && handover.pickupCode !== null ? (
          <View
            style={[styles.codeBadge, { backgroundColor: palette.accent }]}
            accessibilityLabel={`Your pickup code is ${handover.pickupCode}`}
          >
            <Text style={[styles.codeLabel, { color: palette.accentText }]}>
              {`COLLECT · ${handover.pickupCode}`}
            </Text>
          </View>
        ) : null}
        <Text style={[styles.heroTitle, { color: palette.primaryText }]}>
          {awaitingPayment ? "Finishing your payment…" : copy.title}
        </Text>
        <Text style={[styles.heroBody, { color: palette.secondaryText }]}>
          {awaitingPayment
            ? "We're confirming with your bank. This card updates itself."
            : copy.body}
        </Text>
        {/* D-7 escalation honesty: the guest is TOLD, and the way out is in
            their hands the whole time. Never a countdown to an automatic
            reversal — money moves only when a person decides
            (I-PROPOSED-1767-NO-MONEY-ON-A-TIMER). */}
        {live.escalationLevel > 0 && live.acknowledgedAt === null &&
            !awaitingPayment
          ? (
            <Text style={[styles.heroNote, { color: palette.secondaryText }]}>
              Nobody at the venue has picked this up yet. We've told them again —
              and you can cancel for a full refund whenever you like.
            </Text>
          )
          : null}
      </View>

      <View style={[styles.card, surface.card, styles.block]}>
        <MoneyLine
          label="Items"
          value={money(live.totals.subtotalCents)}
          palette={palette}
        />
        {live.totals.serviceChargeCents > 0 ? (
          <MoneyLine
            label="Service charge"
            value={money(live.totals.serviceChargeCents)}
            palette={palette}
          />
        ) : null}
        <MoneyLine
          label="Fees & tax"
          value={money(live.totals.feesAndTaxCents)}
          palette={palette}
        />
        {live.totals.tipCents > 0 ? (
          <MoneyLine
            label="Tip"
            value={money(live.totals.tipCents)}
            palette={palette}
          />
        ) : null}
        <View style={[styles.rule, { backgroundColor: palette.panelBorder }]} />
        <MoneyLine
          label="Paid"
          value={money(live.totals.totalCents)}
          palette={palette}
          strong
        />
        {live.totals.refundedAmountCents > 0 ? (
          <MoneyLine
            label="Refunded"
            value={money(live.totals.refundedAmountCents)}
            palette={palette}
          />
        ) : null}
      </View>

      {live.refundRequestedAt !== null && live.refundDecision === null ? (
        <Text style={[styles.note, { color: palette.secondaryText }]}>
          Your refund request is with the venue. Nothing has moved yet — they'll
          decide, and we'll tell you either way.
        </Text>
      ) : null}
      {actionError === null ? null : (
        <Text style={[styles.note, { color: palette.secondaryText }]}>
          {actionError}
        </Text>
      )}

      <View style={styles.actions}>
        {live.canCancel ? (
          <Pressable
            onPress={onCancel}
            disabled={actionPending}
            accessibilityRole="button"
            accessibilityState={{ disabled: actionPending }}
            accessibilityLabel="Cancel this order and get a full refund"
            style={[styles.action, { borderColor: palette.panelBorder }]}
          >
            <Text style={[styles.actionLabel, { color: palette.primaryText }]}>
              {actionPending ? "One moment…" : "Cancel · full refund"}
            </Text>
          </Pressable>
        ) : null}
        {live.canRequestRefund ? (
          <Pressable
            onPress={onRequestRefund}
            disabled={actionPending}
            accessibilityRole="button"
            accessibilityState={{ disabled: actionPending }}
            accessibilityLabel="Ask the venue for a refund"
            style={[styles.action, { borderColor: palette.panelBorder }]}
          >
            <Text style={[styles.actionLabel, { color: palette.primaryText }]}>
              {actionPending ? "One moment…" : "Ask for a refund"}
            </Text>
          </Pressable>
        ) : null}
        {onOrderMore === null ? null : (
          <Pressable
            onPress={onOrderMore}
            accessibilityRole="button"
            accessibilityLabel="Order another round"
            style={[styles.action, { backgroundColor: palette.accent }]}
          >
            <Text style={[styles.actionLabel, { color: palette.accentText }]}>
              Order more
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

const MoneyLine: React.FC<{
  label: string;
  value: string;
  palette: ThemePalette;
  strong?: boolean;
}> = ({ label, value, palette, strong = false }) => (
  <View style={styles.moneyRow} accessibilityLabel={`${label} ${value}`}>
    <Text
      style={[
        strong ? styles.moneyLabelStrong : styles.moneyLabel,
        { color: strong ? palette.primaryText : palette.secondaryText },
      ]}
    >
      {label}
    </Text>
    <Text
      style={[
        strong ? styles.moneyValueStrong : styles.moneyValue,
        { color: palette.primaryText },
      ]}
    >
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  card: { borderRadius: 16, padding: 16 },
  hero: { gap: 8 },
  codeBadge: {
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  codeLabel: { fontSize: 18, lineHeight: 22, fontWeight: "900", letterSpacing: 1 },
  heroTitle: { fontSize: 22, lineHeight: 27, fontWeight: "900" },
  heroBody: { fontSize: 15, lineHeight: 21 },
  heroNote: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  block: { gap: 8 },
  moneyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  moneyLabel: { fontSize: 14, lineHeight: 19 },
  moneyLabelStrong: { fontSize: 16, lineHeight: 21, fontWeight: "800" },
  moneyValue: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
  moneyValueStrong: { fontSize: 18, lineHeight: 23, fontWeight: "900" },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  note: { fontSize: 13, lineHeight: 18 },
  actions: { gap: 10 },
  action: {
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0)",
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { fontSize: 15, fontWeight: "800" },
});
