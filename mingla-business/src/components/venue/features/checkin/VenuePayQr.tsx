/**
 * #4490 P2-5 — the gate pay-by-code QR. Encodes a `/visit/<groupId>#t=…` pay
 * link ONLY (see venuePayLink.ts), never a pass credential: the guest scans
 * it with their phone camera and pays there. Reviewed exception beside
 * DoorPayQr in the #4063 gate allowlist (I-4063-NO-TICKET-QR-OFF-EXPLORER).
 */
import React from "react";
import { StyleSheet, View } from "react-native";

import { color, radius } from "../../../../constants/designSystem";
import { assertVenuePayUrl, type VenuePayUrl } from "./venuePayLink";

// Loaded on demand so the QR encoder stays out of the boot chunk.
const QRCode = React.lazy(() => import("react-native-qrcode-svg"));

export interface VenuePayQrProps {
  url: VenuePayUrl;
  size: number;
  testID?: string;
}

export function VenuePayQr({ url, size, testID }: VenuePayQrProps): React.ReactElement {
  const value = assertVenuePayUrl(url);
  return (
    <View
      style={styles.frame}
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel="Pay code. The guest scans it with their phone camera and pays there."
    >
      <React.Suspense fallback={<View style={{ width: size, height: size }} />}>
        <QRCode value={value} size={size} ecl="M" backgroundColor={color.paper} color={color.ink} />
      </React.Suspense>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: color.paper,
    alignSelf: "center",
  },
});
