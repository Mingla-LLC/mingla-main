/**
 * BrandPayoutStatusPill — #1180 payout-release status chip.
 *
 * Built exactly like `ui/StatusPill.tsx`: a fixed dictionary
 * (PAYOUT_STATUS_PRESENTATION, in utils/payoutBreakdown) mapping each of the 12
 * `brand_payout_releases.status` values to a Pill variant + label. `livePulse`
 * is false for ALL — these are settled/persisted states, not a live signal
 * (RELEASED does not pulse; money already landed).
 *
 * NEVER renders error_message / attempt_count / OTP / KYC internals — the
 * dictionary label + the paired one-liner (Tier B) are the only organiser copy.
 */

import React from "react";
import { View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { Pill } from "../ui/Pill";
import {
  PAYOUT_STATUS_PRESENTATION,
  payoutStatusA11yLabel,
  type PayoutReleaseStatus,
} from "../../utils/payoutBreakdown";

export { payoutStatusOneLiner } from "../../utils/payoutBreakdown";

export interface BrandPayoutStatusPillProps {
  status: PayoutReleaseStatus;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const BrandPayoutStatusPill: React.FC<BrandPayoutStatusPillProps> = ({
  status,
  testID,
  style,
}) => {
  const presentation = PAYOUT_STATUS_PRESENTATION[status];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={payoutStatusA11yLabel(status)}
    >
      <Pill variant={presentation.variant} livePulse={presentation.livePulse} testID={testID} style={style}>
        {presentation.label}
      </Pill>
    </View>
  );
};

export default BrandPayoutStatusPill;
