/**
 * #3720 Slice F — Community & Support console.
 *
 * One admin surface for announcements, roadmap, support tickets, bulk email,
 * community roles, and support availability. Legacy hashes `#/support` and
 * `#/email` are rewritten in App.jsx to `#/community-support?tab=…`.
 */

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { SupportDeskPage } from "./SupportDeskPage";
import { EmailPage } from "./EmailPage";
import { OverviewPanel } from "../components/community/OverviewPanel";
import { AnnouncementsPanel } from "../components/community/AnnouncementsPanel";
import { RoadmapPanel } from "../components/community/RoadmapPanel";
import { TeamRolesPanel } from "../components/community/TeamRolesPanel";
import { AvailabilityPanel } from "../components/community/AvailabilityPanel";

export const COMMUNITY_SUPPORT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "announcements", label: "Announcements" },
  { id: "roadmap", label: "Roadmap" },
  { id: "support", label: "Support" },
  { id: "email", label: "Email" },
  { id: "team", label: "Team & roles" },
  { id: "availability", label: "Availability" },
];

const TAB_IDS = new Set(COMMUNITY_SUPPORT_TABS.map((t) => t.id));

function hashParams() {
  return new URLSearchParams(window.location.hash.split("?")[1] || "");
}

export function tabFromCommunityHash() {
  const t = hashParams().get("tab");
  return TAB_IDS.has(t) ? t : "overview";
}

export function communitySupportHashForTab(tabId) {
  const id = TAB_IDS.has(tabId) ? tabId : "overview";
  return `#/community-support?tab=${id}`;
}

export function CommunitySupportPage() {
  const [activeTab, setActiveTab] = useState(() => tabFromCommunityHash());

  useEffect(() => {
    const onHash = () => setActiveTab(tabFromCommunityHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const changeTab = useCallback((tabId) => {
    window.location.hash = communitySupportHashForTab(tabId);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Community & Support"
        description="Announcements, roadmap, Host support, and email — one console."
        tabs={
          <Tabs
            tabs={COMMUNITY_SUPPORT_TABS}
            activeTab={activeTab}
            onChange={changeTab}
          />
        }
      />

      {activeTab === "overview" && <OverviewPanel onGoTab={changeTab} />}
      {activeTab === "announcements" && <AnnouncementsPanel />}
      {activeTab === "roadmap" && <RoadmapPanel />}
      {activeTab === "support" && <SupportDeskPage embedded />}
      {activeTab === "email" && <EmailPage embedded />}
      {activeTab === "team" && <TeamRolesPanel />}
      {activeTab === "availability" && <AvailabilityPanel />}
    </div>
  );
}

export default CommunitySupportPage;
