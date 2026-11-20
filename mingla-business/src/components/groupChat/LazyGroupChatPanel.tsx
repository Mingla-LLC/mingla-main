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

type ThreadSupport = typeof import("../../i18n/brandMessagesEnglish");

let threadSupportModule: ThreadSupport | null = null;

/**
 * #4420: the thread helpers (history paging, guarded send), loaded with the
 * Messages words. Callers render only after ensureMessagesEnglish resolved
 * (the Messages screens and the Guest chat panel both await it), so they are
 * always present by then.
 */
export function threadSupport(): ThreadSupport {
  return threadSupportModule as ThreadSupport;
}

/**
 * #4420: Host Messages' English words and thread helpers, on intent. The
 * Messages screens and the Guest chat chunk reach them only through this
 * dynamic import, so neither joins the eager web `__common` chunk. A failed
 * load is logged and thrown, and the lazy boundary around the caller offers
 * Try again (the import is retried on the next call).
 */
export const ensureMessagesEnglish = (): Promise<void> =>
  import("../../i18n/brandMessagesEnglish").then((words) => {
    words.addMessagesEnglish();
    threadSupportModule = words;
  }, (cause: unknown) => {
    console.warn("[Messages] words failed to load", cause);
    throw cause;
  });

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
