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
  color,
  glass,
  radius,
  space,
  type,
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
    icon: "ticket",
    title: "A buyer pays",
    body: "The sale appears in Payments with the amount buyers paid and what you get.",
  },
  {
    icon: "clock",
    title: "About a day later, we release your payout",
    body: "Mingla schedules the payout from the payment time, not the event date.",
  },
  {
    icon: "bank",
    title: "It reaches your bank",
    body: "Payments shows when it was sent and which bank is receiving it.",
  },
];

const LEGEND: ReadonlyArray<{ term: string; def: string }> = [
  { term: "Mingla fee", def: "A flat 4.5%: 1.5% Mingla fee plus 3% service fee." },
  { term: "Card processing", def: "Mingla pays this. It is never deducted from what you get." },
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
                    <Icon name={step.icon} size={16} color={color.text2} />
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

        <Text style={styles.legendHeading}>What Mingla keeps</Text>
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
    paddingBottom: space[4],
    gap: space[4],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    letterSpacing: type.h1.letterSpacing,
    color: color.text1,
  },
  timeline: {
    gap: 0,
  },
  stepRow: {
    flexDirection: "row",
    gap: space[4],
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
    backgroundColor: color.fill.tile,
  },
  stepConnector: {
    width: 2,
    flex: 1,
    minHeight: space[4],
    backgroundColor: color.lineStrong,
  },
  stepTextCol: {
    flex: 1,
    minWidth: 0,
    paddingBottom: space[6],
  },
  stepTitle: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  stepBody: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    marginTop: space[1],
  },
  legendHeading: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  legendList: {
    gap: space[2],
  },
  legendRow: {
    gap: space[1],
  },
  legendTerm: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  legendDef: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
  },
  ngNote: {
    padding: space[4],
    borderRadius: radius.sm,
    backgroundColor: color.infoTint,
  },
  ngNoteText: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
  },
  footer: {
    marginTop: space[2],
  },
});

export default BrandPayoutTimelineExplainer;
