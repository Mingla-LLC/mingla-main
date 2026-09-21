/**
 * The three ENDINGS a paid return leg can reach without an order, shared by the
 * event, trip and experience confirmation screens.
 *
 *   - "expired"          — the hosted checkout timed out before the guest paid.
 *                          Nothing was charged, so this is the ONLY ending that
 *                          invites a retry.
 *   - "not_issued"       — a `checkout_unavailable` refusal. The guest may well
 *                          have paid and what happens to that money is decided
 *                          elsewhere (#2079), so the copy claims no charge
 *                          outcome and promises no refund, and the primary
 *                          action is NOT "try again" — asking a guest whose
 *                          money is unsettled to pay again is the harm #2264
 *                          was filed about, one screen over.
 *   - "still_confirming" — the 60 s confirmation budget ran out with no answer
 *                          either way. Honest about not knowing; tells the guest
 *                          not to pay twice. A later paid answer still replaces
 *                          this.
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
  TICKETS_EXPIRED_MESSAGE,
  TICKETS_EXPIRED_TITLE,
  TICKETS_NOT_ISSUED_MESSAGE,
  TICKETS_NOT_ISSUED_TITLE,
  TICKETS_STILL_CONFIRMING_MESSAGE,
  TICKETS_STILL_CONFIRMING_TITLE,
} from "../../services/ticketCheckoutService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

export type TicketConfirmEnding =
  | "expired"
  | "not_issued"
  | "still_confirming";

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

/**
 * ONE row per ending. Nothing outside this table decides what a guest is shown,
 * so adding an ending is a compile error until its words and its action exist.
 *
 * `retry` is the sole difference that matters on a money path: only the ending
 * that PROVES no charge may offer to start the purchase over.
 */
const ENDINGS: Readonly<
  Record<
    TicketConfirmEnding,
    {
      readonly title: string;
      readonly body: string;
      readonly icon: "x" | "clock";
      readonly tone: "error" | "warning";
      readonly retry: boolean;
    }
  >
> = {
  expired: {
    title: TICKETS_EXPIRED_TITLE,
    body: TICKETS_EXPIRED_MESSAGE,
    icon: "clock",
    tone: "warning",
    retry: true,
  },
  not_issued: {
    title: TICKETS_NOT_ISSUED_TITLE,
    body: TICKETS_NOT_ISSUED_MESSAGE,
    icon: "x",
    tone: "error",
    // The payment is unsettled. Never invite a second one.
    retry: false,
  },
  still_confirming: {
    title: TICKETS_STILL_CONFIRMING_TITLE,
    body: TICKETS_STILL_CONFIRMING_MESSAGE,
    icon: "clock",
    tone: "warning",
    retry: false,
  },
};

export function TicketConfirmVerdictHero({
  ending,
  topInset,
  backLabel,
  onBack,
}: TicketConfirmVerdictHeroProps): React.ReactElement {
  const spec = ENDINGS[ending];
  const isError = spec.tone === "error";
  return (
    <View style={styles.host} testID={`ticket-confirm-ending-${ending}`}>
      <View style={[styles.hero, { paddingTop: topInset + spacing.xl }]}>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: isError
                ? semantic.errorTint
                : semantic.warningTint,
            },
          ]}
        >
          <Icon
            name={spec.icon}
            size={36}
            color={isError ? semantic.errorText : semantic.warning}
          />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {spec.title}
        </Text>
        <Text style={styles.body} accessibilityLiveRegion="polite">
          {spec.body}
        </Text>
        <View style={styles.actions}>
          {spec.retry ? (
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
