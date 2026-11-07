/**
 * #4304 part 2 — the Brand-group chat model: clustering, day separators,
 * inbox formatting, seen-by, typing, mentions, reactions and the message menu.
 */
import {
  BRAND_GROUP_REACTION_EMOJI,
  brandGroupDayLabel,
  brandGroupHeaderSubtitle,
  brandGroupInboxPreview,
  brandGroupInboxTime,
  brandGroupReactionToggle,
  brandGroupSeenBy,
  brandGroupThreadHref,
  brandGroupTypingText,
  buildBrandGroupMessageMenu,
  buildBrandGroupThreadItems,
  filterBrandGroups,
  splitBrandGroupMentions,
  summariseBrandGroupReactions,
  type BrandGroupInboxInput,
} from "../brandGroupThreadModel";

const at = (y: number, mo: number, d: number, h = 12, mi = 0, s = 0): string =>
  new Date(y, mo - 1, d, h, mi, s).toISOString();

const msg = (id: string, sender: string | null, created_at: string, extra: Record<string, unknown> = {}) => ({
  id,
  sender_id: sender,
  sender_role: null as string | null,
  created_at,
  message_type: "text",
  ...extra,
});

const NOW = new Date(2026, 10, 7, 15, 0); // Sat 7 Nov 2026, 15:00 local

describe("#4304 clustering", () => {
  it("clusters the same sender within two minutes and marks first/middle/last", () => {
    const items = buildBrandGroupThreadItems([
      msg("a", "ada", at(2026, 11, 7, 10, 0, 0)),
      msg("b", "ada", at(2026, 11, 7, 10, 1, 0)),
      msg("c", "ada", at(2026, 11, 7, 10, 2, 30)),
      msg("d", "ada", at(2026, 11, 7, 10, 5, 0)),
      msg("e", "me", at(2026, 11, 7, 10, 5, 10)),
    ], "me", NOW).filter((item) => item.kind === "message");
    const shape = items.map((item) => item.kind === "message"
      ? [item.key, item.position, item.showSender, item.showAvatar, item.showTime]
      : []);
    expect(shape).toEqual([
      ["a", "first", true, false, false],
      ["b", "middle", false, false, false],
      ["c", "last", false, true, true],
      // 2.5 min after c → a new cluster
      ["d", "solo", true, true, true],
      // my own message never shows my name or avatar
      ["e", "solo", false, false, true],
    ]);
  });

  it("breaks a cluster on role change, on a system line and across midnight", () => {
    const items = buildBrandGroupThreadItems([
      msg("a", "ada", at(2026, 11, 6, 23, 59, 0)),
      msg("b", "ada", at(2026, 11, 7, 0, 0, 30)),
      msg("c", "ada", at(2026, 11, 7, 0, 1, 0), { sender_role: "Mingla Support" }),
      msg("sys", null, at(2026, 11, 7, 0, 1, 10), { message_type: "system" }),
      msg("d", "ada", at(2026, 11, 7, 0, 1, 20), { sender_role: "Mingla Support" }),
    ], "me", NOW);
    expect(items.map((item) => item.kind === "day" ? `day:${item.label}` : `${item.key}:${item.position}`)).toEqual([
      "day:Yesterday",
      "a:solo",
      "day:Today",
      "b:solo",
      "c:solo",
      "sys:solo",
      "d:solo",
    ]);
  });
});

