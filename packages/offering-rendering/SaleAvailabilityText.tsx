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

export const SaleAvailabilityText: React.FC<SaleAvailabilityTextProps> = ({
  active,
  remaining,
  endsAt,
  timezone,
  style,
}) => {
  const copy = active
    ? saleAvailabilityCopy(remaining, endsAt, timezone)
    : null;
  return copy === null ? null : <Text style={style}>{copy}</Text>;
};
