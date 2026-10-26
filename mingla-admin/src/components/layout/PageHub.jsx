// Issue #4130 (Wave 0) — a page that holds older pages as tabs until its own
// wave rebuilds it (Hosts and creators holds the Hosts and Creators boards,
// People holds Users and the business People console, and so on).
//
//   - The tabs come from PAGE_HUB_TABS (lib/adminRoutes.js); `components`
//     maps each old page id to the component that draws it, unchanged.
//   - A tab is shown only to whoever could open the old page it shows
//     (canOpenOwnPage): merging pages never widens who sees what.
//   - The open tab lives in the address (#/people?tab=hosts), so a reload, a
//     pasted link or an old bookmark lands on the same tab.
//   - The page inside reads and writes its own query inside this address
//     (HostedPageContext, hooks/useHashQuery.js), so it needs no change.
import { useEffect, useMemo, useState } from "react";
import { Tabs } from "../ui/Tabs";
import { useAuth } from "../../context/AuthContext";
import { canOpenOwnPage } from "../../lib/access";
import { hubTabFromHash, hubTabHash, hubTabs } from "../../lib/adminRoutes";
import { HostedPageContext } from "../../hooks/useHashQuery";

function currentHash() {
  return typeof window === "undefined" ? "" : window.location.hash;
}

export function PageHub({ pageId, components, onTabChange }) {
  const { access } = useAuth();
  const [requested, setRequested] = useState(() => hubTabFromHash(currentHash(), pageId));

  useEffect(() => {
    const onHash = () => setRequested(hubTabFromHash(currentHash(), pageId));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [pageId]);

  const visible = useMemo(
    () => (hubTabs(pageId) || []).filter((tab) => canOpenOwnPage(access, tab.hosts) && components[tab.hosts]),
    [pageId, access, components]
  );
  const active = visible.find((tab) => tab.id === requested) || visible[0] || null;
  const alias = useMemo(
    () => (active ? { page: pageId, tab: active.id, hosts: active.hosts } : null),
    [pageId, active]
  );

  if (!active) return null;
  const Hosted = components[active.hosts];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {visible.length > 1 && (
        <Tabs
          tabs={visible.map((tab) => ({ id: tab.id, label: tab.label }))}
          activeTab={active.id}
          onChange={(tabId) => {
            window.location.hash = hubTabHash(pageId, tabId);
          }}
        />
      )}
      <div role={visible.length > 1 ? "tabpanel" : undefined} id={`tabpanel-${active.id}`} aria-labelledby={visible.length > 1 ? `tab-${active.id}` : undefined}>
        <HostedPageContext.Provider value={alias}>
          <Hosted key={active.id} onTabChange={onTabChange} />
        </HostedPageContext.Provider>
      </div>
    </div>
  );
}
