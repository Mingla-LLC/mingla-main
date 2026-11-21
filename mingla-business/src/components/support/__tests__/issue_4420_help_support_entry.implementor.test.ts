/* eslint-disable import/first */
/**
 * MINGLA-INVARIANT: I-4420-HELP-ENTRY-NO-DEAD-LINK | issue #4420 | Every Help & Support address, legacy ones included, and every old Community notification link resolves to Announcements or Support; every "Get help" entry lands on Support with "A person" selected.
 *
 * #4420 — where Help & Support opens (spec part 2, 4.1, 4.7, 4.8).
 *
 * FAILS-ON-REVERT: deleting the legacy `tab=community` / `tab=guides` mapping
 * in helpSupportRoute.ts fails block 2; restoring the old `?tab=community`
 * targets in businessNotificationRouting.ts fails block 4; pointing a "Get
 * help" constant back at the bare route fails block 5.
 */
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../../services/supabase", () => ({ supabase: {} }));
jest.mock("../../../services/mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: null }) },
}));

import {
  defaultSupportMode,
  entryNeedsConversationState,
  isOpenSupportStatus,
  resolveHelpSupportEntry,
  type HelpSupportRouteParams,
} from "../helpSupportRoute";
import {
  HELP_AND_SUPPORT_ROUTE,
  HELP_SUPPORT_NEW_CONVERSATION_ROUTE,
  HELP_SUPPORT_PERSON_ROUTE,
} from "../../../constants/supportHostFacing";
import {
  parseBusinessDeepLink,
  resolveBusinessNavTarget,
} from "../../../services/businessNotificationRouting";

const ANN = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function resolve(params: HelpSupportRouteParams, unread = 0, open = false) {
  return resolveHelpSupportEntry({ params, unreadAnnouncements: unread, hasOpenConversation: open });
}

/** Parse "/account/support?…" back into params, as expo-router would. */
function paramsOf(route: string): HelpSupportRouteParams {
  const [pathname, query = ""] = route.split("?");
  expect(pathname).toBe(HELP_AND_SUPPORT_ROUTE);
  return Object.fromEntries(new URLSearchParams(query).entries());
}

