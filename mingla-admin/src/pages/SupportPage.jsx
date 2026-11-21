/**
 * Support: the chat inbox first, then People and roles (full admins). #4420
 * replaced the shared Community & Support frame (pages/CommunitySupportPage,
 * #3720 Slice F, split by #4130 Wave 6): Community is retired, Reported
 * enquiries arrive in this inbox, and the Feature guide is its own
 * Communications screen. Old #/community and #/community-support addresses
 * are rewritten in lib/adminRoutes.js before a page is chosen.
 *
 * Each tab keeps its id and its row in communitySupportCapabilityContract.js,
 * and is shown only to the area that row names (communitySupportAccess.js).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { Toggle } from "../components/ui/Input";
import { SectionCard } from "../components/ui/Card";
import { Tabs } from "../components/ui/Tabs";
import { SupportDeskPage } from "./SupportDeskPage";
import { TeamRolesPanel } from "../components/community/TeamRolesPanel";
import { useAuth } from "../context/AuthContext";
import { AREA } from "../lib/access";
import {
  communitySupportCapabilities,
  communitySupportTabsForAccess,
} from "../lib/communitySupportAccess";
import { pageTabFromHash, pageTabHash, pageTabsFor } from "../lib/supportCommunityTabs";
import { hashPageId } from "../lib/crmUrl";
import { listSupportStaffRoster, setSupportAvailable } from "../services/communityService";
import {
  AVAILABLE_OFF_MESSAGE,
  AVAILABLE_ON_MESSAGE,
  changeSupportAvailability,
} from "../lib/supportAvailability";

const PAGE_ID = "support";

function roleDescription(capabilities, isLead) {
  if (capabilities.isAdmin) return "Conversations with hosts and explorers. The ones that need a reply come first.";
  if (capabilities.canSupport) {
    return isLead
      ? "You're a Support lead: you answer hosts and explorers and turn what they report into tickets."
      : "Your assigned Host support workspace.";
  }
  // #4383: a role with no Support area never reaches this page (lib/access.js).
  return "Nothing on this page is assigned to your role.";
}

export function SupportPage() {
  const { access, session } = useAuth();
  const pageTabs = pageTabsFor(PAGE_ID);
  const [requestedTab, setRequestedTab] = useState(() => pageTabFromHash(window.location.hash, PAGE_ID));
  const [inboxOpen, setInboxOpen] = useState(0);
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
  // Inviting is the team_manage power (#4255: owner, admin and partner).
  const canInvite = Array.isArray(access?.areas) && access.areas.includes(AREA.TEAM_MANAGE);
  const isLead = myStaffRole === "lead";

  // The Inbox badge is the inbox's own Open count, so it always matches.
  const onInboxCounts = useCallback((counts) => {
    setInboxOpen((current) => (current === counts.open ? current : counts.open));
  }, []);

  useEffect(() => {
    if (!capabilities.canSupport || !session?.user?.id) return;
    let cancelled = false;
    void listSupportStaffRoster().then((rows) => {
      if (cancelled) return;
      const mine = rows.find((row) => row.user_id === session.user.id);
      setMyAvailable(Boolean(mine?.enabled && mine?.available));
      setMyStaffRole(mine?.enabled ? mine.role : null);
    }).catch((cause) => {
      // The switch then reads Off; the inbox itself still loads.
      if (!cancelled) console.error("Support roster read failed:", cause?.message || cause);
    });
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
    // Only this page's own addresses move its tab: a link to another page
    // (or an old one App is about to rewrite) must not reset it here first.
    const onHash = () => {
      if (hashPageId(window.location.hash) !== PAGE_ID) return;
      setRequestedTab(pageTabFromHash(window.location.hash, PAGE_ID));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!activeTab || requestedTab === activeTab) return;
    window.history.replaceState(null, "", pageTabHash(PAGE_ID, activeTab));
  }, [activeTab, requestedTab]);

  const changeTab = useCallback((tabId) => {
    if (!visibleTabs.some((tab) => tab.id === tabId)) return;
    window.location.hash = pageTabHash(PAGE_ID, tabId);
  }, [visibleTabs]);

  const description = roleDescription(capabilities, isLead);

  if (!activeTab) {
    return (
      <div className="space-y-6">
        <PageHeader title="Support" description={description} />
        <SectionCard title="Nothing here for your role">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Support conversations are for the Support team. Ask an admin if you need access.
          </p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support"
        description={description}
        actions={capabilities.canSupport ? (
          <Toggle
            label="Available for support"
            checked={myAvailable}
            disabled={availabilityBusy}
            onChange={(next) => void toggleAvailability(next)}
          />
        ) : null}
        tabs={visibleTabs.length > 1 ? (
          <Tabs
            tabs={visibleTabs.map((tab) => ({
              id: tab.id,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {tab.label}
                  {tab.id === "support" && inboxOpen > 0 ? (
                    <span className="rounded-full bg-[var(--color-brand-100)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-brand-700)]">
                      {inboxOpen}
                    </span>
                  ) : null}
                </span>
              ),
            }))}
            activeTab={activeTab}
            onChange={changeTab}
          />
        ) : null}
      />

      {availabilityError ? (
        <p role="alert" className="text-sm text-[var(--color-error-700)]">
          {availabilityError}
        </p>
      ) : capabilities.canSupport ? (
        <p className="text-sm text-[var(--color-text-secondary)]" aria-live="polite">
          {myAvailable ? AVAILABLE_ON_MESSAGE : AVAILABLE_OFF_MESSAGE}
        </p>
      ) : null}

      {activeTab === "support" && (
        <SupportDeskPage embedded canManageAgents={capabilities.isAdmin} onCounts={onInboxCounts} />
      )}
      {activeTab === "team" && capabilities.isAdmin && <TeamRolesPanel canInvite={canInvite} refreshKey={peopleRefreshKey} />}
    </div>
  );
}
