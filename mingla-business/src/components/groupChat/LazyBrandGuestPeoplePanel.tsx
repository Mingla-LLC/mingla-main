/**
 * #4420 — the Guests side's People (the guest list), from the Guest chat chunk.
 * Kept out of LazyGroupChatPanel.tsx (which every Guest chat route shares, so
 * it sits in the eager web `__common` chunk): only the Messages thread route
 * imports this file, so it stays in that route's chunk.
 */
import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import type { BrandGuestPeoplePanelProps } from "./GroupChatPanel";
import { ensureMessagesEnglish, threadSupport } from "./LazyGroupChatPanel";

export const LazyBrandGuestPeoplePanel = createRetryableLazyErrorBoundary<BrandGuestPeoplePanelProps>(
  async () => {
    const [panel] = await Promise.all([import("./GroupChatPanel"), ensureMessagesEnglish()]);
    panel.setMessagesSupport(threadSupport());
    return { default: panel.BrandGuestPeoplePanel };
  },
  { loadingLabel: "Loading the guest list", style: { flex: 1 } },
);
