/**
 * #4490 fix 3 (N104, N109) — the browser tab names the page the guest is on.
 *
 * `expo-router/head` alone is not enough on a fresh load or a client-side
 * move between public pages: the navigator writes the app's name (or the last
 * page's title) after the page's own <Head> has rendered, so a booking page
 * read "Mingla Host" and an event opened from a venue's What's on kept the
 * venue's title. This writes the title after the page has mounted, and again
 * once the navigator has settled. Web only; a no-op elsewhere and while the
 * title is unknown.
 */
import { useEffect } from "react";
import { Platform } from "react-native";

export function useWebDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return undefined;
    if (typeof title !== "string" || title.trim().length === 0) return undefined;
    const value = title.trim();
    document.title = value;
    const settle = setTimeout(() => {
      if (document.title !== value) document.title = value;
    }, 250);
    return () => clearTimeout(settle);
  }, [title]);
}
