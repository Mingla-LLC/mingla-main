/**
 * The two ENDINGS a paid return leg can reach without an order, shared by the
 * event, trip and experience confirmation screens.
 *
 *   - "not_issued"       — the server refused the sale after payment (closed or
 *                          held) or the checkout expired. Any payment is being
 *                          refunded automatically. Primary action: try again,
 *                          which takes the guest back to the offering.
 *   - "still_confirming" — the 60 s confirmation budget ran out with no answer
 *                          either way. Honest about not knowing; tells the guest
 *                          not to pay twice. Secondary action: back to the
 *                          offering. A later paid answer still replaces this.
 *
 * The verdict itself is decided ONLY by `awaitTicketConfirmation`
 * (`src/services/ticketCheckoutService.ts`). This component renders it and owns
 * no classification. The copy constants live beside the classifier so the words
 * and the rule that selects them cannot drift apart.
 *
 * The calm "Confirming your tickets…" state stays on each screen, control-free:
 * while an answer is still genuinely possible there is nothing to press.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  TICKETS_NOT_ISSUED_MESSAGE,
  TICKETS_NOT_ISSUED_TITLE,
  TICKETS_STILL_CONFIRMING_MESSAGE,
  TICKETS_STILL_CONFIRMING_TITLE,
} from "../../services/ticketCheckoutService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

export type TicketConfirmEnding = "not_issued" | "still_confirming";

export interface TicketConfirmVerdictHeroProps {
  ending: TicketConfirmEnding;
  /** Safe-area top inset of the hosting screen. */
  topInset: number;
  /** e.g. "Back to event" — the offering this checkout belongs to. */
  backLabel: string;
  /**
   * The screen's own sanctioned exit. It MUST disarm the screen's native and
   * browser back guards before navigating (the screens' `handleBackTo…`).
   */
  onBack: () => void;
}

export function TicketConfirmVerdictHero({
  ending,
  topInset,
  backLabel,
  onBack,
}: TicketConfirmVerdictHeroProps): React.ReactElement {
  const notIssued = ending === "not_issued";
  return (
    <View style={styles.host} testID={`ticket-confirm-ending-${ending}`}>
      <View style={[styles.hero, { paddingTop: topInset + spacing.xl }]}>
        <View
          style={[
            styles.badge,
            { backgroundColor: notIssued ? semantic.errorTint : semantic.warningTint },
          ]}
        >
          <Icon
            name={notIssued ? "x" : "clock"}
            size={36}
            color={notIssued ? semantic.errorText : semantic.warning}
          />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {notIssued ? TICKETS_NOT_ISSUED_TITLE : TICKETS_STILL_CONFIRMING_TITLE}
        </Text>
        <Text style={styles.body} accessibilityLiveRegion="polite">
          {notIssued ? TICKETS_NOT_ISSUED_MESSAGE : TICKETS_STILL_CONFIRMING_MESSAGE}
        </Text>
        <View style={styles.actions}>
          {notIssued ? (
            <Button
              label="Try again"
              onPress={onBack}
              variant="primary"
              size="lg"
              fullWidth
              accessibilityLabel={`Try again — ${backLabel.toLowerCase()}`}
              testID="ticket-confirm-try-again"
            />
          ) : (
            <Button
              label={backLabel}
              onPress={onBack}
              variant="secondary"
              size="lg"
              fullWidth
              accessibilityLabel={backLabel}
              testID="ticket-confirm-back"
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
    paddingHorizontal: spacing.lg,
  },
  hero: {
    alignItems: "center",
    gap: spacing.sm,
  },
  badge: {
    width: 72,
    height: 72,
    borderRadius: radiusTokens.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.6,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    color: textTokens.secondary,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 360,
  },
  actions: {
    alignSelf: "stretch",
    maxWidth: 360,
    width: "100%",
    marginTop: spacing.lg,
    marginHorizontal: "auto",
  },
});
