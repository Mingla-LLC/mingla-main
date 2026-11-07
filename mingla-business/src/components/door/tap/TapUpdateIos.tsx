/**
 * #4271 — iPhone on iOS below 17.6: tell the host to update, and keep the pay
 * code one tap away. Door polish: neutral with a download icon; an update is
 * not an error.
 */
import React, { useCallback } from "react";
import { Linking } from "react-native";

import { TAP_UPDATE_IOS_COPY } from "../../../constants/tapToPayCopy";
import { TapStatusView } from "./TapStatusView";

export interface TapUpdateIosProps {
  onUsePayCode: () => void;
  loading?: boolean;
}

export const TapUpdateIos = ({ onUsePayCode, loading }: TapUpdateIosProps): React.ReactElement => {
  const openSettings = useCallback((): void => {
    void Linking.openSettings().catch((error: unknown) => {
      console.warn("[door-tap] could not open Settings", error instanceof Error ? error.message : "unknown");
    });
  }, []);
  return (
    <TapStatusView
      tone="neutral"
      icon="download"
      title={TAP_UPDATE_IOS_COPY.title}
      body={TAP_UPDATE_IOS_COPY.body}
      primary={{ label: TAP_UPDATE_IOS_COPY.primary, onPress: openSettings, testID: "tap-update-open-settings" }}
      secondary={{
        label: TAP_UPDATE_IOS_COPY.secondary,
        onPress: onUsePayCode,
        loading,
        testID: "tap-update-pay-code",
      }}
      testID="tap-state-ios_update_required"
    />
  );
};
