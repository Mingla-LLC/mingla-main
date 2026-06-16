/**
 * (tabs)/hub/listing — ORCH-1145 venue tab, now the META-ORCH-1148 Venue Suite.
 *
 * Phase 1 (ORCH-1145) relocated the venue-listing surface into a conditional
 * "Venue" Hub pill. Phase 2.0 (META-ORCH-1148) mounts the Venue SUITE SHELL
 * here: the ORCH-1145 listing becomes the suite's Overview module (preserved
 * VERBATIM), with the Reservations toggle + Settings module + the booking-band
 * ComingSoon states layered on by the shell.
 *
 * Chrome (TopBar + To-Do toggle + the module/offering pill row) is owned by
 * `hub/_layout.tsx`. While this tab is mounted it sets `venueSuiteStore.active`,
 * which tells the layout to REPLACE the Hub offering pills with the venue module
 * pill row on native + web-phone (LOCKED DECISION 5). The flag is cleared on
 * unmount, restoring the Hub pills.
 *
 * Visibility of the Venue pill itself stays gated upstream in
 * `deriveHubVisibleTabs` on `hasPhysicalLocation || placePoolId` (ORCH-1145) —
 * unchanged.
 */
import React, { useEffect } from "react";
import { useLocalSearchParams } from "expo-router";

import { VenueSuiteShell } from "../../../src/components/venue/VenueSuiteShell";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import { useVenueSuiteStore } from "../../../src/store/venueSuiteStore";

export default function HubVenueListingTab(): React.ReactElement {
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;

  // The deep-link `?focus=feedback` arrives here when the kept route alias
  // (`/brand/{id}/listing?focus=feedback`) redirects in, forwarding the param.
  const params = useLocalSearchParams<{ focus?: string | string[] }>();
  const focusParam = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const focus = focusParam === "feedback" ? "feedback" : undefined;

  // META-ORCH-1148 — signal the Hub layout to swap in the venue module pill row
  // (in place of the Hub offering pills) while the suite is mounted, and restore
  // the Hub pills on unmount. NEVER navigates — pure render-swap signal.
  const activate = useVenueSuiteStore((s) => s.activate);
  const deactivate = useVenueSuiteStore((s) => s.deactivate);
  useEffect(() => {
    activate("overview");
    return () => deactivate();
  }, [activate, deactivate]);

  return <VenueSuiteShell brandId={brandId} focus={focus} />;
}
