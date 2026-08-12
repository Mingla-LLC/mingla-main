/**
 * Issue #1792 (#1767 Phase 3b) — OPEN TABS on the Orders queue (DESIGN D-2
 * AMENDED, D-11; SPEC #1788 P-2a).
 *
 * A tab is a sitting a waiter opened and is still serving. This card is where it
 * lives between rounds: where it is, how many rounds are on it, what it owes,
 * and the two things a waiter does next — add another round, or settle it.
 *
 * EVERY NUMBER HERE IS SERVER-SUMMED (`biz_venue_tab_summaries`), by the same
 * predicate `biz_venue_tab_close` bills with. The card and the bill therefore
 * cannot disagree, which matters more than it sounds: the alternative is
 * summing the queue's cached rows on the client, which would count a tab that
 * already has a bill out TWICE — once as its rounds and again as its own
 * settlement order.
 *
 * The close chooser renders INSIDE this card, not in a second overlay.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { formatCurrency } from "../../../utils/currency";
import { useCloseVenueTab } from "../../../hooks/useVenueOrderTabs";
import { GlassCard } from "../../ui/GlassCard";
import {
  ORDER_PAD_SETTLEMENT_OPTIONS,
  tabAcceptsRounds,
  tabDestinationLabel,
  tabRoundsLabel,
  venueLocalTabs,
  type OrderPadTab,
} from "./venueOrderPad";

export interface VenueTabsCardProps {
  brandId: string | null;
  /** The venue filter the queue is on — null shows every venue's tabs. */
  venueId: string | null;
  tabs: readonly OrderPadTab[];
  /** Add another round to this tab (opens the pad on its sitting). */
  onAddRound: (tab: OrderPadTab) => void;
  /**
   * Bill the whole tab to the guest's phone. Handed UP to the pad sheet rather
   * than collected here: that needs three text fields, this card lives in the
   * venue hub's plain ScrollView, and a plain ScrollView does not lift a focused
   * field above the keyboard. Taking CASH stays here — it is one tap and asks
   * for nothing.
   */
  onBillTab: (tab: OrderPadTab) => void;
  /** event_manager+ closes a tab: it is a money act. */
  canCloseTabs: boolean;
  testID?: string;
}

