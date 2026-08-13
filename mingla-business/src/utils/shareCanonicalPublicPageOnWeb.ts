import { AccessibilityInfo, Platform } from "react-native";

import {
  copyPublicUrl,
  sharePublicUrl,
  type SharePublicUrlInput,
} from "./sharePublicUrl";

export type CanonicalPublicWebShareResult =
  | "shared"
  | "copied"
  | "cancelled"
  | "failed";

const isShareCancellation = (error: unknown): boolean => {
  if (error === null || typeof error !== "object") return false;
  const name = "name" in error ? error.name : undefined;
  return name === "AbortError";
};

/**
 * Anonymous Business web pages are already their own public destinations.
 * Share that canonical URL directly so chat crawlers read the page's existing
 * Open Graph metadata. Native and Explorer custom-share flows do not call this.
 */
export const shareCanonicalPublicPageOnWeb = async (
  input: SharePublicUrlInput,
): Promise<CanonicalPublicWebShareResult> => {
  if (Platform.OS !== "web") {
    throw new Error("canonical_public_web_share_requires_web");
  }

  try {
    await sharePublicUrl(input);
    return "shared";
  } catch (error: unknown) {
    if (isShareCancellation(error)) return "cancelled";
  }

  try {
    await copyPublicUrl(input.url);
    AccessibilityInfo.announceForAccessibility("Link copied");
    return "copied";
  } catch (error: unknown) {
    AccessibilityInfo.announceForAccessibility(
      "This link could not be shared or copied. Please copy it from the address bar.",
    );
    console.error("[canonical-public-web-share] share and copy failed", error);
    return "failed";
  }
};
