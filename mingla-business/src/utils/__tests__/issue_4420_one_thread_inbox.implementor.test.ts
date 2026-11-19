/**
 * #4420 — Host Messages, one thread per brand: the pure model.
 *
 * SC-1 one row per brand (no GUESTS section), SC-2 switcher only for team rows
 * with a Guest chat, SC-8 redirects, SC-3 audience words (unknown N is never
 * 0), SC-7 plan-line folding boundaries.
 *
 * FAILS ON REVERT: emit a second row for a brand's Guest chat, attach a Guest
 * chat to a support row, show N=0 while the roster is unknown, fold a plan
 * line together with a chat message or across a day, or drop the side param
 * from the redirect, and the matching test fails.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BrandGroupSummary } from "../../services/brandGroupsService";
import type { BrandGuestActivity, BrandGuestChatSummary } from "../../services/brandGuestChatList";
import { buildBrandGroupThreadItems } from "../brandGroupThreadModel";
import { brandPlanActivityTitle, foldBrandPlanLines } from "../brandGroupPlanFold";
import { guestAudienceCount, guestAudienceLine, guestConfirmCopy, guestSendLabel } from "../brandGuestAudience";
import {
  brandInboxOpenSide,
  brandInboxRowHref,
  brandInboxRowPreview,
  buildBrandInboxRows,
  filterBrandInboxRows,
  guestChatRedirectHref,
  parseMessagesSide,
  showsSideSwitcher,
} from "../brandMessagesInbox";

const source = (relative: string): string => readFileSync(join(process.cwd(), relative), "utf8");
// English words, as the app reads them (messages.* in the locale files).
const words = (JSON.parse(source("src/i18n/locales/en/brandMessages.json")) as { messages: Record<string, string> }).messages;
const t = (key: string, variables: Record<string, string | number> = {}): string =>
  (words[key.replace(/^messages\./, "")] ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(variables[name] ?? ""));

const group = (over: Partial<BrandGroupSummary>): BrandGroupSummary => ({
  conversation_id: "g-ty",
  brand_id: "ty",
  brand_name: "Tinoe's Yard",
  brand_slug: "ty",
  brand_photo_url: null,
  last_message_at: "2026-11-19T09:12:00Z",
  last_message_preview: "Done, it's on the plan",
  unread_count: 2,
  member_count: 4,
  access_kind: "brand",
  push_enabled: true,
  muted: false,
  last_message_sender_id: "michelle",
  last_message_sender_name: "Michelle",
  last_message_type: "text",
  ...over,
});

const guestChat = (over: Partial<BrandGuestChatSummary>): BrandGuestChatSummary => ({
  conversation_id: "x-ty",
  brand_id: "ty",
  brand_name: "Tinoe's Yard",
  brand_logo_url: null,
  is_broadcast_only: true,
  member_count: 27,
  last_message_at: "2026-11-18T12:30:00Z",
  ...over,
});

const activity = (over: Partial<BrandGuestActivity>): BrandGuestActivity => ({
  conversation_id: "x-ty",
  unread_count: 0,
  last_message_preview: "Parking: street parking",
  last_message_from_brand: true,
  last_message_at: "2026-11-18T12:30:00Z",
  ...over,
});

describe("SC-1 one row per brand", () => {
  test("a brand with a Team chat and a Guest chat is ONE row carrying both", () => {
    const rows = buildBrandInboxRows([group({})], [guestChat({})]);
    expect(rows).toHaveLength(1);
    expect(rows[0].group?.conversation_id).toBe("g-ty");
    expect(rows[0].guestChat?.conversation_id).toBe("x-ty");
  });

  test("seven brands, five with Guest chats, are seven rows", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const groups = ids.map((id, i) => group({ brand_id: id, conversation_id: `g-${id}`, brand_name: id.toUpperCase(), last_message_at: `2026-11-1${i}T10:00:00Z` }));
    const guests = ids.slice(0, 5).map((id) => guestChat({ brand_id: id, conversation_id: `x-${id}`, brand_name: id.toUpperCase() }));
    const rows = buildBrandInboxRows(groups, guests);
    expect(rows.map((row) => row.brandId).sort()).toEqual(ids);
    expect(new Set(rows.map((row) => row.key)).size).toBe(7);
  });

  test("time is the later of the two sides and the preview names the side that spoke last", () => {
    const later = buildBrandInboxRows(
      [group({ last_message_at: "2026-11-10T08:00:00Z" })],
      [guestChat({})],
      new Map([["x-ty", activity({ last_message_at: "2026-11-18T12:30:00Z" })]]),
    )[0];
    expect(later.lastAt).toBe("2026-11-18T12:30:00Z");
    expect(later.lastSide).toBe("guests");
    expect(brandInboxRowPreview(later, null, t)).toEqual({ side: "guests", text: "As Tinoe's Yard: Parking: street parking" });
    const teamLast = buildBrandInboxRows([group({})], [guestChat({})], new Map([["x-ty", activity({})]]))[0];
    expect(teamLast.lastSide).toBe("team");
    expect(brandInboxRowPreview(teamLast, null, t)).toEqual({ side: "team", text: "Michelle: Done, it's on the plan" });
  });

  test("P3-2 a contentless last guest message shows a fallback, never a blank line", () => {
    const at = "2026-11-19T11:00:00Z";
    const row = (fromBrand: boolean) => buildBrandInboxRows(
      [group({ last_message_at: "2026-11-10T08:00:00Z" })],
      [guestChat({})],
      new Map([["x-ty", activity({ last_message_preview: "  ", last_message_from_brand: fromBrand, last_message_at: at })]]),
    )[0];
    expect(brandInboxRowPreview(row(false), null, t)).toEqual({ side: "guests", text: "Sent an update" });
    expect(brandInboxRowPreview(row(true), null, t)).toEqual({ side: "guests", text: "As Tinoe's Yard: Sent an update" });
    const empty = buildBrandInboxRows([], [guestChat({ last_message_at: null })], new Map([["x-ty", activity({ last_message_preview: "", last_message_at: null })]]))[0];
    expect(brandInboxRowPreview(empty, null, t)).toEqual({ side: "guests", text: "No guest messages yet" });
  });

  test("a support row never carries a Guest chat; the Guest chat is not lost", () => {
    const rows = buildBrandInboxRows([group({ access_kind: "support" })], [guestChat({})]);
    expect(rows).toHaveLength(1);
    expect(rows[0].guestChat).toBeNull();
    expect(showsSideSwitcher(rows[0].group, rows[0].guestChat)).toBe(false);
  });

  test("a Guest chat with no Team chat still gets a row that opens on Guests", () => {
    const rows = buildBrandInboxRows([], [guestChat({ brand_id: "lw", conversation_id: "x-lw", brand_name: "LekkiWaterside" })]);
    expect(rows).toHaveLength(1);
    expect(brandInboxOpenSide(rows[0])).toBe("guests");
    expect(brandInboxRowHref(rows[0])).toBe("/brand/lw/guest-chat");
  });

  test("badges: team unread and guest unread are separate; unread filter counts both", () => {
    const rows = buildBrandInboxRows(
      [group({ unread_count: 0 }), group({ brand_id: "ff", conversation_id: "g-ff", brand_name: "Foodie", unread_count: 0 })],
      [guestChat({ brand_id: "ff", conversation_id: "x-ff" })],
      new Map([["x-ff", activity({ conversation_id: "x-ff", unread_count: 3 })]]),
    );
    const foodie = rows.find((row) => row.brandId === "ff");
    expect(foodie?.guestUnread).toBe(3);
    expect(foodie?.teamUnread).toBe(0);
    expect(filterBrandInboxRows(rows, "unread", "", null, t).map((row) => row.brandId)).toEqual(["ff"]);
    // Guests-only news opens the Guests side.
    expect(foodie && brandInboxOpenSide(foodie)).toBe("guests");
  });
});

describe("SC-2 switcher and the URL side param", () => {
  test("only a team row with a Guest chat shows the switcher", () => {
    expect(showsSideSwitcher({ access_kind: "brand" }, guestChat({}))).toBe(true);
    expect(showsSideSwitcher({ access_kind: "brand" }, null)).toBe(false);
    expect(showsSideSwitcher({ access_kind: "support" }, guestChat({}))).toBe(false);
    expect(showsSideSwitcher(null, guestChat({}))).toBe(false);
  });

  test("side is guests only when the URL says so", () => {
    expect(parseMessagesSide("guests")).toBe("guests");
    expect(parseMessagesSide(["guests"])).toBe("guests");
    expect(parseMessagesSide("team")).toBe("team");
    expect(parseMessagesSide("javascript:alert(1)")).toBe("team");
    expect(parseMessagesSide(undefined)).toBe("team");
  });
});

describe("SC-8 redirects", () => {
  const groups = [group({}), group({ brand_id: "sup", conversation_id: "g-sup", access_kind: "support" })];
  test("/brand/X/guest-chat and /messages/<guest id> land on X's thread with Guests selected", () => {
    expect(guestChatRedirectHref("ty", groups)).toBe("/messages/g-ty?mode=brand&side=guests");
  });
  test("no Team chat the viewer runs → no redirect (the Guest chat shows on its own)", () => {
    expect(guestChatRedirectHref("lw", groups)).toBeNull();
    expect(guestChatRedirectHref("sup", groups)).toBeNull();
    expect(guestChatRedirectHref(null, groups)).toBeNull();
  });
  test("the guest-chat route redirects with the same rule, inline, and keeps the fallback panel", () => {
    const route = source("app/brand/[id]/guest-chat.tsx");
    expect(route).toContain("`/messages/${group.conversation_id}?mode=brand&side=guests`");
    expect(route).toContain('item.access_kind === "brand"');
    expect(route).toContain("<Redirect href={href as never} />");
    expect(route).toContain("<LazyGroupChatPanel brandId={id} teamUnavailable />");
    expect(route).not.toMatch(/from "[^"]*brandMessagesInbox"/);
  });
  test("/messages/<guest chat id> redirects to its brand's Guests side", () => {
    const thread = source("app/messages/[conversationId].tsx");
    expect(thread).toContain("guestChats.chats.find((chat) => chat.conversation_id === conversationId)");
    expect(thread).toContain("guestChatRedirectHref(guestMatch.brand_id, groups) ?? brandGuestChatHref(guestMatch.brand_id)");
  });
  test("a Brand group push still opens /messages/<id> (routing unchanged)", () => {
    expect(brandInboxRowHref(buildBrandInboxRows([group({})], [])[0])).toBe("/messages/g-ty?mode=brand");
  });
});

describe("SC-3 the Guests audience never shows an unknown N as 0", () => {
  const members = [{ is_team: true }, { is_team: false }, { is_team: false }];
  test("N counts only members who are not on the team", () => {
    expect(guestAudienceCount(members, { loaded: true, error: null })).toBe(2);
  });
  test("loading or failed roster → unknown, and the words say 'your guests'", () => {
    expect(guestAudienceCount(members, { loaded: false, error: null })).toBeNull();
    expect(guestAudienceCount([], { loaded: true, error: "boom" })).toBeNull();
    expect(guestAudienceLine(t, null, "Tinoe's Yard", false)).toBe("To your guests · as Tinoe's Yard");
    expect(guestAudienceLine(t, null, "Tinoe's Yard", false)).not.toMatch(/\b0 guests/);
  });
  test("open chat, broadcast and the first-send check", () => {
    expect(guestAudienceLine(t, 23, "Tinoe's Yard", false)).toBe("To 23 guests · as Tinoe's Yard");
    expect(guestAudienceLine(t, 23, "Tinoe's Yard", true)).toBe("Broadcast to 23 guests as Tinoe's Yard");
    expect(guestSendLabel(t, false)).toBe("Send to guests");
    expect(guestSendLabel(t, true)).toBe("Broadcast");
    expect(guestConfirmCopy(t, 23, "Tinoe's Yard", false).title).toBe("Send to 23 guests?");
    expect(guestConfirmCopy(t, 23, "Tinoe's Yard", true).title).toBe("Broadcast to 23 guests?");
    expect(guestConfirmCopy(t, null, "Tinoe's Yard", false).title).toBe("Send to your guests?");
  });
});

describe("SC-7 plan lines fold into one card", () => {
  const at = (minute: number, day = 11): string => `2026-11-${day}T10:${String(minute).padStart(2, "0")}:00`;
  const plan = (id: string, minute: number, day = 11) => ({
    id, sender_id: null, sender_role: null, message_type: "system", created_at: at(minute, day),
    content: `Mingla added “Item ${id}” to the plan for Tue 25 Nov.`,
  });
  const chat = (id: string, minute: number, day = 11) => ({
    id, sender_id: "feji", sender_role: null, message_type: "text", created_at: at(minute, day), content: "hello",
  });
  const fold = (messages: ReturnType<typeof plan | typeof chat>[]) =>
    foldBrandPlanLines(buildBrandGroupThreadItems(messages, null, new Date("2026-11-19T12:00:00")));

  test("three or more consecutive plan lines render as one card", () => {
    const items = fold([plan("a", 1), plan("b", 2), plan("c", 3), plan("d", 4)]);
    const cards = items.filter((item) => item.kind === "plan");
    expect(cards).toHaveLength(1);
    expect(cards[0].kind === "plan" && cards[0].lines.map((line) => line.id)).toEqual(["a", "b", "c", "d"]);
    expect(cards[0].kind === "plan" && brandPlanActivityTitle(t, cards[0].lines)).toBe("Mingla added 4 items to the plan");
  });

  test("a plan line followed by a chat message stays two items", () => {
    const items = fold([plan("a", 1), chat("m", 2)]).filter((item) => item.kind !== "day");
    expect(items.map((item) => item.kind)).toEqual(["plan", "message"]);
  });

  test("a chat message between plan lines splits the run", () => {
    const items = fold([plan("a", 1), plan("b", 2), chat("m", 3), plan("c", 4)]).filter((item) => item.kind !== "day");
    expect(items.map((item) => item.kind)).toEqual(["plan", "message", "plan"]);
  });

  test("a day change splits the run", () => {
    const items = fold([plan("a", 1, 11), plan("b", 2, 11), plan("c", 1, 12)]);
    expect(items.map((item) => item.kind)).toEqual(["day", "plan", "day", "plan"]);
  });

  test("a system line someone sent is not a plan line", () => {
    const items = fold([{ ...plan("a", 1), sender_id: "staff" }]).filter((item) => item.kind !== "day");
    expect(items.map((item) => item.kind)).toEqual(["message"]);
  });

  test("mixed authors read as plan updates", () => {
    expect(brandPlanActivityTitle(t, [{ content: "Mingla added “A” to the plan." }, { content: "Feji added “B” to the plan." }])).toBe("2 plan updates");
  });
});
