/**
 * #4271 — design T1 "Not on this phone": the fallback when Stripe's device check
 * fails (or this binary has no Tap to Pay). Copy per the approved design.
 *
 * Door polish: neutral, not red. Nothing went wrong and the pay code works on
 * any phone. No phone glyph on iPhone (Apple: no art of the device or feature).
 */
import React from "react";
import { Platform } from "react-native";

import { TapStatusView } from "./TapStatusView";

import { DOOR_MODE_COPY } from "../doorModeCopy";

/**
 * #4389 — says why this phone can't take Tap to Pay (model and iOS on
 * iPhone, NFC on Android), with the pay code as the way on. i18n; the
 * device-facing name always comes from tapToPayName (Apple naming).
 */
export const tapNotOnThisPhoneCopy = (os: string): { title: string; body: string } => ({
  title: DOOR_MODE_COPY.ttpDeviceTitle(os),
  body: DOOR_MODE_COPY.ttpDeviceBody(os),
});

export interface TapNotOnThisPhoneProps {
  onUsePayCode: () => void;
  loading?: boolean;
  /** Opens Help & Support ("Get help"). */
  onHelp?: () => void;
}

export const TapNotOnThisPhone = ({ onUsePayCode, loading = false, onHelp }: TapNotOnThisPhoneProps): React.ReactElement => {
  const copy = tapNotOnThisPhoneCopy(Platform.OS);
  return (
    <TapStatusView
      tone="neutral"
      icon={Platform.OS === "ios" ? "settings" : "phone"}
      title={copy.title}
      body={copy.body}
      primary={{ label: DOOR_MODE_COPY.ttpUsePayCode, onPress: onUsePayCode, loading, testID: "tap-use-pay-code" }}
      onHelp={onHelp}
      testID="tap-not-on-this-phone"
    />
  );
};
