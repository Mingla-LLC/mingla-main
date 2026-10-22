import { Text, type StyleProp, type TextStyle } from "react-native";

import { OfferingRenderingReact as React } from "./offeringRenderingReact";
import type { DiscountReasonCopyInput } from "./discountQuote";
import { discountReasonCopy } from "./discountReasonCopy";

export interface DiscountReasonTextProps {
  input: DiscountReasonCopyInput;
  style?: StyleProp<TextStyle>;
}

/** Deferred buyer-facing refusal copy shared by checkout and venue rails. */
export const DiscountReasonText = ({
  input,
  style,
}: DiscountReasonTextProps) => (
  <Text style={style} accessibilityRole="alert">
    {discountReasonCopy(input)}
  </Text>
);
