/**
 * #4490 spec 08 O2 — the Till's Scan to pay QR. Encodes a `/pay/till/<code>`
 * link ONLY (toTillPayUrl), never a ticket or pass credential: the guest scans
 * it with their phone camera and pays there. Reviewed exception beside
 * DoorPayQr and VenuePayQr in the #2216 pay-link allowlist.
 */
import React from "react";
import { StyleSheet, View } from "react-native";

import { color, radius } from "../../../constants/designSystem";
import { toTillPayUrl } from "./tillPayModel";

// Loaded on demand so the QR encoder stays out of the boot chunk.
const QRCode = React.lazy(() => import("react-native-qrcode-svg"));

export function TillPayQr({ url, size, dim = false, testID }: {
  url: string;
  size: number;
  /** Faded while the guest is paying or the code is closed. */
  dim?: boolean;
  testID?: string;
}): React.ReactElement | null {
  const value = toTillPayUrl(url);
  if (value === null) return null;
  return (
    <View
      style={[styles.frame, dim ? styles.dim : null]}
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
  frame: { padding: 14, borderRadius: radius.lg, backgroundColor: color.paper, alignSelf: "center" },
  dim: { opacity: 0.35 },
});
