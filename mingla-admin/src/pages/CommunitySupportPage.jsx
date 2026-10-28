/**
 * #3720 Slice F console, split by #4130 Wave 6 into two pages that share this
 * frame: Support (the inbox first, Email, People and roles) and Community
 * (announcements, roadmap, ideas, moderation, brand groups, feature guide,
 * product inbox). SupportPage and CommunityPage below are the two pages.
 *
 * Each tab keeps its id and its row in communitySupportCapabilityContract.js,
 * and is shown only to the area that row names (communitySupportAccess.js):
 * moving a tab between the two pages changes nobody's access. Old
 * #/community-support and #/email addresses are rewritten in
 * lib/adminRoutes.js before a page is chosen.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Toggle } from "../components/ui/Input";
import { SectionCard } from "../components/ui/Card";
import { SupportDeskPage } from "./SupportDeskPage";
import { EmailPage } from "./EmailPage";
import { AnnouncementsPanel } from "../components/community/AnnouncementsPanel";
import { RoadmapPanel } from "../components/community/RoadmapPanel";
import { TeamRolesPanel } from "../components/community/TeamRolesPanel";
import { BrandGroupsPanel } from "../components/community/BrandGroupsPanel";
import { ProductInboxPanel } from "../components/community/ProductInboxPanel";
import { FeatureGuidePanel } from "../components/community/FeatureGuidePanel";
import { ModerationPanel } from "../components/community/ModerationPanel";
import { ReportedEnquiriesPanel } from "../components/community/ReportedEnquiriesPanel";
import { IdeasPanel } from "../components/community/IdeasPanel";
import { QuestionsPanel } from "../components/community/QuestionsPanel";
import { FailedPushBanner } from "../components/community/FailedPushBanner";
import { BlogPanel } from "../components/blog/BlogPanel";
import { CommunitySupportNavigation } from "../components/community/CommunitySupportNavigation";
import { useAuth } from "../context/AuthContext";
import { AREA } from "../lib/access";
import {
  communitySupportCapabilities,
  communitySupportTabsForAccess,
} from "../lib/communitySupportAccess";
import { pageTabFromHash, pageTabHash, pageTabsFor } from "../lib/supportCommunityTabs";
import { hashPageId } from "../lib/crmUrl";
import {
  getAdminCommunityOverview,
  listSupportStaffRoster,
  setSupportAvailable,
} from "../services/communityService";
import { changeSupportAvailability } from "../lib/supportAvailability";
import { AVAILABLE_OFF_MESSAGE, AVAILABLE_ON_MESSAGE } from "../lib/supportAvailability";

const PAGE_COPY = {
  support: {
    title: "Support",
    adminDescription: "Conversations with hosts and explorers, oldest waiting first.",
    other: { id: "community", label: "Community" },
  },
  community: {
    title: "Community",
    adminDescription: "What we tell hosts, what we've shipped, and what they ask for.",
    other: { id: "support", label: "Support" },
  },
};

function roleDescription(capabilities, isLead) {
  if (capabilities.canSupport && capabilities.canCommunity) {
    return isLead
      ? "You're a Support lead: you work both Community and Support, and approve support issues for the product team."
      : "You're a Support teammate: you work both Community and Support.";
  }
  return capabilities.canSupport ? "Your assigned Host support workspace." : "Your assigned Community workspace.";
}

export function SupportCommunityConsole({ pageId }) {
  const { access, session } = useAuth();
  const copy = PAGE_COPY[pageId];
  const pageTabs = pageTabsFor(pageId);
  const [requestedTab, setRequestedTab] = useState(() => pageTabFromHash(window.location.hash, pageId));
  const [navCounts, setNavCounts] = useState({});
  const [myAvailable, setMyAvailable] = useState(false);
  const [myStaffRole, setMyStaffRole] = useState(null);
  // Bumped after the signed-in admin changes their own availability so the
  // People and roles list shows their new rota state.
  const [peopleRefreshKey, setPeopleRefreshKey] = useState(0);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityError, setAvailabilityError] = useState(null);
  const visibleTabs = useMemo(
    () => communitySupportTabsForAccess(access, pageTabs),
    [access, pageTabs],
  );
  const activeTab = visibleTabs.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : visibleTabs[0]?.id || null;
  const capabilities = communitySupportCapabilities(access);
  // Inviting is the Owner's team_manage power (the same area Admin → Team uses).
  const canInvite = Array.isArray(access?.areas) && access.areas.includes(AREA.TEAM_MANAGE);
  const isLead = myStaffRole === "lead";
  const onSupportPage = pageId === "support";

  // Community tab badges (Admins): the same Admin counts the old console showed.
  // A failed count only hides the badges; each tab shows its own load error.
  useEffect(() => {
    if (onSupportPage || !capabilities.isAdmin) return;
    let cancelled = false;
    void getAdminCommunityOverview().then((data) => {
      if (cancelled) return;
      setNavCounts({
        ideas: Number(data.ideas_to_triage || 0),
        questions: Number(data.unanswered_questions || 0),
        moderation: Number(data.first_posts || 0) + Number(data.reports_due || 0),
      });
    }).catch(() => { if (!cancelled) setNavCounts({}); });
    return () => { cancelled = true; };
  }, [onSupportPage, capabilities.isAdmin]);

  // Support's Inbox badge is the inbox's own Open count, so it always matches.
  const onInboxCounts = useCallback((counts) => {
    setNavCounts((current) => (current.support === counts.open ? current : { ...current, support: counts.open }));
  }, []);

  const onBlogCounts = useCallback((inReview) => {
    setNavCounts((current) => (current.blog === inReview ? current : { ...current, blog: inReview }));
  }, []);

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
    if (!result.message) setPeopleRefreshKey((key) => key + 1);
  }

  useEffect(() => {
    // Only this page's own addresses move its tab: a link to the other page
    // (or an old one App is about to rewrite) must not reset it here first.
    const onHash = () => {
      if (hashPageId(window.location.hash) !== pageId) return;
      setRequestedTab(pageTabFromHash(window.location.hash, pageId));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [pageId]);

  useEffect(() => {
    if (!activeTab || requestedTab === activeTab) return;
    window.history.replaceState(null, "", pageTabHash(pageId, activeTab));
  }, [activeTab, requestedTab, pageId]);

  const changeTab = useCallback((tabId) => {
    if (!visibleTabs.some((tab) => tab.id === tabId)) return;
    window.location.hash = pageTabHash(pageId, tabId);
  }, [visibleTabs, pageId]);

  const description = capabilities.isAdmin ? copy.adminDescription : roleDescription(capabilities, isLead);

  if (!activeTab) {
    return (
      <div className="space-y-6">
        <PageHeader title={copy.title} description={description} />
        <SectionCard title="Nothing here for your role">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Your work is on the {copy.other.label} page.{" "}
            <a
              href={`#/${copy.other.id}`}
              className="font-medium text-[var(--color-brand-700)] underline-offset-2 hover:underline"
            >
              Open {copy.other.label}
            </a>
          </p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={description}
        actions={
          <>
            {onSupportPage && capabilities.canSupport ? (
              <Toggle
                label="Available for support"
                checked={myAvailable}
                disabled={availabilityBusy}
                onChange={(next) => void toggleAvailability(next)}
              />
            ) : null}
            {!onSupportPage && capabilities.isAdmin ? (
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
            label={copy.title}
            tabs={visibleTabs}
            activeTab={activeTab}
            counts={navCounts}
            onChange={changeTab}
          />
        }
      />

      {onSupportPage && availabilityError ? (
        <p
          role="alert"
          className="text-sm text-[var(--color-error-700)]"
        >
          {availabilityError}
        </p>
      ) : onSupportPage && capabilities.canSupport ? (
        <p className="text-sm text-[var(--color-text-secondary)]" aria-live="polite">
          {myAvailable ? AVAILABLE_ON_MESSAGE : AVAILABLE_OFF_MESSAGE}
        </p>
      ) : null}

      {onSupportPage && capabilities.isAdmin ? <FailedPushBanner /> : null}

      {activeTab === "support" && (
        <SupportDeskPage embedded canManageAgents={capabilities.isAdmin} onCounts={onInboxCounts} />
      )}
      {activeTab === "email" && <EmailPage embedded />}
      {activeTab === "blog" && capabilities.canSupport && <BlogPanel onCounts={onBlogCounts} />}
      {activeTab === "team" && capabilities.isAdmin && <TeamRolesPanel canInvite={canInvite} refreshKey={peopleRefreshKey} />}

      {activeTab === "announcements" && <AnnouncementsPanel />}
      {activeTab === "roadmap" && <RoadmapPanel />}
      {activeTab === "ideas" && capabilities.canCommunity && <IdeasPanel />}
      {activeTab === "questions" && capabilities.canCommunity && <QuestionsPanel />}
      {activeTab === "moderation" && capabilities.canCommunity && <ModerationPanel />}
      {activeTab === "enquiry-reports" && capabilities.canCommunity && <ReportedEnquiriesPanel />}
      {activeTab === "brand-groups" && <BrandGroupsPanel />}
      {activeTab === "feature-guide" && capabilities.canSupport && (
        <FeatureGuidePanel canManage={capabilities.isAdmin} />
      )}
      {activeTab === "product" && capabilities.isAdmin && <ProductInboxPanel />}
    </div>
  );
}

// #4130 Wave 6 — Support: the inbox first, then Email and People and roles.
export function SupportPage() {
  return <SupportCommunityConsole pageId="support" />;
}

// #4130 Wave 6 — Community: what hosts are told, what shipped, what they ask for.
export function CommunityPage() {
  return <SupportCommunityConsole pageId="community" />;
}
