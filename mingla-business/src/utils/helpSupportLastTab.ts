/**
 * #3720 Slice G — persist the last Help & Support hub tab.
 *
 * Opens on Community when there are unread announcements; otherwise restores
 * the last tab the host used (default Support).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export type HelpSupportTabId = "community" | "support" | "guides";

export const HELP_SUPPORT_TAB_IDS: readonly HelpSupportTabId[] = [
  "community",
  "support",
  "guides",
] as const;

const STORAGE_KEY = "mingla.host.helpSupport.lastTab";

export function isHelpSupportTabId(value: unknown): value is HelpSupportTabId {
  return (
    typeof value === "string" &&
    (HELP_SUPPORT_TAB_IDS as readonly string[]).includes(value)
  );
}

export async function loadLastHelpSupportTab(): Promise<HelpSupportTabId | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return isHelpSupportTabId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function saveLastHelpSupportTab(
  tab: HelpSupportTabId,
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, tab);
  } catch {
    // Best-effort; hub still works without persistence.
  }
}

/**
 * Resolve the initial hub tab.
 * Priority: explicit query param → unread → last tab → support.
 */
export function resolveInitialHelpSupportTab(opts: {
  queryTab: string | null | undefined;
  unreadCount: number;
  lastTab: HelpSupportTabId | null;
}): HelpSupportTabId {
  if (isHelpSupportTabId(opts.queryTab)) return opts.queryTab;
  if (opts.unreadCount > 0) return "community";
  if (opts.lastTab !== null) return opts.lastTab;
  return "support";
}
