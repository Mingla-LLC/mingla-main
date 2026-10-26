// Issue #4130 (Wave 4b) — the open tab of a page, kept in the address
// (#/placepool?tab=cities), so a reload, a pasted link or an old bookmark
// (#/launch-cities, rewritten by App to #/placepool?tab=cities) lands on it.
import { useCallback, useEffect, useState } from "react";
import { hubTabFromHash, hubTabHash } from "../lib/adminRoutes";

function currentHash() {
  return typeof window === "undefined" ? "" : window.location.hash;
}

/**
 * Returns [requested, open]. `requested` is the raw tab value in the address
 * ("" when none); the page resolves it to one of its tabs. open(tabId) writes
 * the address, which fires hashchange and updates `requested`.
 */
export function useHashTab(pageId) {
  const [requested, setRequested] = useState(() => hubTabFromHash(currentHash(), pageId));
  useEffect(() => {
    const onHash = () => setRequested(hubTabFromHash(currentHash(), pageId));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [pageId]);
  const open = useCallback(
    (tabId) => {
      window.location.hash = hubTabHash(pageId, tabId);
    },
    [pageId]
  );
  return [requested, open];
}
