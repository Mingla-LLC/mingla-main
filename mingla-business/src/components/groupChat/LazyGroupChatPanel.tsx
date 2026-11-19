/**
 * #4459 — the only way to the Guest chat panel (GroupChatPanel.tsx). The
 * listing's Group chat route, the brand's Guest chat route and the desktop
 * Messages thread all resolve this one dynamic import, so the panel, its hooks,
 * the moderation sheet and groupChatService load as one chunk on intent and
 * stay out of the eager web `__common` chunk (bundle-baseline-movement). Do not
 * import GroupChatPanel statically from a route or a shared screen.
 */
import { useEffect, useState } from "react";

import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import type { BrandGuestPeoplePanelProps, GroupChatPanelProps } from "./GroupChatPanel";

type GroupChatPanelModule = typeof import("./GroupChatPanel");

let groupChatPanelPromise: Promise<GroupChatPanelModule> | null = null;

let messagesEnglishPromise: Promise<void> | null = null;
let messagesEnglishReady = false;

/**
 * #4420: Host Messages' English words, on intent. Both the Messages chunk and
 * the Guest chat chunk reach them only through this dynamic import, so the
 * words never join the eager web `__common` chunk.
 */
export const ensureMessagesEnglish = (): Promise<void> => {
  messagesEnglishPromise ??= import("../../i18n/brandMessagesEnglish")
    .then((module) => {
      module.addMessagesEnglish();
      messagesEnglishReady = true;
    })
    .catch((error: unknown) => {
      messagesEnglishPromise = null;
      throw error;
    });
  return messagesEnglishPromise;
};

/** #4420: true once the Messages words are loaded (the caller shows a loader until then). */
export function useMessagesEnglishReady(): { ready: boolean; error: boolean; retry: () => void } {
  const [ready, setReady] = useState(messagesEnglishReady);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (messagesEnglishReady) {
      setReady(true);
      return undefined;
    }
    let active = true;
    ensureMessagesEnglish()
      .then(() => { if (active) setReady(true); })
      .catch((cause: unknown) => {
        console.warn("[LazyGroupChatPanel] Messages words failed to load", cause);
        if (active) setError(true);
      });
    return () => { active = false; };
  }, [attempt]);
  return { ready, error, retry: () => { setError(false); setAttempt((value) => value + 1); } };
}

/** One request per session; a failed load is retried on the next call. */
const loadGroupChatPanel = (): Promise<GroupChatPanelModule> => {
  groupChatPanelPromise ??= Promise.all([import("./GroupChatPanel"), ensureMessagesEnglish()])
    .then(([module]) => module)
    .catch((error: unknown) => {
      groupChatPanelPromise = null;
      throw error;
    });
  return groupChatPanelPromise;
};

export const LazyGroupChatPanel = createRetryableLazyErrorBoundary<GroupChatPanelProps>(
  async () => ({ default: (await loadGroupChatPanel()).GroupChatPanel }),
  { loadingLabel: "Loading the Guest chat", style: { flex: 1 } },
);

/** #4420: the Guests side's People (the guest list), from the same chunk. */
export const LazyBrandGuestPeoplePanel = createRetryableLazyErrorBoundary<BrandGuestPeoplePanelProps>(
  async () => ({ default: (await loadGroupChatPanel()).BrandGuestPeoplePanel }),
  { loadingLabel: "Loading the guest list", style: { flex: 1 } },
);