describe("#4420 Help & Support entry", () => {
  test("1. the current addresses", () => {
    expect(resolve({ announcementId: ANN })).toEqual({ tab: "announcements", mode: "ari", announcementId: ANN, startNew: false });
    expect(resolve({ tab: "announcements" }).tab).toBe("announcements");
    expect(resolve({ tab: "support", mode: "person" })).toMatchObject({ tab: "support", mode: "person" });
    expect(resolve({ tab: "support", mode: "ari" })).toMatchObject({ tab: "support", mode: "ari" });
    expect(resolve({ new: "1" })).toEqual({ tab: "support", mode: "person", announcementId: null, startNew: true });
    expect(resolve({ mode: "person" })).toMatchObject({ tab: "support", mode: "person" });
  });

  test("2. legacy addresses land somewhere useful", () => {
    // Payments, release detail and old builds send tab=support alone: a person.
    expect(resolve({ tab: "support" })).toMatchObject({ tab: "support", mode: "person" });
    expect(resolve({ tab: "support" }, 3, false)).toMatchObject({ tab: "support", mode: "person" });
    // Community (any section or post): unread news first, else Support.
    expect(resolve({ tab: "community" }, 2)).toMatchObject({ tab: "announcements" });
    expect(resolve({ tab: "community", section: "roadmap" }, 0, true)).toMatchObject({ tab: "support", mode: "person" });
    expect(resolve({ tab: "community", communityPost: ANN }, 0, false)).toMatchObject({ tab: "support", mode: "ari" });
    // The old Community link with an announcement id still opens it.
    expect(resolve({ tab: "community", announcementId: ANN })).toMatchObject({ tab: "announcements", announcementId: ANN });
    // Guides left the app; Ari answers how-to questions now.
    expect(resolve({ tab: "guides" }, 5, true)).toMatchObject({ tab: "support", mode: "ari" });
  });

  test("3. no address: unread first, then a person if a conversation is open, else Ari", () => {
    expect(resolve({}, 1, true)).toMatchObject({ tab: "announcements", mode: "person" });
    expect(resolve({}, 0, true)).toMatchObject({ tab: "support", mode: "person" });
    expect(resolve({}, 0, false)).toMatchObject({ tab: "support", mode: "ari" });
    expect(defaultSupportMode(true)).toBe("person");
    expect(["new", "open", "pending"].every(isOpenSupportStatus)).toBe(true);
    expect(["resolved", "closed", "", null, undefined].some(isOpenSupportStatus)).toBe(false);
  });

  test("3b. junk falls back to the default, never nowhere", () => {
    const junk: HelpSupportRouteParams[] = [
      { tab: "roadmap" },
      { tab: "" },
      { tab: ["guides", "community"] },
      { announcementId: "not-a-uuid" },
      { announcementId: `${ANN}'; drop` },
      { mode: "robot" },
      { new: "true" },
      { tab: ["community"], announcementId: [ANN, "x"] },
    ];
    for (const params of junk) {
      const entry = resolve(params, 0, false);
      expect(["announcements", "support"]).toContain(entry.tab);
      expect(["ari", "person"]).toContain(entry.mode);
      expect(entry.announcementId === null || entry.announcementId === ANN).toBe(true);
    }
    expect(resolve({ tab: ["guides", "community"] })).toMatchObject({ tab: "support", mode: "ari" });
    expect(resolve({ announcementId: "not-a-uuid" }, 0, false).announcementId).toBeNull();
    expect(resolve({ tab: "support", mode: "robot" }).mode).toBe("person");
  });

  test("3c. the screen waits for the conversation list only when the answer depends on it", () => {
    expect(entryNeedsConversationState({})).toBe(true);
    expect(entryNeedsConversationState({ tab: "community" })).toBe(true);
    expect(entryNeedsConversationState({ announcementId: ANN })).toBe(true);
    expect(entryNeedsConversationState({ tab: "support" })).toBe(false);
    expect(entryNeedsConversationState({ tab: "guides" })).toBe(false);
    expect(entryNeedsConversationState({ new: "1" })).toBe(false);
  });

  test("4. old Community notification links open this screen (4.8)", () => {
    const cases: [string, HelpSupportRouteParams | null][] = [
      ["mingla-business://community", {}],
      ["mingla-business://community/roadmap", {}],
      [`mingla-business://community/announcement/${ANN}`, { tab: "announcements", announcementId: ANN }],
      ["mingla-business://community/announcement/nope", { tab: "announcements" }],
      [`mingla-business://community/post/${ANN}`, {}],
    ];
    for (const [link, expected] of cases) {
      const route = parseBusinessDeepLink(link);
      expect(route).not.toBeNull();
      expect(paramsOf(route as string)).toEqual(expected);
      expect(route).not.toContain("tab=community");
      expect(route).not.toContain("section=");
      expect(route).not.toContain("communityPost=");
    }
    expect(resolveBusinessNavTarget({ type: "business.community_announcement", announcementId: ANN })).toBe(
      `${HELP_AND_SUPPORT_ROUTE}?tab=announcements&announcementId=${ANN}`,
    );
    expect(resolveBusinessNavTarget({ type: "business.community_announcement", announcement_id: "x" })).toBe(
      `${HELP_AND_SUPPORT_ROUTE}?tab=announcements`,
    );
    expect(resolveBusinessNavTarget({ type: "business.community_roadmap_updated" })).toBe(HELP_AND_SUPPORT_ROUTE);
    // Support pushes are unchanged: they open the conversation.
    expect(parseBusinessDeepLink(`mingla-business://support/${ANN}`)).toBe(`/support/${ANN}`);
    // Each target resolves on the screen to a real place.
    expect(resolve(paramsOf(`${HELP_AND_SUPPORT_ROUTE}?tab=announcements&announcementId=${ANN}`))).toMatchObject({ tab: "announcements", announcementId: ANN });
  });

  test("5. every 'Get help' entry lands on Support with A person (4.7)", () => {
    expect(resolve(paramsOf(HELP_SUPPORT_PERSON_ROUTE), 9, false)).toEqual({ tab: "support", mode: "person", announcementId: null, startNew: false });
    expect(resolve(paramsOf(HELP_SUPPORT_NEW_CONVERSATION_ROUTE), 9, false)).toEqual({ tab: "support", mode: "person", announcementId: null, startNew: true });
  });
});
