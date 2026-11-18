/**
 * #4459 — the only way to the Guest chat panel (GroupChatPanel.tsx). The
 * listing's Group chat route, the brand's Guest chat route and the desktop
 * Messages thread all resolve this one dynamic import, so the panel, its hooks,
 * the moderation sheet and groupChatService load as one chunk on intent and
 * stay out of the eager web `__common` chunk (bundle-baseline-movement). Do not
 * import GroupChatPanel statically from a route or a shared screen.
 */
import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import type { GroupChatPanelProps } from "./GroupChatPanel";

type GroupChatPanelModule = typeof import("./GroupChatPanel");

let groupChatPanelPromise: Promise<GroupChatPanelModule> | null = null;

/** One request per session; a failed load is retried on the next call. */
const loadGroupChatPanel = (): Promise<GroupChatPanelModule> => {
  groupChatPanelPromise ??= import("./GroupChatPanel").catch((error: unknown) => {
    groupChatPanelPromise = null;
    throw error;
  });
  return groupChatPanelPromise;
};

export const LazyGroupChatPanel = createRetryableLazyErrorBoundary<GroupChatPanelProps>(
  async () => ({ default: (await loadGroupChatPanel()).GroupChatPanel }),
  { loadingLabel: "Loading the Guest chat", style: { flex: 1 } },
);
