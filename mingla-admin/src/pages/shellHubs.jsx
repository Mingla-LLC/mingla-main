// Issue #4130 (Wave 0) — the menu's new pages, until each one's own wave
// builds it.
//
//   - A page that replaces older pages holds them as tabs (PageHub), each
//     drawn by its existing component, unchanged: nothing anyone could open
//     before is lost while the rebuild happens wave by wave.
//
// [TRANSITIONAL] every export here is replaced by its wave's real page
// (Wave 4a Hosts and creators and Inbound leads) — exit when that wave lands.
// #4130 Wave 4b built Place pool, Platform health, Feature flags, Settings and
// Team and roles as real pages (App.jsx).
import { PageHub } from "../components/layout/PageHub";
import { HostsPage, CreatorsPage } from "./PipelinePage";
import { BetaLeadsPage } from "./BetaLeadsPage";
import { ToolLeadsPage } from "./ToolLeadsPage";

// Old page id -> the component that draws it, per hub (lib/adminRoutes.js).
const OUTREACH = { hosts: HostsPage, creators: CreatorsPage };
const INBOUND = { "beta-leads": BetaLeadsPage, "tool-leads": ToolLeadsPage };

export const HUB_COMPONENTS = Object.freeze({
  outreach: OUTREACH,
  inbound: INBOUND,
});

export function OutreachHub({ onTabChange }) {
  return <PageHub pageId="outreach" components={OUTREACH} onTabChange={onTabChange} />;
}
export function InboundHub({ onTabChange }) {
  return <PageHub pageId="inbound" components={INBOUND} onTabChange={onTabChange} />;
}
