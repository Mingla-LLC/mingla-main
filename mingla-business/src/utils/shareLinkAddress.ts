import { Platform, Share } from "react-native";

/**
 * #4453 M8 — a private preview link (an invitation to look at a draft, not Mingla content: no canonical page URL, no attribution) leaves the app through the system share
 * sheet (iOS and Android, and the browser's where it has one). Throws when the
 * platform has no share sheet; the caller says so and points to Copy.
 */
export async function shareLinkAddress(url: string, brandName: string): Promise<"shared" | "dismissed"> {
  // SHARE-NON-CONTENT:invite
  const result = await Share.share(
    Platform.OS === "ios" ? { url, message: `A private preview of ${brandName}` } : { message: `A private preview of ${brandName}: ${url}` },
    { dialogTitle: "Share private preview" },
  );
  return result.action === Share.dismissedAction ? "dismissed" : "shared";
}
