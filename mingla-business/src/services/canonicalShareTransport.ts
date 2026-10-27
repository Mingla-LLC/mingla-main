// SHARE-SEMANTIC-ROLE:content-transport
import { Platform, Share } from "react-native";

export type CanonicalShareTransportInput = {
  title: string;
  url: string;
  message: string;
};

/**
 * Native fallback for surfaces that already hold a canonical, server-authored
 * URL and message. This transport stays intentionally small: importing the
 * full prepared-content adapter here would hoist sharing and video-authoring
 * dependencies into the Host startup chunk.
 */
export async function shareBusinessCanonicalFallback(
  input: CanonicalShareTransportInput,
): Promise<void> {
  const body = input.message.split(input.url).join("").trim();
  const message = body.length > 0 ? `${body}\n${input.url}` : input.url;

  if (Platform.OS === "android") {
    // SHARE-CONTENT-CALL:transport
    await Share.share({
      title: input.title,
      message: input.message.includes(input.url) ? input.message : message,
    });
    return;
  }

  // SHARE-CONTENT-CALL:transport
  await Share.share({ title: input.title, message, url: input.url });
}
