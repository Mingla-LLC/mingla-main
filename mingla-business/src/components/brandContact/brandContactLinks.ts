/**
 * #4111 — the few links the brand-contact surfaces open. PURE except for the
 * external opener, which delegates to the ONE mingla-business opener
 * (`openExternal`, ORCH-1382) on web and Linking on native.
 */
import { Linking, Platform } from "react-native";

import { APP_STORE_URL, DOWNLOAD_PAGE_URL, PLAY_STORE_URL } from "../../constants/storeLinks";
import { detectClientPlatform, openExternal } from "../../services/guestFunnelLink";

/** "Open app" / "Get the app": the device's store, or the download page on desktop. */
export const explorerAppUrl = (platform = detectClientPlatform()): string =>
  platform === "ios" ? APP_STORE_URL : platform === "android" ? PLAY_STORE_URL : DOWNLOAD_PAGE_URL;

export const openExternalUrl = (url: string): void => {
  if (Platform.OS === "web") {
    openExternal(url);
    return;
  }
  void Linking.openURL(url).catch((error: unknown) => {
    console.warn("[brand-contact] could not open link", error instanceof Error ? error.message : String(error));
  });
};

const TOKEN_PATH_RE = /^\/m\/[A-Za-z0-9_-]{40,64}$/;

/**
 * The in-app path of a thread link (https://host.usemingla.com/m/{token}) so
 * "View conversation" stays in this tab. Anything else → null.
 */
export const threadPathFromUrl = (url: string | null | undefined): string | null => {
  if (typeof url !== "string" || url.length === 0) return null;
  try {
    const parsed = new URL(url);
    return TOKEN_PATH_RE.test(parsed.pathname) ? parsed.pathname : null;
  } catch {
    return null;
  }
};
