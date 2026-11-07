/**
 * issue #4271 — the door pay code QR.
 *
 * Encodes a `/pay/door/<code>` link ONLY (see doorPayUrl.ts). This is the one
 * reviewed exception to I-4063-NO-TICKET-QR-OFF-EXPLORER in the Business app:
 * the code is a pay link to a 10-minute, pays-once basket, never a ticket
 * credential. The runtime assert below backs the branded type, so a cast
 * cannot smuggle a ticket value in.
 */

import React from "react";
import { StyleSheet, View } from "react-native";

import { radius as radiusTokens } from "../../constants/designSystem";
import { assertDoorPayUrl, type DoorPayUrl } from "./doorPayUrl";

// Loaded on demand (same as PromoterHomeView) so the QR encoder stays out of
// the boot chunk.
const QRCode = React.lazy(() => import("react-native-qrcode-svg"));

export interface DoorPayQrProps {
  url: DoorPayUrl;
  size: number;
  testID?: string;
}

export const DoorPayQr: React.FC<DoorPayQrProps> = ({ url, size, testID }) => {
  const value = assertDoorPayUrl(url);
  return (
    <View
      style={styles.frame}
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel="Pay code. The guest scans it with their phone camera."
    >
      <React.Suspense fallback={<View style={{ width: size, height: size }} />}>
        <QRCode value={value} size={size} ecl="M" backgroundColor="#ffffff" color="#000000" />
      </React.Suspense>
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    padding: 14,
    borderRadius: radiusTokens.lg,
    backgroundColor: "#ffffff",
    alignSelf: "center",
  },
});

export default DoorPayQr;
