/**
 * inviteShare — issue #4508 1.15 / 2.2. Copy and share a ready-made invite
 * message on every surface without a new dependency: the host may inject its
 * own handlers; otherwise React Native core `Share` on native and
 * navigator.share (clipboard fallback) on web.
 */

import { Platform, Share } from "react-native";

type WebNavigator = {
  share?: (data: { text: string }) => Promise<void>;
  clipboard?: { writeText?: (text: string) => Promise<void> };
};
const webNavigator = (): WebNavigator | null =>
  (globalThis as { navigator?: WebNavigator }).navigator ?? null;

/** The copy action for this platform, or null when none exists (native without a host copy). */
export const resolveCopyText = (
  onCopyText?: (text: string) => void | Promise<void>,
): ((text: string) => Promise<void>) | null => {
  if (onCopyText !== undefined) return async (text) => { await onCopyText(text); };
  const nav = Platform.OS === "web" ? webNavigator() : null;
  const write = nav?.clipboard?.writeText;
  if (write === undefined || nav === null) return null;
  return async (text) => { await write.call(nav.clipboard, text); };
};

/**
 * Share: the host's handler, else the system share sheet (native) or
 * navigator.share (web). Resolves "copied" when web fell back to the clipboard.
 */
export const shareInviteText = async (
  text: string,
  onShareText?: (text: string) => void | Promise<void>,
): Promise<"shared" | "copied"> => {
  if (onShareText !== undefined) {
    await onShareText(text);
    return "shared";
  }
  if (Platform.OS === "web") {
    const nav = webNavigator();
    if (nav?.share !== undefined) {
      try {
        await nav.share({ text });
        return "shared";
      } catch (err) {
        // The person closed the share sheet: nothing to report.
        if ((err as { name?: string } | null)?.name === "AbortError") return "shared";
      }
    }
    const write = nav?.clipboard?.writeText;
    if (write === undefined || nav === null) throw new Error("share_unavailable");
    await write.call(nav.clipboard, text);
    return "copied";
  }
  // SHARE-NON-CONTENT:invite
  await Share.share({ message: text });
  return "shared";
};
