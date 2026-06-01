/**
 * (tabs)/hub/getstarted — DECOMMISSIONED by ORCH-1038.
 *
 * The chunky 3-tile OfferingChooser "Get started" page took too much space and
 * made the UI unfriendly (operator, 2026-06-01). Creating a first offering now
 * lives as a single row in the shared to-do toggle, which opens the compact
 * UniversalCreatorSheet. The "Get started" sub-nav pill is gone too
 * (deriveHubVisibleTabs no longer returns it), so this route is unreachable via
 * navigation; this redirect is a safety net for any stale deep link / history.
 */
import React from "react";
import { Redirect } from "expo-router";

export default function HubGetStartedRoute(): React.ReactElement {
  return <Redirect href="/(tabs)/hub/events" />;
}
