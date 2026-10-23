import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useBrandPayoutScreen } from "../../hooks/useBrandPayoutScreen";
import { formatCurrency } from "../../utils/currency";
import { PAYOUT_STATE_COPY, payoutWaterfallMath, type PayoutScreenReleaseDTO } from "../../utils/payoutScreen";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Skeleton } from "../ui/Skeleton";
import { TopBar } from "../ui/TopBar";

export interface BrandPayoutDetailViewProps {
  brandId: string;
  releaseId: string;
  onBack: () => void;
  onOpenSale: (eventId: string, orderId: string) => void;
  onOpenBank: () => void;
  onOpenVerification: () => void;
  onContactSupport: () => void;
}

const dateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const payoutTiming = (release: PayoutScreenReleaseDTO): string => {
  switch (release.hostState) {
    case "waiting_for_bank":
      return "Add a bank and it goes out in the next payout run.";
    case "paid":
      return release.releasedAt === null
        ? PAYOUT_STATE_COPY.paid.detail
        : `Paid ${dateTime(release.releasedAt)}${release.bankMask === null ? "" : ` to ${release.bankMask}`}`;
    case "late_on_us":
      return `Was due ${dateTime(release.dueAt)}. Nothing for you to do: the hold-up is on Mingla’s side.`;
    case "scheduled":
      return `Pays out ${dateTime(release.dueAt)}, about a day after payment.`;
    case "sending_today":
      return "Due now. It goes out in the next payout run.";
    case "on_its_way":
      return `Sent${release.bankMask === null ? "" : ` to ${release.bankMask}`}. Usually arrives in minutes, sometimes up to 1 business day.`;
    default:
      return PAYOUT_STATE_COPY[release.hostState].detail;
  }
};

const detailTone = (state: PayoutScreenReleaseDTO["hostState"]): { backgroundColor: string; color: string } => {
  if (state === "paid") return { backgroundColor: semantic.successTint, color: semantic.success };
  if (state === "couldnt_send") return { backgroundColor: semantic.errorTint, color: semantic.error };
  if (["waiting_for_bank", "late_on_us", "needs_you"].includes(state)) {
    return { backgroundColor: semantic.warningTint, color: semantic.warning };
  }
  if (state === "paused" || state === "cancelled") {
    return { backgroundColor: glass.tint.profileElevated, color: textTokens.secondary };
  }
  return { backgroundColor: semantic.infoTint, color: semantic.info };
};

const BreakdownLine: React.FC<{
  label: string;
  value: string;
  total?: boolean;
  positive?: boolean;
}> = ({ label, value, total = false, positive = false }) => (
  <View style={[styles.line, total ? styles.totalLine : null]}>
    <Text style={[styles.lineLabel, total ? styles.totalText : null]}>{label}</Text>
    <Text style={[styles.lineValue, total ? styles.totalText : null, positive ? styles.positive : null]}>{value}</Text>
  </View>
);

const PayoutBreakdown: React.FC<{ release: PayoutScreenReleaseDTO }> = ({ release }) => {
  const money = (cents: number): string => formatCurrency(cents, release.currency, true);
  const debtWithheld = release.permanentDebtWithheldCents + release.temporaryDebtWithheldCents;
  const arithmetic = payoutWaterfallMath(release);
  return (
    <GlassCard variant="base" padding={spacing.lg}>
      <Text style={styles.sectionTitle}>How we got to this number</Text>
      {(release.discountCents ?? 0) > 0 ? <BreakdownLine label="Discounts you gave" value={`−${money(release.discountCents ?? 0)}`} /> : null}
      <BreakdownLine label="Buyers paid" value={money(release.grossCents)} />
      {release.refundedCents > 0 ? <BreakdownLine label="Refunds" value={`−${money(release.refundedCents)}`} /> : null}
      {release.disputedCents > 0 ? <BreakdownLine label="Disputes" value={`−${money(release.disputedCents)}`} /> : null}
      {debtWithheld > 0 ? <BreakdownLine label="Refund after an earlier payout" value={`−${money(debtWithheld)}`} /> : null}
      <BreakdownLine label={`Mingla fee${release.olderPricing ? " · 1.5%, older pricing" : " · 4.5%"}`} value={`−${money(release.minglaFeeCents)}`} />
      {release.maturityRecreditCents > 0 ? <BreakdownLine label="Returned from an earlier hold" value={`+${money(release.maturityRecreditCents)}`} positive /> : null}
      <BreakdownLine label="Card processing" value="Mingla pays" />
      {release.provider === "stripe" ? <BreakdownLine label="Stripe automatic-tax fee (~0.5%)" value="Paid by you" /> : null}
      <BreakdownLine label="You get" value={money(release.netReleaseCents)} total />
      {release.transferFeeCents > 0 ? <BreakdownLine label="Bank transfer fee" value={`−${money(release.transferFeeCents)}`} /> : null}
      {release.stampDutyCents > 0 ? <BreakdownLine label="Stamp duty" value={`−${money(release.stampDutyCents)}`} /> : null}
      {release.hostState === "paid" ? <BreakdownLine label="Sent to your bank" value={money(release.cashToBankCents)} total /> : null}
      {release.transferFeeCreditCents > 0 ? (
        <Text style={styles.creditNote}>Mingla owes you {money(release.transferFeeCreditCents)} for the bank-fee estimate.</Text>
      ) : null}
      {!arithmetic.hostNetReconciles || !arithmetic.cashReconciles ? (
        <Text style={styles.reconcileWarning}>This stored payout needs an operations review before a number can be explained.</Text>
      ) : null}
      <Text style={styles.note}>Card processing: Mingla pays. Only lines that changed the number are shown, and they always add up.</Text>
    </GlassCard>
  );
};

