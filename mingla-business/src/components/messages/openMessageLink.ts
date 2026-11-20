/**
 * #4420 SC-15 — opens a link from a message. Phones: the in-app browser over
 * the thread (expo-web-browser, already a dependency, loaded on tap so it never
 * joins a boot chunk). Web: a new tab through the shared openExternal owner. Anything
 * that is not http(s) is refused.
 */
import { Platform } from "react-native";

import { isOpenableMessageLink } from "../../utils/messageLinks";

export async function openMessageLink(url: string): Promise<void> {
  if (!isOpenableMessageLink(url)) throw new Error("unsafe_link");
  if (Platform.OS === "web") {
    // The one owner of web opens (no feature string, opener severed, popup
    // block degrades to a same-tab navigation).
    // Loaded on tap: the owner stays out of the boot chunk.
    const { openExternal } = await import("../../services/guestFunnelLink");
    openExternal(url);
    return;
  }
  const WebBrowser = await import("expo-web-browser");
  await WebBrowser.openBrowserAsync(url);
}
