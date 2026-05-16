/**
 * ConsumerCartCard — minimal dark-glass card primitive used inside the
 * consumer TicketCartSheet. Wraps `<QuantityRow>` rows AND the buyer-recap
 * block so they share the same visual hierarchy.
 *
 * Per ORCH-0847 Phase C design verdict §6.1
 * (`Mingla_Artifacts/specs/DESIGN_ORCH-0847_PHASE_C_TICKET_CART_SHEET.md`).
 *
 * Visual: 16pt radius, 1pt low-alpha border, alpha-0.03 fill, 16pt padding.
 * Sits on top of the sheet's `#15181f` canvas — readable without competing
 * with the existing glass layers in ExpandedBusinessEventSheet.
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

export interface ConsumerCartCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const ConsumerCartCard: React.FC<ConsumerCartCardProps> = ({
  children,
  style,
}) => <View style={[styles.card, style]}>{children}</View>;

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    padding: 16,
  },
});

export default ConsumerCartCard;
