/**
 * #4271 — end of brand onboarding (Apple 3.4, 2.1). Text only until Apple's toolkit
 * is in. Shown only when Tap to Pay is live for this brand on this phone, and only
 * when the screen gave it somewhere to go.
 *
 * No module-scope expo-router import: this card renders inside BrandOnboardView,
 * which suites load under the stock Jest config (expo-router isn't transformed
 * there). The route owns navigation and passes `onSetUp` down, as BrandOnboardView
 * does for its other actions.
 */
import React from "react";
import { Platform, StyleSheet, Text } from "react-native";

import { spacing, text as textTokens, typography } from "../../../constants/designSystem";
import { tapOnboardingCopy } from "../../../constants/tapToPayCopy";
import { tapToPayBrandEligible, useTapToPaySettingsEntry } from "../../../hooks/useTapToPaySettingsEntry";
import { Button } from "../../ui/Button";
import { GlassCard } from "../../ui/GlassCard";

export interface TapToPayOnboardingCardProps {
  brand: { id?: string; paymentProvider?: string | null; defaultCurrency?: string | null } | null | undefined;
  /** Opens Tap to Pay setup for this brand. Without it the card is hidden (no dead tap). */
  onSetUp?: () => void;
}

export const TapToPayOnboardingCard = ({ brand, onSetUp }: TapToPayOnboardingCardProps): React.ReactElement | null => {
  const entry = useTapToPaySettingsEntry(brand?.id ?? null);
  if (entry === null || onSetUp === undefined || !tapToPayBrandEligible(brand)) return null;
  const copy = tapOnboardingCopy(Platform.OS);
  return (
    <GlassCard variant="base" radius="md" padding={spacing.md}>
      <Text style={styles.title} testID="tap-onboarding-card">
        {copy.title}
      </Text>
      <Text style={styles.body}>{copy.body}</Text>
      <Button
        label={copy.button}
        onPress={onSetUp}
        variant="secondary"
        size="md"
        fullWidth
        accessibilityLabel={copy.button}
        testID="tap-onboarding-setup"
      />
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  title: { ...typography.bodySm, fontWeight: "600", color: textTokens.primary },
  body: { ...typography.caption, color: textTokens.secondary, marginTop: 2, marginBottom: spacing.sm },
});
