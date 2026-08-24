// issue #2508 [maps-app-chooser] — the business app + buyer web's ONE
// "copy the address" host effect.
//
// WHY A HOST EFFECT, like `openMapsTarget` beside it. The shared renderer owns
// the BUTTON (so every public offering surface has the same one), but writing
// the clipboard is a platform capability, and this app and the explorer reach
// it by different, already-proven routes: this app has `expo-clipboard` and a
// web branch; the explorer uses React Native's own Clipboard. Forcing either
// onto the other's path would be a new risk for no gain.
//
// WHAT IT COPIES, AND WHY THAT IS SAFE. The caller passes
// `MapsOpenTarget.label` — text that has ALREADY cleared `selectVenueMapsTarget`,
// the same privacy gate as the maps link. A hide-address-until-ticket offering
// has no target, therefore no copy text, therefore no copy button. This
// function is never reachable with a withheld address.
//
// It copies the HUMAN address on purpose: the point is pasting it into Waze,
// Citymapper, Uber, or a message — places that expect an address, not a URL and
// not a coordinate pair.
import { Platform } from "react-native";

type ExpoClipboardModule = typeof import("expo-clipboard");

// Same lazy require as `sharePublicUrl.ts`: keeping the native-only dependency
// out of the anonymous buyer-web import graph, because some web/Jest
// environments cannot parse Expo's ESM clipboard entry point.
const loadExpoClipboard = (): ExpoClipboardModule =>
  require("expo-clipboard") as ExpoClipboardModule;

const webClipboard = ():
  | { writeText?: (value: string) => Promise<void> }
  | undefined =>
  (
    globalThis as unknown as {
      navigator?: { clipboard?: { writeText?: (value: string) => Promise<void> } };
    }
  ).navigator?.clipboard;

/**
 * Put `text` on the clipboard.
 *
 * THROWS on failure — it never resolves on a copy that did not happen
 * (Constitution #3). The shared button turns a rejection into a visible
 * "Couldn't copy" state plus a screen-reader announcement, so a failed copy is
 * never silent.
 */
export async function copyAddressText(text: string): Promise<void> {
  const value = text.trim();
  if (value.length === 0) throw new Error("copy_address_empty");

  if (Platform.OS === "web") {
    const clipboard = webClipboard();
    if (clipboard?.writeText === undefined) {
      throw new Error("clipboard_unavailable");
    }
    await clipboard.writeText(value);
    return;
  }

  await loadExpoClipboard().setStringAsync(value);
}
