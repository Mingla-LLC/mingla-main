/**
 * #4490 — web (and default) resolution of the venue door camera screen. The
 * real screen is `VenueCheckInScanScreen.native.tsx` (expo-camera). On web the
 * route resolves `app/venue/[venueId]/check-in/scan.web.tsx`, which opens the
 * Check-in module instead, so this file only satisfies Metro's web resolution
 * of the native route file and must stay empty of camera and door-sale code.
 */
import type React from "react";

export default function VenueCheckInScanScreen(): React.ReactElement | null {
  return null;
}
