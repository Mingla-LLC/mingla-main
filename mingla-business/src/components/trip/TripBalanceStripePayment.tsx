import React from "react";
import { Text, View } from "react-native";
import type { TripBalanceStart } from "../../services/tripBalancePayService";
import { color } from "../../theme/surfaceTokens";

export function TripBalanceStripePayment(_props: {
  session: Extract<TripBalanceStart, { kind: "stripe" }>;
  returnUrl: string;
  onComplete: () => void;
}): React.ReactElement {
  return (
    <View>
      <Text style={{ color: color.text1 }}>
        Open this link on buyer web to pay.
      </Text>
    </View>
  );
}
