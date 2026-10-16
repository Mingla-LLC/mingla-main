/**
 * #3720 Slice F — Community & Support console.
 *
 * One admin surface for announcements, roadmap, support tickets, bulk email,
 * community roles, and support availability. Legacy hashes `#/support` and
 * `#/email` are rewritten in App.jsx to `#/community-support?tab=…`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { SectionCard } from "../components/ui/Card";
import { SupportDeskPage } from "./SupportDeskPage";
import { EmailPage } from "./EmailPage";
import { OverviewPanel } from "../components/community/OverviewPanel";
import { AnnouncementsPanel } from "../components/community/AnnouncementsPanel";
import { RoadmapPanel } from "../components/community/RoadmapPanel";
import { TeamRolesPanel } from "../components/community/TeamRolesPanel";
import { AvailabilityPanel } from "../components/community/AvailabilityPanel";
import { useAuth } from "../context/AuthContext";
import {
  communitySupportCapabilities,
  communitySupportTabsForAccess,
  defaultCommunitySupportTab,
} from "../lib/communitySupportAccess";

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
  const { access } = useAuth();
  const [requestedTab, setRequestedTab] = useState(() => tabFromCommunityHash());
  const visibleTabs = useMemo(
    () => communitySupportTabsForAccess(access, COMMUNITY_SUPPORT_TABS),
    [access],
  );
  const defaultTab = defaultCommunitySupportTab(access);
  const activeTab = visibleTabs.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : defaultTab;
  const capabilities = communitySupportCapabilities(access);

  useEffect(() => {
    const onHash = () => setRequestedTab(tabFromCommunityHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!activeTab || requestedTab === activeTab) return;
    window.history.replaceState(null, "", communitySupportHashForTab(activeTab));
  }, [activeTab, requestedTab]);

  const changeTab = useCallback((tabId) => {
    if (!visibleTabs.some((tab) => tab.id === tabId)) return;
    window.location.hash = communitySupportHashForTab(tabId);
  }, [visibleTabs]);

  if (!activeTab) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Community & Support"
          description="Your assigned Community and Support workspace."
        />
        <SectionCard title="Access needed">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Your account does not have an active Community or Support assignment.
          </p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Community & Support"
        description={capabilities.isAdmin
          ? "Announcements, roadmap, Host support, and email — one console."
          : capabilities.canSupport && capabilities.canCommunity
            ? "Your assigned Community and Support workspace."
            : capabilities.canSupport
              ? "Your assigned Host support workspace."
              : "Your assigned Community workspace."}
        tabs={
          <Tabs
            tabs={visibleTabs}
            activeTab={activeTab}
            onChange={changeTab}
          />
        }
      />

      {activeTab === "overview" && capabilities.isAdmin && <OverviewPanel onGoTab={changeTab} />}
      {activeTab === "overview" && !capabilities.isAdmin && (
        <SectionCard title="Community access is active">
          <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
            <p>You are approved for Mingla Community work.</p>
            <p>
              Announcement publishing, roadmap management, email, and team settings remain
              Admin-only. Community moderation tools will appear here when that workflow ships.
            </p>
          </div>
        </SectionCard>
      )}
      {activeTab === "announcements" && <AnnouncementsPanel />}
      {activeTab === "roadmap" && <RoadmapPanel />}
      {activeTab === "support" && (
        <SupportDeskPage embedded canManageAgents={capabilities.isAdmin} />
      )}
      {activeTab === "email" && <EmailPage embedded />}
      {activeTab === "team" && <TeamRolesPanel />}
      {activeTab === "availability" && <AvailabilityPanel />}
    </div>
  );
}

export default CommunitySupportPage;
