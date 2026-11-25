/**
 * #4490 P3-3 — "How you pay": Half now (the package's deposit) or All now,
 * shown only when the package takes a deposit. The amounts come from the
 * server's quote; with no deposit nothing is drawn.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";
import { OfferingRadioCard } from "@mingla/offering-rendering/OfferingDecideParts";

import { space, type } from "../../../constants/designSystem";

export interface PayModeChoiceProps {
  palette: ThemePalette;
  value: "deposit" | "full";
  onChange: (mode: "deposit" | "full") => void;
  /** "Half now", "30% now", "₦50,000 now". */
  depositLabel: string;
  depositAmount: string | null;
  fullAmount: string | null;
  /** "Then ₦75,250 by Thu 26 Nov". */
  laterLine: string | null;
  fontFamily?: string;
  testID?: string;
}

export function PayModeChoice({
  palette,
  value,
  onChange,
  depositLabel,
  depositAmount,
  fullAmount,
  laterLine,
  fontFamily,
  testID = "issue-4490-pay-mode",
}: PayModeChoiceProps): React.ReactElement {
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="How you pay" testID={testID}>
      <Text style={[styles.label, { color: palette.tertiaryText }]}>HOW YOU PAY</Text>
      <OfferingRadioCard
        palette={palette}
        title={depositLabel}
        detail={laterLine}
        price={depositAmount}
        selected={value === "deposit"}
        onPress={() => onChange("deposit")}
        fontFamily={fontFamily}
        testID={`${testID}-deposit`}
      />
      <OfferingRadioCard
        palette={palette}
        title="All now"
        detail="Nothing left to pay later."
        price={fullAmount}
        selected={value === "full"}
        onPress={() => onChange("full")}
        fontFamily={fontFamily}
        testID={`${testID}-full`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  label: { ...type.label },
});
