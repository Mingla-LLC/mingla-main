/**
 * #4382 — the support routes' only way to the support screens
 * (supportScreens.ts). Every owner resolves the same dynamic import, so the
 * screens and everything they share load as one chunk on intent and stay out
 * of the eager web `__common` chunk.
 *
 * #4420 — Help & Support's two lazy sides are declared here as SIBLINGS,
 * each one top-level boundary (never a lazy boundary nested inside a lazily
 * loaded module of this feature, which hoists shared modules into
 * `__common`):
 *   - `LazySupportPersonPane`: the "A person" pane, from the support chunk.
 *   - `LazySupportAriChat`: the ORDINARY Ari chat, from the same module the
 *     Ari tab loads (`AriChatScreen`), so Ari stays one chunk
 *     (I-ARI-CHAT-ONE-CHUNK; this file is on that gate's dynamic allowlist).
 */
import type React from "react";

import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import type { SupportTabPanelProps } from "./SupportTabPanel";
import type { SupportPersonPaneProps } from "./SupportPersonPane";

type SupportScreensModule = typeof import("./supportScreens");
// Type only, through the same specifier: no static importer of Ari's chat.
type AriChatScreenProps = React.ComponentProps<(typeof import("../../screens/ari/AriChatScreen"))["AriChatScreen"]>;

let supportScreensPromise: Promise<SupportScreensModule> | null = null;

/** One request per session; a failed load is retried on the next call. */
export const loadSupportScreens = (): Promise<SupportScreensModule> => {
  supportScreensPromise ??= import("./supportScreens").catch((error: unknown) => {
    supportScreensPromise = null;
    throw error;
  });
  return supportScreensPromise;
};

export const LazySupportTabPanel = createRetryableLazyErrorBoundary<SupportTabPanelProps>(
  async () => ({ default: (await loadSupportScreens()).SupportTabPanel }),
  { loadingLabel: "Loading your requests" },
);

export const LazySupportThread = createRetryableLazyErrorBoundary<{ ticketId: string; staffMode?: boolean }>(
  async () => ({ default: (await loadSupportScreens()).SupportThread }),
  { loadingLabel: "Loading the request" },
);

export const LazySupportInboxScreen = createRetryableLazyErrorBoundary<Record<string, never>>(
  async () => ({ default: (await loadSupportScreens()).SupportInboxScreen }),
  { loadingLabel: "Loading the support inbox" },
);

export const LazySupportPersonPane = createRetryableLazyErrorBoundary<SupportPersonPaneProps>(
  async () => ({ default: (await loadSupportScreens()).SupportPersonPane }),
  { loadingLabel: "Loading your conversation", style: { flex: 1 } },
);

export const LazySupportAriChat = createRetryableLazyErrorBoundary<AriChatScreenProps>(
  () => import("../../screens/ari/AriChatScreen").then((m) => ({ default: m.AriChatScreen })),
  { loadingLabel: "Opening Ari", style: { flex: 1 } },
);
