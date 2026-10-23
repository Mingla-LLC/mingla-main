import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

import { saleAvailabilityCopy } from "./saleAvailabilityCopy";

export interface SaleAvailabilityTextProps {
  active: boolean;
  remaining: number | null | undefined;
  endsAt: string | null | undefined;
  timezone?: string | null;
  style?: StyleProp<TextStyle>;
}

export const SaleAvailabilityText = ({
  active,
  remaining,
  endsAt,
  timezone,
  style,
}: SaleAvailabilityTextProps) => {
  const copy = active
    ? saleAvailabilityCopy(remaining, endsAt, timezone)
    : null;
  return copy === null ? null : React.createElement(Text, { style }, copy);
};
