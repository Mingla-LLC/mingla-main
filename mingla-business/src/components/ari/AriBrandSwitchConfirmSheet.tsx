/**
 * #4389 R-16 — switching brand while Ari is answering asks first. The answer
 * keeps writing to the old brand's conversation (server side), so nothing is
 * lost; the host just lands on the other brand's chat.
 *
 * Opened only after the brand switcher has closed (never over it, U-1).
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { spacing, text as textTokens, typography } from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { ARI_BRAND_BAR_COPY as C } from "./ariBrandBarCopy";

export interface AriBrandSwitchConfirmSheetProps {
  visible: boolean;
  currentBrandName: string;
  nextBrandName: string;
  onSwitch: () => void;
  onStay: () => void;
}

export const AriBrandSwitchConfirmSheet: React.FC<AriBrandSwitchConfirmSheetProps> = ({
  visible,
  currentBrandName,
  nextBrandName,
  onSwitch,
  onStay,
}) => (
  <Sheet visible={visible} onClose={onStay} snapPoint="half">
    <SheetScrollLayout
      testID="ari-brand-switch-busy"
      footer={
        <>
      <Button
        label={C.busySwitch(nextBrandName)}
        onPress={onSwitch}
        variant="primary"
        size="lg"
        fullWidth
        testID="ari-brand-switch-confirm"
      />
      <Button
        label={C.busyStay(currentBrandName)}
        onPress={onStay}
        variant="secondary"
        size="lg"
        fullWidth
        testID="ari-brand-switch-stay"
      />
        </>
      }
    >
      <Text style={styles.title} accessibilityRole="header">
        {C.busyTitle}
      </Text>
      <Text style={styles.sub}>{C.busyBody(nextBrandName, currentBrandName)}</Text>
    </SheetScrollLayout>
  </Sheet>
);

const styles = StyleSheet.create({
  title: { ...typography.h3, color: textTokens.primary },
  sub: { ...typography.body, color: textTokens.secondary },
});
