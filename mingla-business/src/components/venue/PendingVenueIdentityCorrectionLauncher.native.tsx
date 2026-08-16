/**
 * #2099 — Business NATIVE launcher: a deliberate no-op.
 *
 * SPEC + Amendments 1–5, §D2. The pending-venue identity correction is a
 * web-only operator tool. This file is what iOS and Android resolve for the
 * extensionless `./PendingVenueIdentityCorrectionLauncher` import in
 * `VenueListingContent.tsx`, and it imports NO correction service, dialog,
 * `Input`, `Modal`, or correction copy — so the correction feature is absent
 * from the native import graph rather than merely hidden behind a
 * `Platform.OS` branch (the exact defect independent testing rejected).
 *
 * Renders `null` for pending AND non-pending venues alike.
 */

import React from "react";

export interface PendingVenueIdentityCorrectionLauncherProps {
  venueId: string | null;
  claimStatus: string | null;
  onSuccess: () => void;
}

export function PendingVenueIdentityCorrectionLauncher(
  _props: PendingVenueIdentityCorrectionLauncherProps,
): React.ReactElement | null {
  return null;
}
