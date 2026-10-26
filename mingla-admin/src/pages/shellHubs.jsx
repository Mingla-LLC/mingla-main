// Issue #4130 (Wave 0) — the menu's new pages, until each one's own wave
// builds it.
//
//   - A page that replaces older pages holds them as tabs (PageHub), each
//     drawn by its existing component, unchanged: nothing anyone could open
//     before is lost while the rebuild happens wave by wave.
//   - A page with nothing to hold yet (Mingla money, Feature flags) says it
//     is coming, plainly, and shows no numbers.
//
// [TRANSITIONAL] every export here is replaced by its wave's real page
// (Wave 4b Place pool, Platform health, Feature flags, Settings, Team and
// roles) — exit when the last of those waves lands. Wave 4a's Hosts and
// creators (pages/OutreachPage.jsx) and Inbound leads
// (pages/InboundLeadsPage.jsx) have replaced their hubs.
import { Construction } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { PageHub } from "../components/layout/PageHub";
import { PlacePoolManagementPage } from "./PlacePoolManagementPage";
import { LaunchCitiesPage } from "./LaunchCitiesPage";
import { SignalLibraryPage } from "./SignalLibraryPage";
import { DeckScoreTunerPage } from "./DeckScoreTunerPage";
import { ApiHealthPage } from "./ApiHealthPage";
import { StripeModePage } from "./StripeModePage";
import { QueueHealthPage } from "./QueueHealthPage";
import { SettingsPage } from "./SettingsPage";
import { PlaceIntelligenceTrialPage } from "./PlaceIntelligenceTrialPage";
import { AdminPage } from "./AdminPage";
import { CareersPage } from "./CareersPage";

// Old page id -> the component that draws it, per hub (lib/adminRoutes.js).
const PLACE_POOL = {
  placepool: PlacePoolManagementPage,
  "launch-cities": LaunchCitiesPage,
  signals: SignalLibraryPage,
  "deck-tuner": DeckScoreTunerPage,
};
const PLATFORM_HEALTH = { "api-health": ApiHealthPage, "stripe-mode": StripeModePage, "queue-health": QueueHealthPage };
const SETTINGS = { settings: SettingsPage, "place-intelligence-trial": PlaceIntelligenceTrialPage };
const TEAM_AND_ROLES = { admin: AdminPage, careers: CareersPage };

export const HUB_COMPONENTS = Object.freeze({
  placepool: PLACE_POOL,
  "platform-health": PLATFORM_HEALTH,
  settings: SETTINGS,
  admin: TEAM_AND_ROLES,
});

export function PlacePoolHub({ onTabChange }) {
  return <PageHub pageId="placepool" components={PLACE_POOL} onTabChange={onTabChange} />;
}
export function PlatformHealthHub({ onTabChange }) {
  return <PageHub pageId="platform-health" components={PLATFORM_HEALTH} onTabChange={onTabChange} />;
}
export function SettingsHub({ onTabChange }) {
  return <PageHub pageId="settings" components={SETTINGS} onTabChange={onTabChange} />;
}
export function TeamAndRolesHub({ onTabChange }) {
  return <PageHub pageId="admin" components={TEAM_AND_ROLES} onTabChange={onTabChange} />;
}

/** A page that is in the menu but not built yet: says so, shows no numbers. */
function ComingSoon({ title, description, coming }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={title} description={description} />
      <SectionCard>
        <div className="flex items-start gap-3">
          <Construction aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-text-tertiary)]" />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Coming in this release</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{coming}</p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

export function FeatureFlagsPlaceholder() {
  return (
    <ComingSoon
      title="Feature flags"
      description="Which features are on, who changed them and why."
      coming="This page will list every flag with what it does, whether it is on, and when it last changed. Until then, flags are changed in Settings, on the Feature Flags tab."
    />
  );
}
