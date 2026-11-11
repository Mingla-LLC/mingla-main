/**
 * #4271 — design T1 "Not on this phone": the fallback when Stripe's device check
 * fails (or this binary has no Tap to Pay). Copy per the approved design.
 *
 * Door polish: neutral, not red. Nothing went wrong and the pay code works on
 * any phone. No phone glyph on iPhone (Apple: no art of the device or feature).
 */
import React from "react";
import { Platform } from "react-native";

import { tapToPayName } from "../../../constants/tapToPayName";
import { TapStatusView } from "./TapStatusView";

// iPhone says the full name (Apple); Android never says "iPhone".
export const TAP_NOT_ON_THIS_PHONE_BODY_IOS = `${tapToPayName("ios")} needs an iPhone XS or newer on the latest iOS. Use a pay code instead. It works on any phone.`;
export const TAP_NOT_ON_THIS_PHONE_BODY_ANDROID =
  "Tap to Pay needs an Android phone with NFC turned on and no developer options. Use a pay code instead. It works on any phone.";

export interface TapNotOnThisPhoneProps {
  onUsePayCode: () => void;
  loading?: boolean;
  /** Opens Help & Support ("Get help"). */
  onHelp?: () => void;
}

export const TapNotOnThisPhone = ({ onUsePayCode, loading = false, onHelp }: TapNotOnThisPhoneProps): React.ReactElement => (
  <TapStatusView
    tone="neutral"
    icon={Platform.OS === "ios" ? "settings" : "phone"}
    title="This phone can't take taps"
    body={Platform.OS === "ios" ? TAP_NOT_ON_THIS_PHONE_BODY_IOS : TAP_NOT_ON_THIS_PHONE_BODY_ANDROID}
    primary={{ label: "Use a pay code", onPress: onUsePayCode, loading, testID: "tap-use-pay-code" }}
    onHelp={onHelp}
    testID="tap-not-on-this-phone"
  />
);