export const BrandPayoutDetailView: React.FC<BrandPayoutDetailViewProps> = ({
  brandId,
  releaseId,
  onBack,
  onOpenSale,
  onOpenBank,
  onOpenVerification,
  onContactSupport,
}) => {
  const query = useBrandPayoutScreen(brandId);
  const release = query.data?.releases.find((item) => item.id === releaseId) ?? null;
  const copy = release === null ? null : PAYOUT_STATE_COPY[release.hostState];
  const action = copy?.action;
  const tone = release === null ? null : detailTone(release.hostState);

  return (
    <View style={styles.host}>
      <TopBar leftKind="back" title="Payout" onBack={onBack} rightSlot={<View />} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {query.isLoading ? <Skeleton width="100%" height={160} radius="lg" /> : null}
        {query.isError ? (
          <GlassCard variant="base" padding={spacing.lg}>
            <Text style={styles.sectionTitle}>Couldn’t load this payout</Text>
            <Text style={styles.body}>Check your connection and try again.</Text>
            <View style={styles.action}><Button label="Try again" onPress={() => void query.refetch()} variant="secondary" size="md" /></View>
          </GlassCard>
        ) : null}
        {!query.isLoading && !query.isError && release === null ? (
          <GlassCard variant="base" padding={spacing.lg}>
            <Text style={styles.sectionTitle}>Payout not found</Text>
            <Text style={styles.body}>It may belong to another brand or no longer be available.</Text>
          </GlassCard>
        ) : null}
        {release !== null && copy !== null ? (
          <>
            <GlassCard variant="elevated" padding={spacing.lg}>
              <View style={[
                styles.statusPill,
                { backgroundColor: tone?.backgroundColor },
              ]}>
                <Text style={[
                  styles.statusPillText,
                  { color: tone?.color },
                ]}>{copy.label}</Text>
              </View>
              <Text style={styles.heroLabel}>{release.hostState === "paid"
                ? "PAID TO YOUR BANK"
                : release.hostState === "on_its_way"
                  ? "ON ITS WAY"
                  : "YOU’LL GET"}</Text>
              <Text style={styles.heroAmount}>
                {formatCurrency(release.hostState === "paid" ? release.cashToBankCents : release.netReleaseCents, release.currency, true)}
              </Text>
              <Text style={styles.body}>{release.offeringName}</Text>
              <Text style={styles.due}>{payoutTiming(release)}</Text>
              {action === "bank" ? <View style={styles.action}><Button label={release.hostState === "couldnt_send" ? "Check bank details" : "Add a bank"} onPress={onOpenBank} variant="primary" size="md" /></View> : null}
              {action === "verify" ? <View style={styles.action}><Button label="Finish verification" onPress={onOpenVerification} variant="primary" size="md" /></View> : null}
              {action === "support" ? <View style={styles.action}><Button label={release.hostState === "late_on_us" ? "Ask about this payout" : "Contact support"} onPress={onContactSupport} variant="secondary" size="md" /></View> : null}
            </GlassCard>

            <GlassCard variant="base" padding={spacing.lg}>
              <Text style={styles.sectionTitle}>Timeline</Text>
              <View style={styles.timeline}>
                <View style={styles.timelineItem}>
                  <View style={[styles.timelineDot, styles.timelineDotDone]} />
                  <View style={styles.timelineText}>
                    <Text style={styles.timelineTitle}>Sold</Text>
                    <Text style={styles.body}>{release.lastSaleAt === null ? "Sale recorded" : dateTime(release.lastSaleAt)}</Text>
                  </View>
                </View>
                <View style={styles.timelineItem}>
                  <View style={[
                    styles.timelineDot,
                    Date.parse(release.dueAt) <= Date.now() ? styles.timelineDotDone : styles.timelineDotTodo,
                  ]} />
                  <View style={styles.timelineText}>
                    <Text style={styles.timelineTitle}>Due</Text>
                    <Text style={styles.body}>{dateTime(release.dueAt)}</Text>
                  </View>
                </View>
                <View style={styles.timelineItem}>
                  <View style={[
                    styles.timelineDot,
                    release.hostState === "paid"
                      ? styles.timelineDotDone
                      : release.hostState === "on_its_way"
                        ? styles.timelineDotCurrent
                        : styles.timelineDotTodo,
                  ]} />
                  <View style={styles.timelineText}>
                    <Text style={styles.timelineTitle}>Reached your bank</Text>
                    <Text style={styles.body}>{release.releasedAt === null ? "Not yet" : dateTime(release.releasedAt)}</Text>
                  </View>
                </View>
              </View>
            </GlassCard>

            <PayoutBreakdown release={release} />

            <View>
              <Text style={styles.eyebrow}>SALES IN THIS PAYOUT</Text>
              <GlassCard variant="base" padding={0}>
                {release.items.map((sale, index) => (
                  <View key={`${sale.sourceType}:${sale.sourceId}`} style={index > 0 ? styles.divider : null}>
                    <Button
                      label={`${sale.sourceType === "order" ? "Order" : "Payment"} · ${formatCurrency(sale.netCents, release.currency, true)}`}
                      onPress={() => release.eventId !== null && sale.sourceType === "order" ? onOpenSale(release.eventId, sale.sourceId) : undefined}
                      variant="ghost"
                      size="md"
                      fullWidth
                      disabled={release.eventId === null || sale.sourceType !== "order"}
                    />
                  </View>
                ))}
                {release.items.length === 0 ? <Text style={styles.emptySales}>No sale rows are attached to this payout.</Text> : null}
              </GlassCard>
            </View>

            <GlassCard variant="base" padding={spacing.lg}>
              <Text style={styles.sectionTitle}>Bank & timing</Text>
              <Text style={styles.body}>{release.bankMask === null ? "No bank is shown for this payout." : `Destination ${release.bankMask}`}</Text>
              <Text style={styles.body}>{release.provider === "paystack" ? "Transferred to your verified bank." : "Paid from your connected balance."}</Text>
            </GlassCard>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  statusPill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  statusPillText: { fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700" },
  heroLabel: { marginTop: spacing.lg, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700", letterSpacing: 1.1, color: textTokens.tertiary },
  sectionTitle: { fontSize: typography.h3.fontSize, lineHeight: typography.h3.lineHeight, fontWeight: typography.h3.fontWeight, color: textTokens.primary },
  heroAmount: { marginTop: spacing.xs, fontSize: 34, lineHeight: 40, fontWeight: "800", fontVariant: ["tabular-nums"], color: textTokens.primary },
  body: { marginTop: spacing.xs, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.secondary },
  due: { marginTop: spacing.sm, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, fontWeight: "700", color: textTokens.primary },
  action: { marginTop: spacing.md, alignSelf: "flex-start" },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.md, paddingVertical: spacing.sm },
  lineLabel: { flex: 1, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.secondary },
  lineValue: { fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.primary, textAlign: "right" },
  totalLine: { marginTop: spacing.xs, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border.profileBase },
  totalText: { fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, fontWeight: "800", color: textTokens.primary },
  positive: { color: semantic.success },
  note: { marginTop: spacing.sm, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, color: textTokens.tertiary },
  creditNote: { marginTop: spacing.sm, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: semantic.warning },
  reconcileWarning: { marginTop: spacing.sm, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: semantic.error },
  eyebrow: { marginBottom: spacing.sm, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700", letterSpacing: 1.2, color: textTokens.tertiary },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border.profileBase },
  emptySales: { padding: spacing.lg, fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.secondary },
  timeline: { marginTop: spacing.sm, gap: spacing.md },
  timelineItem: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  timelineDot: { width: 12, height: 12, marginTop: 5, borderRadius: 6 },
  timelineDotDone: { backgroundColor: semantic.success },
  timelineDotCurrent: { backgroundColor: semantic.warning },
  timelineDotTodo: { backgroundColor: "transparent", borderWidth: 2, borderColor: "rgba(255,255,255,0.32)" },
  timelineText: { flex: 1 },
  timelineTitle: { fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, fontWeight: "700", color: textTokens.primary },
});

export default BrandPayoutDetailView;
