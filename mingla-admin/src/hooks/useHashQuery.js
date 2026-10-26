// Issue #3802 (Wave 1) — state kept in the part of the address after "?".
//
// A page reads its view, filters and open card from the address, so a reload
// or a pasted link shows exactly the same thing. The app's router looks only
// at the first path segment (App.jsx), so the query survives the route guard.
//
// Issue #4130 (Wave 0): a page can be shown as a tab of a newer page (the Hosts
// board inside Hosts and creators, at #/outreach?tab=hosts). PageHub says so
// through HostedPageContext; the page then reads and writes its query inside
// the hub's address, without the hub's own `tab`, and needs no change itself.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { hashPageId, hashSearch } from "../lib/crmUrl";
import { hostedHash, hostedSearch } from "../lib/adminRoutes";

/** { page, tab, hosts } while a page is shown as a hub tab; null otherwise. */
export const HostedPageContext = createContext(null);

function readSearch(pageId, alias) {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash;
  if (alias) return hostedSearch(hash, alias);
  return hashPageId(hash) === pageId ? hashSearch(hash) : null;
}

/**
 * Returns [search, setSearch]. `search` is the query string for `pageId` ("" when
 * there is none). setSearch(next, { replace }):
 *   replace: true  -> rewrites the address without a history entry (typing, filters)
 *   replace: false -> a new history entry, so Back returns to the previous view
 */
export function useHashQuery(pageId) {
  const hosted = useContext(HostedPageContext);
  const alias = hosted && hosted.hosts === pageId ? hosted : null;
  const aliasPage = alias?.page;
  const aliasTab = alias?.tab;
  const [search, setSearchState] = useState(() => readSearch(pageId, alias) ?? "");

  useEffect(() => {
    const current = aliasPage ? { page: aliasPage, tab: aliasTab, hosts: pageId } : null;
    const onHashChange = () => {
      const next = readSearch(pageId, current);
      // Another page's address: this page is about to unmount; keep what we have.
      if (next !== null) setSearchState(next);
    };
    window.addEventListener("hashchange", onHashChange);
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [pageId, aliasPage, aliasTab]);

  const setSearch = useCallback(
    (next, { replace = false } = {}) => {
      const value = typeof next === "string" ? next : "";
      const hash = aliasPage
        ? hostedHash({ page: aliasPage, tab: aliasTab, hosts: pageId }, value)
        : `#/${pageId}${value ? `?${value}` : ""}`;
      if (window.location.hash === hash) return;
      if (replace) {
        window.history.replaceState(null, "", hash);
        setSearchState(value);
      } else {
        // Fires hashchange, which updates the state above.
        window.location.hash = hash;
      }
    },
    [pageId, aliasPage, aliasTab]
  );

  return [search, setSearch];
}
