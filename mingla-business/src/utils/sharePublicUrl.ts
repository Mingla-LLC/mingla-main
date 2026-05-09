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

export const buildPublicShareBody = ({
  title,
  description,
}: Omit<SharePublicUrlInput, "url">): string => {
  const body = trimmedOrNull(description) ?? trimmedOrNull(title);
  return body ?? "";
};

export const buildAndroidPublicShareMessage = ({
  title,
  url,
  description,
}: SharePublicUrlInput): string => {
  const body = buildPublicShareBody({ title, description });
  if (body.length === 0) return url;
  return body.includes(url) ? body : `${body}\n${url}`;
};

export const buildPublicShareText = buildAndroidPublicShareMessage;

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
  const shareBody = buildPublicShareBody({ title, description });
  if (Platform.OS === "web") {
    const share = webNavigator()?.share;
    if (share === undefined) {
      throw new Error("native_share_unavailable");
    }
    const data: { title: string; url: string; text?: string } = {
      title,
      url,
    };
    if (shareBody.length > 0) {
      data.text = shareBody;
    }
    await share(data);
    return;
  }

  if (Platform.OS === "android") {
    await Share.share({
      title,
      message: buildAndroidPublicShareMessage({ title, url, description }),
    });
    return;
  }

  const message = shareBody.length > 0 ? shareBody : trimmedOrNull(title);
  await Share.share({
    title,
    ...(message !== null ? { message } : {}),
    url,
  });
};
