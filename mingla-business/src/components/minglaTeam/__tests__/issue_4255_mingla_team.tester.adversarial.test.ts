// #4255 tester adversarial — Host app Mingla team, from angles the
// implementor suite does not take: forged push links, a team_badge answer of
// the wrong type, and one person's team data never answering for another.
//
//   T-1 a forged team link can only ever open /team (a chat id, or Mentions
//       at a mention id), never another route and never extra query keys
//   T-2 team_badge is trusted only when staff is literally true; a string
//       "true", admin without staff, negative or text counts never show the M
//       or offer @everyone; a failed read throws (the M stays hidden)
//   T-3 every team key sits under its user; one user's key never matches
//       another's, so sign-out and a switch of account cannot serve old rows
//
// FAILS-ON-REVERT (proved by editing the line, re-running, restoring; see the
// #4255 tester verdict): the UUID_RE test in the "team" case of
// parseBusinessDeepLink (T-1); `row.staff === true` in fetchTeamBadge (T-2);
// `staff && row.admin === true` in fetchTeamBadge (T-2).

const mockRpc = jest.fn();
jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("../../../store/currentBrandStore", () => {
  const state = { currentBrandId: null, hasHydrated: true };
  const useCurrentBrandStore = (selector: (s: typeof state) => unknown) => selector(state);
  useCurrentBrandStore.getState = () => state;
  return { useCurrentBrandStore };
});
jest.mock("../../../i18n", () => ({ useBusinessMediaTranslation: () => ({ t: (k: string) => k }) }));

import { parseBusinessDeepLink } from "../../../services/businessNotificationRouting";
import { fetchTeamBadge, teamBadgeCount } from "../teamBadge";
import { teamChatKey } from "../../../hooks/useBusinessNotifications";

const T = "4255a000-0000-4000-8000-0000000000a1";
const M = "4255a000-0000-4000-8000-0000000000c1";

describe("#4255 adversarial T-1 forged team links", () => {
  test("well-formed links open the chat or Mentions at the mention", () => {
    expect(parseBusinessDeepLink(`mingla-business://team/${T}`)).toBe(`/team?thread=${T}`);
    expect(parseBusinessDeepLink(`mingla-business://team/mention/${M}`)).toBe(`/team?tab=mentions&mention=${M}`);
  });
  test.each([
    `mingla-business://team/${T}/../../account`,
    `mingla-business://team/${T}&tab=settings`,
    `mingla-business://team/${T}?compose=group`,
    "mingla-business://team/..%2F..%2Fbrand%2Fx",
    "mingla-business://team/javascript:alert(1)",
    "mingla-business://team/",
    "mingla-business://team",
    `mingla-business://team/mention/${M}/../../payments`,
    `mingla-business://team/mention/${M}&thread=${T}`,
    "mingla-business://team/mention/not-an-id",
    `mingla-business://team/mention`,
  ])("%s opens only /team, with no smuggled keys", (link) => {
    const target = parseBusinessDeepLink(link);
    expect(typeof target).toBe("string");
    const [route, query = ""] = String(target).split("?");
    expect(route).toBe("/team");
    const keys = [...new URLSearchParams(query).keys()].sort();
    for (const k of keys) expect(["mention", "tab", "thread"]).toContain(k);
    const params = new URLSearchParams(query);
    if (params.has("thread")) expect(params.get("thread")).toBe(T);
    if (params.has("mention")) expect(params.get("mention")).toBe(M);
    if (params.has("tab")) expect(params.get("tab")).toBe("mentions");
    // A path tail never reaches a thread id: only the exact id is kept.
    expect(String(target)).not.toMatch(/\.\.|account|payments|settings|compose|javascript/);
  });
  test("another app's scheme or a web link is not a team link", () => {
    expect(parseBusinessDeepLink(`mingla://team/${T}`)).toBeNull();
    expect(parseBusinessDeepLink(`https://admin.usemingla.com/#/messages?thread=${T}`)).toBeNull();
  });
});

describe("#4255 adversarial T-2 team_badge of the wrong type", () => {
  beforeEach(() => mockRpc.mockReset());
  test.each([
    [{ staff: "true", admin: true, chats: 5, mentions: 2, total: 7 }],
    [{ staff: 1, admin: true, chats: 5 }],
    [{ admin: true, chats: 5 }],
    [null],
    ["staff"],
  ])("%j is not staff: no M, no @everyone, zeros", async (data) => {
    mockRpc.mockResolvedValueOnce({ data, error: null });
    const badge = await fetchTeamBadge();
    expect(badge).toEqual({ staff: false, admin: false, chats: 0, messages: 0, mentions: 0, total: 0 });
    expect(teamBadgeCount(badge)).toBe(0);
  });
  test("staff with admin as a string is not an admin", async () => {
    mockRpc.mockResolvedValueOnce({ data: { staff: true, admin: "yes", chats: 1, mentions: 0 }, error: null });
    const badge = await fetchTeamBadge();
    expect(badge.staff).toBe(true);
    expect(badge.admin).toBe(false);
  });
  test("negative, fractional and text counts are cleaned", async () => {
    mockRpc.mockResolvedValueOnce({ data: { staff: true, admin: false, chats: -3, mentions: "2", messages: 2.9, total: "x" }, error: null });
    const badge = await fetchTeamBadge();
    expect(badge).toMatchObject({ chats: 0, mentions: 2, messages: 2, total: 0 });
    expect(teamBadgeCount(badge)).toBe(2);
  });
  test("a failed read throws (the M stays hidden; nothing reads it as staff)", async () => {
    mockRpc.mockResolvedValueOnce({ data: { staff: true }, error: { message: "JWT expired" } });
    await expect(fetchTeamBadge()).rejects.toThrow("JWT expired");
  });
});

describe("#4255 adversarial T-3 one person's team data", () => {
  test("keys of two people never match, part for part", () => {
    for (const part of ["badge", "threads", "people", "mentions", "prefs"] as const) {
      expect(teamChatKey("user-a", part)).not.toEqual(teamChatKey("user-b", part));
    }
    expect(teamChatKey("user-a", "messages", T)).not.toEqual(teamChatKey("user-b", "messages", T));
  });
  test("every part starts with the person's own prefix, so one removal clears them all", () => {
    const prefix = teamChatKey("user-a");
    for (const key of [teamChatKey("user-a", "badge"), teamChatKey("user-a", "messages", T), teamChatKey("user-a", "file", M)]) {
      expect(key.slice(0, prefix.length)).toEqual(prefix);
    }
    expect(teamChatKey("user-b", "badge").slice(0, prefix.length)).not.toEqual(prefix);
  });
  test("the signed-out key is not any real person's", () => {
    expect(teamChatKey("signed-out", "badge")).not.toEqual(teamChatKey("u-staff", "badge"));
  });
});
