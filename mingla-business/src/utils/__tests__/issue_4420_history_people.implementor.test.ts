/**
 * #4420 rework — history affordances (Load earlier on the real 120-message
 * pages, Jump to latest, sticky day markers) and People per side.
 *
 * FAILS ON REVERT: let a refresh drop older pages, show Load earlier after a
 * short page, put the sticky indices on the wrong children, show the Team
 * roster on the Guests side, or drop the Mingla entry, and this fails.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BRAND_GROUP_PAGE_SIZE,
  earlierCursor,
  mayHaveEarlier,
  mergeNewestPage,
  prependEarlierPage,
  showsJumpToLatest,
  stickyDayIndices,
} from "../brandThreadHistory";

const source = (relative: string): string => readFileSync(join(process.cwd(), relative), "utf8");
const msg = (id: string, minute: number) => ({ id, created_at: `2026-11-19T10:${String(minute).padStart(2, "0")}:00Z` });

describe("Load earlier is real pagination", () => {
  test("a full page may have more; a short page is the start", () => {
    expect(BRAND_GROUP_PAGE_SIZE).toBe(120);
    expect(mayHaveEarlier(120)).toBe(true);
    expect(mayHaveEarlier(119)).toBe(false);
  });
  test("an older page goes in front, without duplicates; the cursor is the oldest loaded", () => {
    const merged = prependEarlierPage([msg("c", 3), msg("d", 4)], [msg("a", 1), msg("b", 2), msg("c", 3)]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect(earlierCursor(merged)).toBe(msg("a", 1).created_at);
  });
  test("a refresh of the newest page keeps older pages and drops what left the newest page", () => {
    const current = [msg("a", 1), msg("b", 2), msg("c", 3), msg("gone", 4), msg("d", 5)];
    const fresh = [msg("c", 3), msg("d", 5), msg("e", 6)];
    expect(mergeNewestPage(current, fresh).map((m) => m.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(mergeNewestPage(current, [])).toEqual([]);
  });
  test("the thread wires the control to listBrandGroupMessages(conversationId, before)", () => {
    const route = source("app/messages/[conversationId].tsx");
    expect(route).toContain("const older = await listBrandGroupMessages(conversationId, before);");
    expect(route).toContain('testID="brand-group-load-earlier"');
    expect(route).toContain("setMessages((current) => mergeNewestPage(current, result.messages));");
  });
});

describe("Jump to latest and sticky days", () => {
  test("shows only when far from the newest message", () => {
    expect(showsJumpToLatest(401)).toBe(true);
    expect(showsJumpToLatest(400)).toBe(false);
  });
  test("sticky indices point at the day markers after the top control", () => {
    expect(stickyDayIndices([{ kind: "day" }, { kind: "message" }, { kind: "plan" }, { kind: "day" }], 1)).toEqual([1, 4]);
  });
  test("both sides render Jump to latest; the Team side sticks its day markers", () => {
    const route = source("app/messages/[conversationId].tsx");
    expect(route).toContain("stickyHeaderIndices={messages.length ? stickyDayIndices(threadItems, 1) : undefined}");
    expect(route).toContain('testID="brand-group-jump-latest"');
    expect(source("src/components/groupChat/GroupChatPanel.tsx")).toContain('testID="brand-guests-jump-latest"');
  });
});

describe("People per side", () => {
  test("Team: your team, then Mingla as one entry", () => {
    const people = source("src/components/messages/BrandGroupPeoplePanel.tsx");
    expect(people).toContain('t("messages.people_team")');
    expect(people).toContain('testID="brand-group-people-mingla"');
  });
  test("Guests: the guest list, names through the fallback, never the team", () => {
    const panel = source("src/components/groupChat/GroupChatPanel.tsx");
    expect(panel).toContain("filter((member) => !member.is_team)");
    expect(panel).toContain('guest.display_name?.trim() || t("messages.people_guest")');
    const route = source("app/messages/[conversationId].tsx");
    expect(route).toContain('detailTab === "people" && side === "guests" && guestChat ?');
    expect(route).toContain("<LazyBrandGuestPeoplePanel conversationId={guestChat.conversation_id} />");
  });
});
