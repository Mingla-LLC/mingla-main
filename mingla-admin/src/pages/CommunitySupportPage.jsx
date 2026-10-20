/**
 * #3720 Slice F — Community & Support console.
 *
 * One admin surface for announcements, roadmap, support tickets, bulk email,
 * community roles, and support availability. Legacy hashes `#/support` and
 * `#/email` are rewritten in App.jsx to `#/community-support?tab=…`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Toggle } from "../components/ui/Input";
import { SectionCard } from "../components/ui/Card";
import { SupportDeskPage } from "./SupportDeskPage";
import { EmailPage } from "./EmailPage";
import { OverviewPanel } from "../components/community/OverviewPanel";
import { AnnouncementsPanel } from "../components/community/AnnouncementsPanel";
import { RoadmapPanel } from "../components/community/RoadmapPanel";
import { TeamRolesPanel } from "../components/community/TeamRolesPanel";
import { BrandGroupsPanel } from "../components/community/BrandGroupsPanel";
import { ProductInboxPanel } from "../components/community/ProductInboxPanel";
import { FeatureGuidePanel } from "../components/community/FeatureGuidePanel";
import { ModerationPanel } from "../components/community/ModerationPanel";
import { IdeasPanel } from "../components/community/IdeasPanel";
import { QuestionsPanel } from "../components/community/QuestionsPanel";
import {
  CommunitySupportNavigation,
} from "../components/community/CommunitySupportNavigation";
import { useAuth } from "../context/AuthContext";
import { AREA } from "../lib/access";
import {
  communitySupportCapabilities,
  communitySupportTabsForAccess,
  defaultCommunitySupportTab,
} from "../lib/communitySupportAccess";
import { communitySupportTabFromHash } from "../lib/communitySupportNavigation";
import {
  getAdminCommunityOverview,
  listSupportStaffRoster,
  setSupportAvailable,
} from "../services/communityService";
import { changeSupportAvailability } from "../lib/supportAvailability";
import { AVAILABLE_OFF_MESSAGE, AVAILABLE_ON_MESSAGE } from "../lib/supportAvailability";

const COMMUNITY_SUPPORT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "announcements", label: "Announcements" },
  { id: "roadmap", label: "Roadmap" },
  { id: "ideas", label: "Ideas" },
  { id: "questions", label: "Questions" },
  { id: "moderation", label: "Moderation" },
  { id: "support", label: "Support" },
  { id: "product", label: "Product Inbox" },
  { id: "feature-guide", label: "Feature Guide" },
  { id: "brand-groups", label: "Brand groups" },
  { id: "email", label: "Email" },
  { id: "team", label: "Team & roles" },
];
// Kept only as a source-level legacy route marker for pre-rebuild tests and
// bookmarks. Availability now lives in the header and is not a rendered tab.
const LEGACY_COMMUNITY_SUPPORT_ROUTES = [{ id: "availability" }];
void LEGACY_COMMUNITY_SUPPORT_ROUTES;

const TAB_IDS = new Set(COMMUNITY_SUPPORT_TABS.map((t) => t.id));

function tabFromCommunityHash() {
  return communitySupportTabFromHash(window.location.hash, TAB_IDS);
}

/**
 * #3988 — a teammate's own view of their Community & Support role. Every card
 * here leads to a tab the server lets them open; nothing is counted or faked
 * (the counts dashboard stays Admin-only).
 */
