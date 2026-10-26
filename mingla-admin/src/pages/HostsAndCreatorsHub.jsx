// Issue #4130 (Wave 4a) — Hosts and creators (#/outreach): one page, two tabs.
//
// Replaces the Wave 0 hub. The tabs keep their addresses (#/outreach?tab=hosts,
// old #/hosts and #/creators links redirect here) and each tab is shown only
// to whoever could open the old page (lib/access.js canOpenOwnPage). The
// counts on the tabs, the funnel and the due chips come from one server read
// over every card (outreach_summary); the board itself is the existing
// PipelinePage, which draws the one page header with these tabs in it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerRead } from "../hooks/useServerRead";
import { Tabs } from "../components/ui/Tabs";
import { useAuth } from "../context/AuthContext";
import { canOpenOwnPage } from "../lib/access";
import { hubTabFromHash, hubTabHash, hubTabs } from "../lib/adminRoutes";
import { localToday } from "../lib/crmModel";
import { HostedPageContext } from "../components/layout/hostedPageContext";
import { OutreachContext } from "../components/outreach/OutreachContext";
import { getOutreachSummary } from "../services/dashboardService";
import { HostsPage, CreatorsPage } from "./PipelinePage";

const PAGE_ID = "outreach";
const COMPONENTS = { hosts: HostsPage, creators: CreatorsPage };

function currentHash() {
  return typeof window === "undefined" ? "" : window.location.hash;
}

export function OutreachPage({ onTabChange }) {
  const { access } = useAuth();
  const [requested, setRequested] = useState(() => hubTabFromHash(currentHash(), PAGE_ID));
  useEffect(() => {
    const onHash = () => setRequested(hubTabFromHash(currentHash(), PAGE_ID));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const visible = useMemo(
    () => (hubTabs(PAGE_ID) || []).filter((tab) => canOpenOwnPage(access, tab.hosts) && COMPONENTS[tab.hosts]),
    [access]
  );
  const active = visible.find((tab) => tab.id === requested) || visible[0] || null;
  const alias = useMemo(() => (active ? { page: PAGE_ID, tab: active.id, hosts: active.hosts } : null), [active]);

  const loadSummary = useCallback(() => getOutreachSummary(localToday()), []);
  const summaryRead = useServerRead(loadSummary);
  const { status, data, error, retry } = summaryRead;

  const context = useMemo(() => {
    const tabs = visible.length > 1 ? (
      <Tabs
        tabs={visible.map((tab) => {
          const total = data?.pipelines?.[tab.hosts]?.total;
          return { id: tab.id, label: total == null ? tab.label : `${tab.label} · ${Number(total).toLocaleString()}` };
        })}
        activeTab={active?.id}
        onChange={(tabId) => { window.location.hash = hubTabHash(PAGE_ID, tabId); }}
      />
    ) : null;
    return { summary: { status, data, error }, retrySummary: retry, tabs, tabId: active?.id || null };
  }, [visible, active, status, data, error, retry]);

  if (!active) return null;
  const Hosted = COMPONENTS[active.hosts];
  return (
    <OutreachContext.Provider value={context}>
      <HostedPageContext.Provider value={alias}>
        <Hosted key={active.id} onTabChange={onTabChange} />
      </HostedPageContext.Provider>
    </OutreachContext.Provider>
  );
}
