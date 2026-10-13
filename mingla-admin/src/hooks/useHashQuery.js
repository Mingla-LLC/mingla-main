// Issue #3802 (Wave 1) — state kept in the part of the address after "?".
//
// A page reads its view, filters and open card from the address, so a reload
// or a pasted link shows exactly the same thing. The app's router looks only
// at the first path segment (App.jsx), so the query survives the route guard.
import { useCallback, useEffect, useState } from "react";
import { hashPageId, hashSearch } from "../lib/crmUrl";

function readSearch(pageId) {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash;
  return hashPageId(hash) === pageId ? hashSearch(hash) : null;
}

/**
 * Returns [search, setSearch]. `search` is the query string for `pageId` ("" when
 * there is none). setSearch(next, { replace }):
 *   replace: true  -> rewrites the address without a history entry (typing, filters)
 *   replace: false -> a new history entry, so Back returns to the previous view
 */
export function useHashQuery(pageId) {
  const [search, setSearchState] = useState(() => readSearch(pageId) ?? "");

  useEffect(() => {
    const onHashChange = () => {
      const next = readSearch(pageId);
      // Another page's address: this page is about to unmount; keep what we have.
      if (next !== null) setSearchState(next);
    };
    window.addEventListener("hashchange", onHashChange);
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [pageId]);

  const setSearch = useCallback(
    (next, { replace = false } = {}) => {
      const value = typeof next === "string" ? next : "";
      const hash = `#/${pageId}${value ? `?${value}` : ""}`;
      if (window.location.hash === hash) return;
      if (replace) {
        window.history.replaceState(null, "", hash);
        setSearchState(value);
      } else {
        // Fires hashchange, which updates the state above.
        window.location.hash = hash;
      }
    },
    [pageId]
  );

  return [search, setSearch];
}
