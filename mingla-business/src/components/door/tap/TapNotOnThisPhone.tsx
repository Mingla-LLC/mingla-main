/**
 * #4271 — design T1 "Not on this phone": the fallback when Stripe's device check
 * fails (or this binary has no Tap to Pay). Copy per the approved design.
 */
import React from "react";
import { Platform } from "react-native";

import { TapStatusView } from "./TapStatusView";

export const TAP_NOT_ON_THIS_PHONE_BODY_IOS =
  "Tap to Pay needs an iPhone XS or newer on the latest iOS. Use a pay code instead. It works on any phone.";
export const TAP_NOT_ON_THIS_PHONE_BODY_ANDROID =
  "Tap to Pay needs an Android phone with NFC turned on and no developer options. Use a pay code instead. It works on any phone.";

export interface TapNotOnThisPhoneProps {
  onUsePayCode: () => void;
  loading?: boolean;
}

export const TapNotOnThisPhone = ({ onUsePayCode, loading = false }: TapNotOnThisPhoneProps): React.ReactElement => (
  <TapStatusView
    tone="bad"
    icon="phone"
    title="This phone can't take taps"
    body={Platform.OS === "ios" ? TAP_NOT_ON_THIS_PHONE_BODY_IOS : TAP_NOT_ON_THIS_PHONE_BODY_ANDROID}
    primary={{ label: "Use a pay code", onPress: onUsePayCode, loading, testID: "tap-use-pay-code" }}
    testID="tap-not-on-this-phone"
  />
);
