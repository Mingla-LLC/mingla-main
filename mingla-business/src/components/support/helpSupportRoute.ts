/**
 * #4420 — where Help & Support opens (spec part 2, 4.1).
 *
 * Pure: no React, no AsyncStorage, no expo import. Replaces the retired
 * helpSupportLastTab.ts (the stored last-tab key is ignored, never read).
 *
 * MINGLA-INVARIANT I-4420-HELP-ENTRY-NO-DEAD-LINK: every Help & Support
 * address, legacy ones included, resolves to Announcements or Support.
 * Enforced by __tests__/issue_4420_help_support_entry.implementor.test.ts.
 */

export type HelpSupportTab = "announcements" | "support";
export type SupportMode = "ari" | "person";

/** Raw route params as expo-router hands them over (any may be an array). */
export interface HelpSupportRouteParams {
  tab?: string | string[];
  mode?: string | string[];
  announcementId?: string | string[];
  new?: string | string[];
  /** Legacy (#3720 Community): `section=roadmap`. */
  section?: string | string[];
  /** Legacy (#3720 Community): an idea or question post id. */
  communityPost?: string | string[];
}

export interface HelpSupportEntry {
  tab: HelpSupportTab;
  mode: SupportMode;
  /** The announcement to open in place, when the address names a real one. */
  announcementId: string | null;
  /** Open "A person" on a new conversation (the closed thread's "Start a new request"). */
  startNew: boolean;
}

/** A conversation is open while the host can still write into it. */
export const OPEN_SUPPORT_STATUSES: readonly string[] = ["new", "open", "pending"];

export function isOpenSupportStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && OPEN_SUPPORT_STATUSES.includes(status);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function firstParam(value: string | string[] | undefined | null): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.length > 0 ? first : undefined;
}

/** Support's mode when nothing names one: a person if a conversation is open. */
export function defaultSupportMode(hasOpenConversation: boolean): SupportMode {
  return hasOpenConversation ? "person" : "ari";
}

/**
 * Whether the answer depends on the host's conversations. When it does not,
 * the screen can open without waiting for the support list.
 */
export function entryNeedsConversationState(params: HelpSupportRouteParams): boolean {
  const tab = firstParam(params.tab);
  const mode = firstParam(params.mode);
  if (firstParam(params.new) === "1") return false;
  if (tab === "support" || tab === "guides") return false;
  if (mode === "ari" || mode === "person") return false;
  return true;
}

export function resolveHelpSupportEntry(input: {
  params: HelpSupportRouteParams;
  unreadAnnouncements: number;
  hasOpenConversation: boolean;
}): HelpSupportEntry {
  const { params } = input;
  const unread = Number.isFinite(input.unreadAnnouncements) && input.unreadAnnouncements > 0;
  const fallbackMode = defaultSupportMode(input.hasOpenConversation);
  const tab = firstParam(params.tab);
  const mode = firstParam(params.mode);
  const announcementId = firstParam(params.announcementId);

  if (isUuid(announcementId)) {
    return { tab: "announcements", mode: fallbackMode, announcementId, startNew: false };
  }
  if (firstParam(params.new) === "1") {
    return { tab: "support", mode: "person", announcementId: null, startNew: true };
  }
  if (tab === "announcements") {
    return { tab: "announcements", mode: fallbackMode, announcementId: null, startNew: false };
  }
  if (tab === "support") {
    // Payments, release detail and older builds send `tab=support` alone:
    // they meant the support conversation, so it opens on a person.
    return { tab: "support", mode: mode === "ari" ? "ari" : "person", announcementId: null, startNew: false };
  }
  if (tab === "guides") {
    return { tab: "support", mode: "ari", announcementId: null, startNew: false };
  }
  if (tab === undefined && (mode === "ari" || mode === "person")) {
    return { tab: "support", mode, announcementId: null, startNew: false };
  }
  // Legacy `tab=community` (any section or post), unknown values and no
  // params at all share the default: unread news first, then Support.
  return {
    tab: unread ? "announcements" : "support",
    mode: fallbackMode,
    announcementId: null,
    startNew: false,
  };
}

/**
 * #4420 rework 3 (G6): keys on a focused tab or switch option. Space selects
 * the focused option (Enter already does, through Pressable); the arrow keys
 * move to the next or previous option, as the Website workspace's tabs do
 * (components/sites/website/workspace/parts.tsx). Anything else: null.
 */
export function segmentKeyTarget<T>(key: string | undefined, options: readonly T[], focused: T): T | null {
  const index = options.indexOf(focused);
  if (index < 0) return null;
  switch (key) {
    case " ":
    case "Spacebar":
      return focused;
    case "ArrowRight":
    case "ArrowDown":
      return options[(index + 1) % options.length] ?? null;
    case "ArrowLeft":
    case "ArrowUp":
      return options[(index + options.length - 1) % options.length] ?? null;
    default:
      return null;
  }
}

/** The key of a web keydown (react-native-web passes the DOM event). */
export interface SegmentKeyEvent {
  key?: string;
  nativeEvent?: { key?: string };
  preventDefault?: () => void;
}

/** #4420 rework 5 (H2): roving tabindex. Only the selected option is a tab stop. */
export function rovingTabIndex(selected: boolean): 0 | -1 {
  return selected ? 0 : -1;
}

/**
 * #4420 rework 5 (H2): one keydown on a tab or switch option. Selects the
 * option segmentKeyTarget names and, when the key MOVED to a different one,
 * asks for focus on it, so a second arrow press continues from there.
 */
export function handleSegmentKeyDown<T>(
  event: SegmentKeyEvent,
  options: readonly T[],
  focused: T,
  select: (next: T) => void,
  focusOption: (next: T) => void,
): void {
  const next = segmentKeyTarget(event.nativeEvent?.key ?? event.key, options, focused);
  if (next === null) return;
  event.preventDefault?.();
  select(next);
  if (next !== focused) focusOption(next);
}
