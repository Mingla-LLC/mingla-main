import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";

export interface SharePublicUrlInput {
  title: string;
  url: string;
  description?: string;
}

const trimmedOrNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

export const buildPublicShareText = ({
  title,
  url,
  description,
}: SharePublicUrlInput): string => {
  const body = trimmedOrNull(description) ?? trimmedOrNull(title);
  if (body === null) return url;
  return body.includes(url) ? body : `${body}\n${url}`;
};

const webNavigator = (): {
  clipboard?: { writeText?: (value: string) => Promise<void> };
  share?: (data: { title: string; url: string; text?: string }) => Promise<void>;
} | undefined =>
  (
    globalThis as unknown as {
      navigator?: {
        clipboard?: { writeText?: (value: string) => Promise<void> };
        share?: (data: {
          title: string;
          url: string;
          text?: string;
        }) => Promise<void>;
      };
    }
  ).navigator;

export const copyPublicUrl = async (url: string): Promise<void> => {
  if (Platform.OS === "web") {
    const writeText = webNavigator()?.clipboard?.writeText;
    if (writeText === undefined) {
      throw new Error("clipboard_unavailable");
    }
    await writeText(url);
    return;
  }

  await Clipboard.setStringAsync(url);
};

export const sharePublicUrl = async ({
  title,
  url,
  description,
}: SharePublicUrlInput): Promise<void> => {
  const shareText = buildPublicShareText({ title, url, description });
  if (Platform.OS === "web") {
    const share = webNavigator()?.share;
    if (share === undefined) {
      throw new Error("native_share_unavailable");
    }
    await share({
      title,
      url,
      text: shareText,
    });
    return;
  }

  const message = [title, shareText]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n");
  await Share.share({
    title,
    message,
    url,
  });
};
