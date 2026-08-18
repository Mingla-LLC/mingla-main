/**
 * #2099 — Business NATIVE launcher: a deliberate no-op.
 *
 * Amendment 4 §D2. The pending-venue identity correction is a web-only operator
 * tool. This file is what iOS and Android resolve for the extensionless
 * `../../../src/components/venue/PendingVenueIdentityCorrectionLauncher` import
 * in `app/venue/[venueId]/index.tsx`, and it imports NO correction service, no
 * dialog, no `Input`, no `Modal`, and NO correction copy — so the feature is
 * absent from the native import graph rather than merely hidden behind a
 * `Platform.OS` branch (the exact defect independent testing rejected).
 *
 * Renders `null` for pending AND non-pending venues alike, and emits nothing:
 * neither the web control's testID nor its label appears anywhere in this file,
 * which is what Check P's P-10 disk-truth assertion pins.
 */

import React from "react";

export interface PendingVenueIdentityCorrectionLauncherProps {
  venueId: string | null;
  claimStatus: string | null;
  onSuccess?: () => void;
}

export function PendingVenueIdentityCorrectionLauncher(
  _props: PendingVenueIdentityCorrectionLauncherProps,
): React.ReactElement | null {
  return null;
}

export default PendingVenueIdentityCorrectionLauncher;
