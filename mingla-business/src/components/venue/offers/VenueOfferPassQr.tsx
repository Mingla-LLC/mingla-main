/**
 * #4490 P2 — the venue pass QR on the guest's booking page (`/visit/<id>`).
 *
 * Encodes ONLY the server-signed venue pass payload
 * `mingla:v1:vpass:<passId>:sig:<64 hex>` (reconciliation ruling 15: one QR for
 * the party; buying and the pass never need an account on web, ruling 3).
 * Anything else is refused before rendering. Reviewed exception beside
 * VenuePayQr in the #4063 / #2216 gate: this is not an event-ticket
 * credential, and the page that shows it is opened only with the booking's
 * own token.
 */
import React from "react";
import { StyleSheet, View } from "react-native";

import { color, radius, space } from "../../../constants/designSystem";

// Loaded on demand so the QR encoder stays out of the boot chunk.
const QRCode = React.lazy(() => import("react-native-qrcode-svg"));

const VENUE_PASS_PAYLOAD = /^mingla:v1:vpass:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:sig:[0-9a-f]{64}$/;

export const isVenuePassPayload = (value: unknown): value is string =>
  typeof value === "string" && VENUE_PASS_PAYLOAD.test(value);

export interface VenueOfferPassQrProps {
  payload: string;
  size: number;
  testID?: string;
}

export function VenueOfferPassQr({ payload, size, testID }: VenueOfferPassQrProps): React.ReactElement | null {
  if (!isVenuePassPayload(payload)) return null;
  return (
    <View
      style={styles.frame}
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel="Your pass code. Show it at the gate."
    >
      <React.Suspense fallback={<View style={{ width: size, height: size }} />}>
        <QRCode value={payload} size={size} ecl="M" backgroundColor={color.paper} color={color.ink} />
      </React.Suspense>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: color.paper,
    alignSelf: "center",
  },
});
