/**
 * BrandPayoutTimelineExplainer — #1180 "How payouts work" explainer sheet
 * (DESIGN §2.5 / §4.5). Level-2 disclosure: the conceptual model that makes
 * every payout row legible.
 *
 * Copy only, no data. Composes the shared `Sheet` primitive (which already
 * ships the iOS-translucent / Android-opaque / web-opaque treatment — no glass
 * is hand-rolled here). The NG fee note renders only for Paystack/NG brands.
 */

import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

export interface BrandPayoutTimelineExplainerProps {
  visible: boolean;
  onClose: () => void;
  /** NG (Paystack) brands see the transfer-fee + stamp-duty note. */
  isNgBrand: boolean;
}

interface Step {
  icon: IconName;
  title: string;
  body: string;
}

const STEPS: readonly Step[] = [
  {
    icon: "flag",
    title: "Your event ends",
    body: "Payouts are tied to the event date, not the sale date.",
  },
  {
    icon: "clock",
    title: "3 days later, we release your payout",
    body: "The hold protects against refunds and cancellations.",
  },
  {
    icon: "bank",
    title: "Within 1–2 business days, it reaches your bank",
    body: "Exact arrival depends on your bank.",
  },
];

const LEGEND: ReadonlyArray<{ term: string; def: string }> = [
  { term: "Mingla fee", def: "Our platform fee, disclosed at checkout." },
  { term: "Payment processing fee", def: "The card-processing cost on the sale." },
  { term: "Partner share", def: "Any revenue routed to a linked partner." },
  {
    term: "Bank transfer fee & stamp duty (Nigeria)",
    def: "The cost of sending the payout to your Nigerian bank.",
  },
  {
    term: "Held balance / recredit",
    def: "Amounts carried forward or returned when an event is postponed.",
  },
];

export const BrandPayoutTimelineExplainer: React.FC<
  BrandPayoutTimelineExplainerProps
> = ({ visible, onClose, isNgBrand }) => {
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>How payouts work</Text>

        <View style={styles.timeline}>
          {STEPS.map((step, index) => {
            const isLast = index === STEPS.length - 1;
            return (
              <View key={step.title} style={styles.stepRow}>
                <View style={styles.stepRail}>
                  <View style={styles.stepChip}>
                    <Icon name={step.icon} size={16} color={textTokens.secondary} />
                  </View>
                  {!isLast ? <View style={styles.stepConnector} /> : null}
                </View>
                <View style={styles.stepTextCol}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepBody}>{step.body}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <Text style={styles.legendHeading}>What the deductions mean</Text>
        <View style={styles.legendList}>
          {LEGEND.map((item) => (
            <View key={item.term} style={styles.legendRow}>
              <Text style={styles.legendTerm}>{item.term}</Text>
              <Text style={styles.legendDef}>{item.def}</Text>
            </View>
          ))}
        </View>

        {isNgBrand ? (
          <View style={styles.ngNote}>
            <Text style={styles.ngNoteText}>
              In Nigeria, a bank transfer fee and a ₦50 stamp duty per transfer
              are deducted from each payout.
            </Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Button
            label="Got it"
            onPress={onClose}
            variant="primary"
            size="lg"
            fullWidth
            accessibilityLabel="Close payout explainer"
          />
        </View>
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
  },
  timeline: {
    gap: 0,
  },
  stepRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  stepRail: {
    alignItems: "center",
    width: 28,
  },
  stepChip: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileElevated,
  },
  stepConnector: {
    width: 2,
    flex: 1,
    minHeight: spacing.md,
    backgroundColor: glass.border.profileElevated,
  },
  stepTextCol: {
    flex: 1,
    minWidth: 0,
    paddingBottom: spacing.lg,
  },
  stepTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  stepBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.xxs,
  },
  legendHeading: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  legendList: {
    gap: spacing.sm,
  },
  legendRow: {
    gap: spacing.xxs,
  },
  legendTerm: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  legendDef: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  ngNote: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: semantic.infoTint,
  },
  ngNoteText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  footer: {
    marginTop: spacing.sm,
  },
});

export default BrandPayoutTimelineExplainer;