describe("#4304 day separators and times", () => {
  it("labels Today, Yesterday, a weekday date and another year", () => {
    expect(brandGroupDayLabel(at(2026, 11, 7, 9), NOW)).toBe("Today");
    expect(brandGroupDayLabel(at(2026, 11, 6, 22), NOW)).toBe("Yesterday");
    expect(brandGroupDayLabel(at(2026, 11, 3, 9), NOW)).toBe("Tue 3 Nov");
    expect(brandGroupDayLabel(at(2025, 12, 31, 9), NOW)).toBe("Wed 31 Dec 2025");
  });

  it("formats inbox times as clock / Yesterday / weekday / date", () => {
    const today = at(2026, 11, 7, 9, 5);
    expect(brandGroupInboxTime(today, NOW)).toBe(new Date(today).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    expect(brandGroupInboxTime(at(2026, 11, 6, 9), NOW)).toBe("Yesterday");
    expect(brandGroupInboxTime(at(2026, 11, 3, 9), NOW)).toBe("Tue");
    expect(brandGroupInboxTime(at(2026, 10, 20, 9), NOW)).toBe("20 Oct");
    expect(brandGroupInboxTime(at(2025, 10, 20, 9), NOW)).toBe("20 Oct 2025");
    expect(brandGroupInboxTime(null, NOW)).toBe("");
  });
});

describe("#4304 inbox rows", () => {
  const base: BrandGroupInboxInput = {
    conversation_id: "g1",
    brand_name: "Lagos Social",
    last_message_preview: "Doors at 7?",
    member_count: 4,
    unread_count: 0,
    access_kind: "brand",
    last_message_sender_id: "ada",
    last_message_sender_name: "Ada Obi",
    last_message_type: "text",
  };

  it("names the last speaker, says You for mine, and describes media", () => {
    expect(brandGroupInboxPreview(base, "me")).toBe("Ada: Doors at 7?");
    expect(brandGroupInboxPreview({ ...base, last_message_sender_id: "me" }, "me")).toBe("You: Doors at 7?");
    expect(brandGroupInboxPreview({ ...base, last_message_type: "image" }, "me")).toBe("Ada: Photo");
    expect(brandGroupInboxPreview({ ...base, last_message_type: "system", last_message_preview: "Plan updated" }, "me")).toBe("Plan updated");
    expect(brandGroupInboxPreview({ ...base, last_message_preview: "" }, "me")).toBe("4 people · Brand group");
  });

  it("filters All / Unread / My brands / Supporting and searches names and previews", () => {
    const groups: BrandGroupInboxInput[] = [
      base,
      { ...base, conversation_id: "g2", brand_name: "Abuja Eats", unread_count: 3, last_message_preview: "menu tasting" },
      { ...base, conversation_id: "g3", brand_name: "Support Co", access_kind: "support" },
    ];
    const ids = (rows: BrandGroupInboxInput[]): string[] => rows.map((row) => row.conversation_id);
    expect(ids(filterBrandGroups(groups, "all", ""))).toEqual(["g1", "g2", "g3"]);
    expect(ids(filterBrandGroups(groups, "unread", ""))).toEqual(["g2"]);
    expect(ids(filterBrandGroups(groups, "mine", ""))).toEqual(["g1", "g2"]);
    expect(ids(filterBrandGroups(groups, "supporting", ""))).toEqual(["g3"]);
    expect(ids(filterBrandGroups(groups, "all", "abuja"))).toEqual(["g2"]);
    expect(ids(filterBrandGroups(groups, "all", "TASTING"))).toEqual(["g2"]);
  });

  it("opens Support-access groups in support mode", () => {
    expect(brandGroupThreadHref({ conversation_id: "g3", access_kind: "support" })).toBe("/messages/g3?mode=support");
    expect(brandGroupThreadHref({ conversation_id: "g1", access_kind: "brand" })).toBe("/messages/g1?mode=brand");
  });
});

describe("#4304 header, typing and seen-by", () => {
  it("summarises teammates without the viewer", () => {
    const members = ["Ada Obi", "Kim Lee", "Seth O", "Me Myself", "Tolu A", "Zara B", "Yemi C"]
      .map((name, index) => ({ user_id: index === 3 ? "me" : `u${index}`, display_name: name }));
    expect(brandGroupHeaderSubtitle(members, "me")).toBe("Ada, Kim, Seth +3");
    expect(brandGroupHeaderSubtitle([{ user_id: "me", display_name: "Me" }], "me")).toBe("Just you so far");
  });

  it("phrases typing for one, two and many", () => {
    expect(brandGroupTypingText([])).toBeNull();
    expect(brandGroupTypingText(["Ada Obi"])).toBe("Ada is typing…");
    expect(brandGroupTypingText(["Ada Obi", "Kim Lee"])).toBe("Ada and Kim are typing…");
    expect(brandGroupTypingText(["A", "B", "C"])).toBe("3 people are typing…");
  });

  it("shows Seen by only under my latest message, from real read pointers", () => {
    const messages = [msg("a", "ada", at(2026, 11, 7, 10)), msg("b", "me", at(2026, 11, 7, 11))];
    const reads = [
      { user_id: "ada", display_name: "Ada Obi", last_read_at: at(2026, 11, 7, 11, 1) },
      { user_id: "kim", display_name: "Kim Lee", last_read_at: at(2026, 11, 7, 11, 2) },
      { user_id: "tolu", display_name: "Tolu A", last_read_at: at(2026, 11, 7, 11, 3) },
      { user_id: "late", display_name: "Late Reader", last_read_at: at(2026, 11, 7, 10, 30) },
    ];
    expect(brandGroupSeenBy(messages, reads, "me")).toEqual({ messageId: "b", text: "Seen by Ada, Kim +1" });
    // Nobody has read it yet → nothing, never a fabricated line.
    expect(brandGroupSeenBy(messages, reads.slice(3), "me")).toBeNull();
    // Someone else spoke last → no seen-by.
    expect(brandGroupSeenBy([...messages, msg("c", "ada", at(2026, 11, 7, 12))], reads, "me")).toBeNull();
  });
});

describe("#4304 mentions", () => {
  it("styles known @names, longest first, and leaves e-mail-like text alone", () => {
    expect(splitBrandGroupMentions("Hi @Ada Obi and @Ada, mail ada@x.com", ["Ada", "Ada Obi"])).toEqual([
      { text: "Hi ", mention: false },
      { text: "@Ada Obi", mention: true },
      { text: " and ", mention: false },
      { text: "@Ada", mention: true },
      { text: ", mail ada@x.com", mention: false },
    ]);
    expect(splitBrandGroupMentions("no mentions", ["Ada"])).toEqual([{ text: "no mentions", mention: false }]);
  });
});

describe("#4304 reactions", () => {
  const rows = [
    { id: "r1", message_id: "m1", user_id: "ada", emoji: "🔥" },
    { id: "r2", message_id: "m1", user_id: "me", emoji: "❤️" },
    { id: "r3", message_id: "m1", user_id: "kim", emoji: "❤️" },
  ];

  it("aggregates pills in offered order with my state", () => {
    expect(summariseBrandGroupReactions(rows, "me").get("m1")).toEqual([
      { emoji: "❤️", count: 2, mine: true },
      { emoji: "🔥", count: 1, mine: false },
    ]);
  });

  it("toggles: removes my own row, otherwise adds", () => {
    expect(brandGroupReactionToggle(rows, "m1", "❤️", "me")).toEqual({ action: "remove", rowId: "r2" });
    expect(brandGroupReactionToggle(rows, "m1", "🔥", "me")).toEqual({ action: "add" });
  });

  it("offers exactly the six emoji the database accepts", () => {
    expect(BRAND_GROUP_REACTION_EMOJI).toEqual(["❤️", "👍", "😂", "😮", "😢", "🔥"]);
  });
});

describe("#4304 message menu", () => {
  it("offers Reply, Copy, Create product signal and Select for Support on a text message", () => {
    expect(buildBrandGroupMessageMenu({ senderName: "Ada", hasText: true, canSupport: true, selected: false }).map((action) => action.label))
      .toEqual(["Reply", "Copy", "Create product signal", "Select"]);
  });

  it("hides Copy without text and the signal for non-Support, and flips Select", () => {
    expect(buildBrandGroupMessageMenu({ senderName: "Ada", hasText: false, canSupport: false, selected: true }).map((action) => action.key))
      .toEqual(["reply", "select"]);
    expect(buildBrandGroupMessageMenu({ senderName: "Ada", hasText: false, canSupport: false, selected: true })[1].label).toBe("Unselect");
  });
});
