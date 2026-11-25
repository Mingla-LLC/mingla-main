// orch-strict-grep-allow safearea-on-fullscreen-routes — renders VenueCheckInScanScreen (native), which pads its root with useSafeAreaInsets (top and bottom)
/**
 * /venue/[venueId]/check-in/scan (#4490 P2-5) — the venue door camera on the
 * native apps (`ph-scan`, `ph-scan-ok`, `ph-scan-id`, `ph-scan-wrong`,
 * `ph-sell`). Camera first, with the gate numbers under the frame; Type a
 * code and Sell at the gate are pinned. Results come up in a short sheet from
 * `venueCheckInResult`, with haptics. The permission gate and CameraView set-up
 * follow the event scanner; the check-in itself is the venue edge function.
 * The web build resolves `scan.web.tsx` instead (no camera dependency there).
 * Expo Router still bundles this file on web as an unused route chunk, so the
 * camera screen lives in `VenueCheckInScanScreen.native.tsx` and web resolves
 * the empty `VenueCheckInScanScreen.tsx`: expo-camera and the door sale never
 * enter a web chunk from here (they used to be shared, i.e. hoisted into the
 * eager web `__common` chunk).
 */
import React from "react";

import VenueCheckInScanScreen from "../../../../src/components/venue/features/checkin/VenueCheckInScanScreen";

export default function VenueCheckInScanRoute(): React.ReactElement | null {
  return <VenueCheckInScanScreen />;
}
