"use client";

import { useEffect } from "react";
import { sharedPreviewHref } from "../lib/sharedPreviewHref";

/**
 * #2829 W10 — inside a private share link, the site's own links open the
 * same page of the PREVIEW (the draft may have pages the live site doesn't),
 * never the live site. Links to other sites, media and Mingla pages are left
 * alone.
 */
export function SharedPreviewLinks({ token }: { token: string }) {
  useEffect(() => {
    // Capture phase: the site's own links are client-side links whose
    // handler would otherwise navigate to the live page first.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") return;
      const next = sharedPreviewHref(anchor.href, window.location.origin, token);
      if (!next) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(next);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [token]);
  return null;
}
