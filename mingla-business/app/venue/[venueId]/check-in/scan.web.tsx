/**
 * /venue/[venueId]/check-in/scan — WEB (#4490 P2-5). The browser has no
 * expo-camera scanner, so this route never ships the native camera to web: it
 * opens the venue's Check-in module, whose Scan panel uses the browser camera
 * where it can read QR codes and a code field everywhere else.
 */
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { color } from "../../../../src/constants/designSystem";

export default function VenueCheckInScanWebRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ venueId?: string | string[] }>();
  const venueId = Array.isArray(params.venueId) ? params.venueId[0] : params.venueId;
  useEffect(() => {
    if (typeof venueId === "string" && venueId.length > 0) {
      router.replace(`/venue/${venueId}?module=checkin` as never);
    } else {
      router.replace("/(tabs)/hub/listing" as never);
    }
  }, [router, venueId]);
  return (
    <View style={styles.root}>
      <ActivityIndicator color={color.text2} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.canvas },
});
