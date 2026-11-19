/**
 * #4420 SC-15 — opens a link from a message. Phones: the in-app browser over
 * the thread (expo-web-browser, already a dependency, loaded on tap so it never
 * joins a boot chunk). Web: a new tab with noopener and noreferrer. Anything
 * that is not http(s) is refused.
 */
import { Platform } from "react-native";

import { isOpenableMessageLink } from "../../utils/messageLinks";

export async function openMessageLink(url: string): Promise<void> {
  if (!isOpenableMessageLink(url)) throw new Error("This link can't be opened.");
  if (Platform.OS === "web") {
    const opened = typeof window !== "undefined" ? window.open(url, "_blank", "noopener,noreferrer") : null;
    // With noopener the browser returns null even when the tab opened, so a
    // null is not a failure here.
    void opened;
    return;
  }
  const WebBrowser = await import("expo-web-browser");
  await WebBrowser.openBrowserAsync(url);
}