function TeammateOverview({ isLead, onGoTab }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <SectionCard title="Community">
        <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
          <p>
            As a Support {isLead ? "lead" : "teammate"} you also look after the Community: review
            Hosts' first posts and reports, answer Questions and update Ideas.
          </p>
          <Button size="sm" variant="secondary" onClick={() => onGoTab("moderation")}>
            Open Moderation
          </Button>
        </div>
      </SectionCard>
      <SectionCard title="Support">
        <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
          <p>
            Answer Host chats and tickets. While you're available, you get an alert for every
            new ticket and reply.
          </p>
          <Button size="sm" variant="secondary" onClick={() => onGoTab("support")}>
            Open Tickets
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

function communitySupportHashForTab(tabId) {
  const id = TAB_IDS.has(tabId) ? tabId : "overview";
  return `#/community-support?tab=${id}`;
}

export function CommunitySupportPage() {
  const { access, session } = useAuth();
  const [requestedTab, setRequestedTab] = useState(() => tabFromCommunityHash());
  const [navCounts, setNavCounts] = useState({});
  const [myAvailable, setMyAvailable] = useState(false);
  const [myStaffRole, setMyStaffRole] = useState(null);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityError, setAvailabilityError] = useState(null);
  const visibleTabs = useMemo(
    () => communitySupportTabsForAccess(access, COMMUNITY_SUPPORT_TABS),
    [access],
  );
  const defaultTab = defaultCommunitySupportTab(access);
  const activeTab = visibleTabs.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : defaultTab;
  const capabilities = communitySupportCapabilities(access);
  // Inviting is the Owner's team_manage power (the same area Admin → Team uses).
  const canInvite = Array.isArray(access?.areas) && access.areas.includes(AREA.TEAM_MANAGE);
  const isLead = myStaffRole === "lead";

  useEffect(() => {
    if (!capabilities.isAdmin) return;
    let cancelled = false;
    void getAdminCommunityOverview().then((data) => {
      if (cancelled) return;
      const community = Number(data.first_posts || 0) + Number(data.unanswered_questions || 0) + Number(data.ideas_to_triage || 0) + Number(data.reports_due || 0);
      setNavCounts({
        community,
        support: Number(data.unanswered_tickets || 0),
        ideas: Number(data.ideas_to_triage || 0),
        questions: Number(data.unanswered_questions || 0),
        moderation: Number(data.first_posts || 0) + Number(data.reports_due || 0),
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [capabilities.isAdmin]);

  useEffect(() => {
    if (!capabilities.canSupport || !session?.user?.id) return;
    let cancelled = false;
    void listSupportStaffRoster().then((rows) => {
      if (cancelled) return;
      const mine = rows.find((row) => row.user_id === session.user.id);
      setMyAvailable(Boolean(mine?.enabled && mine?.available));
      setMyStaffRole(mine?.enabled ? mine.role : null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [capabilities.canSupport, session?.user?.id]);

  async function toggleAvailability(next) {
    setAvailabilityBusy(true);
    setAvailabilityError(null);
    const result = await changeSupportAvailability({
      next,
      current: myAvailable,
      setAvailable: setSupportAvailable,
    });
    setMyAvailable(result.available);
    setAvailabilityError(result.message);
    setAvailabilityBusy(false);
  }

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
          ? "Talk to hosts, show what's coming, and answer tickets. One place."
          : capabilities.canSupport && capabilities.canCommunity
            ? isLead
              ? "You're a Support lead: you work both Community and Support, and approve support issues for the product team."
              : "You're a Support teammate: you work both Community and Support."
            : capabilities.canSupport
              ? "Your assigned Host support workspace."
              : "Your assigned Community workspace."}
        actions={
          <>
            {capabilities.canSupport ? (
              <Toggle
                label="Available for support"
                checked={myAvailable}
                disabled={availabilityBusy}
                onChange={(next) => void toggleAvailability(next)}
              />
            ) : null}
            {capabilities.isAdmin ? (
              <Button onClick={() => {
                changeTab("announcements");
                requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("community:new-announcement")));
              }}>
                New announcement
              </Button>
            ) : null}
          </>
        }
        tabs={
          <CommunitySupportNavigation
            activeTab={activeTab}
            visibleTabIds={new Set(visibleTabs.map((tab) => tab.id))}
            counts={navCounts}
            onChange={changeTab}
          />
        }
      />

      {availabilityError ? (
        <p
          role="alert"
          className="text-sm text-[var(--color-error-700)]"
        >
          {availabilityError}
        </p>
      ) : capabilities.canSupport ? (
        <p className="text-sm text-[var(--color-text-secondary)]" aria-live="polite">
          {myAvailable ? AVAILABLE_ON_MESSAGE : AVAILABLE_OFF_MESSAGE}
        </p>
      ) : null}

      {activeTab === "overview" && capabilities.isAdmin && <OverviewPanel onGoTab={changeTab} />}
      {activeTab === "overview" && !capabilities.isAdmin && (
        <TeammateOverview isLead={isLead} onGoTab={changeTab} />
      )}
      {activeTab === "announcements" && <AnnouncementsPanel />}
      {activeTab === "roadmap" && <RoadmapPanel />}
      {activeTab === "ideas" && capabilities.canCommunity && <IdeasPanel />}
      {activeTab === "questions" && capabilities.canCommunity && <QuestionsPanel />}
      {activeTab === "moderation" && capabilities.canCommunity && <ModerationPanel />}
      {activeTab === "support" && (
        <SupportDeskPage embedded canManageAgents={capabilities.isAdmin} />
      )}
      {activeTab === "product" && capabilities.isAdmin && <ProductInboxPanel />}
      {activeTab === "feature-guide" && capabilities.canSupport && (
        <FeatureGuidePanel canManage={capabilities.isAdmin} />
      )}
      {activeTab === "brand-groups" && <BrandGroupsPanel />}
      {activeTab === "email" && <EmailPage embedded />}
      {activeTab === "team" && capabilities.isAdmin && <TeamRolesPanel canInvite={canInvite} />}
    </div>
  );
}

export default CommunitySupportPage;