export function VenueTabsCard({
  brandId,
  venueId,
  tabs,
  onAddRound,
  onBillTab,
  canCloseTabs,
  testID,
}: VenueTabsCardProps): React.ReactElement | null {
  const closeTab = useCloseVenueTab(brandId);
  const [closing, setClosing] = useState<string | null>(null);

  const visible = venueLocalTabs(tabs, venueId);

  const resetChooser = useCallback((): void => {
    setClosing(null);
  }, []);

  const handleVenueCollected = useCallback(
    (tab: OrderPadTab): void => {
      closeTab.mutate(
        { sessionId: tab.sessionId, method: "venue_collected" },
        { onSuccess: resetChooser },
      );
    },
    [closeTab, resetChooser],
  );

  if (visible.length === 0) return null;

  return (
    <GlassCard
      variant="elevated"
      style={styles.card}
      testID={testID ?? "venue-tabs-card"}
    >
      <Text style={styles.title}>Open tabs</Text>
      <Text style={styles.subtitle}>
        Rounds you&apos;re holding. Settle when they go.
      </Text>

      {visible.map((tab) => {
        const isClosing = closing === tab.sessionId;
        return (
          <View
            key={tab.sessionId}
            style={styles.row}
            testID={`venue-tab-${tab.sessionId}`}
          >
            <View style={styles.rowHead}>
              <View style={styles.rowText}>
                <Text style={styles.destination}>
                  {tabDestinationLabel(tab)}
                </Text>
                <Text style={styles.meta}>
                  {tabRoundsLabel(tab)}
                  {tab.tabState === "settling" ? " · bill sent" : ""}
                </Text>
              </View>
              <Text style={styles.total} testID={`venue-tab-total-${tab.sessionId}`}>
                {formatCurrency(tab.outstandingTotalCents, tab.currency, true)}
              </Text>
            </View>

            {tab.outstandingTipCents > 0 ? (
              // Tips are shown APART from the sale, everywhere. Mingla takes no
              // cut of one and it never enters a revenue number.
              <Text style={styles.meta}>
                Includes {formatCurrency(tab.outstandingTipCents, tab.currency, true)}
                {" "}tip — yours, untouched.
              </Text>
            ) : null}

            {!isClosing ? (
              <View style={styles.actions}>
                <Pressable
                  onPress={() => onAddRound(tab)}
                  disabled={!tabAcceptsRounds(tab)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !tabAcceptsRounds(tab) }}
                  accessibilityLabel={`Add another round to ${tabDestinationLabel(tab)}`}
                  style={[
                    styles.actionBtn,
                    !tabAcceptsRounds(tab) ? styles.actionOff : null,
                  ]}
                  testID={`venue-tab-add-round-${tab.sessionId}`}
                >
                  <Text style={styles.actionLabel}>
                    {tabAcceptsRounds(tab) ? "Another round" : "Bill already sent"}
                  </Text>
                </Pressable>
                {canCloseTabs ? (
                  <Pressable
                    onPress={() => setClosing(tab.sessionId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Close the tab on ${tabDestinationLabel(tab)}`}
                    style={styles.actionBtn}
                    testID={`venue-tab-close-${tab.sessionId}`}
                  >
                    <Text style={styles.actionLabel}>Close tab</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={styles.chooser} testID={`venue-tab-settle-${tab.sessionId}`}>
                {ORDER_PAD_SETTLEMENT_OPTIONS.map((option) => (
                  <Pressable
                    key={option.method}
                    onPress={() => {
                      if (!option.available) return;
                      if (option.method === "bill_to_phone") {
                        setClosing(null);
                        onBillTab(tab);
                        return;
                      }
                      handleVenueCollected(tab);
                    }}
                    disabled={!option.available || closeTab.isPending}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !option.available }}
                    accessibilityLabel={option.label}
                    style={[
                      styles.settleRow,
                      !option.available ? styles.actionOff : null,
                    ]}
                    testID={`venue-tab-settle-${option.method}-${tab.sessionId}`}
                  >
                    <Text style={styles.settleTitle}>{option.label}</Text>
                    <Text style={styles.settleBody}>{option.body}</Text>
                    {option.unavailableReason !== null ? (
                      <Text style={styles.settleOffNote}>
                        {option.unavailableReason}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
                {closeTab.isError ? (
                  <Text style={styles.warn} testID={`venue-tab-close-error-${tab.sessionId}`}>
                    {closeTab.error?.message ??
                      "That didn't go through. Nothing has been charged — try it again."}
                  </Text>
                ) : null}
                <Pressable
                  onPress={resetChooser}
                  accessibilityRole="button"
                  accessibilityLabel="Leave the tab open"
                  style={styles.linkBtn}
                  testID={`venue-tab-close-cancel-${tab.sessionId}`}
                >
                  <Text style={styles.linkLabel}>Leave it open</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    alignSelf: "stretch",
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  subtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  row: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  destination: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  meta: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  total: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  actionBtn: {
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  actionOff: {
    opacity: 0.45,
  },
  actionLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  chooser: {
    gap: spacing.xs,
  },
  settleRow: {
    gap: spacing.xxs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    minHeight: 44,
  },
  settleTitle: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  settleBody: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  settleOffNote: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  warn: {
    ...typography.caption,
    color: semantic.warning,
  },
  linkBtn: {
    minHeight: 44,
    justifyContent: "center",
  },
  linkLabel: {
    ...typography.bodySm,
    color: accent.warm,
    fontWeight: "700",
  },
  payBlock: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  payTitle: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  payLink: {
    ...typography.caption,
    color: accent.warm,
  },
});

export default VenueTabsCard;
