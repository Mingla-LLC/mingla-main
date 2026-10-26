// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 3 (D9) — the group/collab header is 62pt with nothing in the
// strip and 108pt with matches or plans; the strip shows the real matched places
// and the next UPCOMING plan with "+N more", or the last plan muted when every
// plan is in the past; the Plans sheet groups Upcoming and Past.
//
// FAILS-ON-REVERT: change CHAT_HEADER_METRICS back toward the 124pt pill stack
// (or let chatHeaderHeight ignore the strip) and the height cases fail; pick the
// first row instead of the first upcoming one and the next-plan case fails; drop
// the past fallback and the "Last plan" case fails; restore collabHeaderPill or
// collabHeaderActionRow in MessageInterface and the wiring case fails.

import {
  buildCollabHeaderStrip,
  CHAT_HEADER_METRICS,
  chatHeaderHeight,
  groupPlans,
  hasUnseenMatches,
  memberFirstNames,
} from "../chatHeaderModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const NOW = Date.parse("2026-10-26T12:00:00Z");
const DAY = 86_400_000;
const plan = (id: string, offsetDays: number, title = id) => ({
  savedCardId: id,
  cardData: { title },
  scheduledAt: new Date(NOW + offsetDays * DAY).toISOString(),
  lockedByDisplayName: "Kemi",
});
const match = (id: string, title: string, image?: string) => ({ id, card_data: { title, image } });
const base = {
  matches: [],
  matchesLoading: false,
  plans: [],
  plansLoading: false,
  seenMatchIds: new Set<string>(),
  now: NOW,
  untitled: "Untitled",
};

Deno.test("D9 header height: 62pt empty, 108pt with the strip", () => {
  assertEquals(chatHeaderHeight(false), 62, "a new group is one 48pt row, 62pt in total");
  assertEquals(chatHeaderHeight(true), 108, "with matches or plans the header is 108pt");
  assertEquals(CHAT_HEADER_METRICS.titleRow, 48, "title row is 48pt");
  assertEquals(CHAT_HEADER_METRICS.strip, 40, "strip is 40pt");
  assertEquals(CHAT_HEADER_METRICS.swipeButtonHeight, 34, "Swipe is a 34pt button");
  assertEquals([CHAT_HEADER_METRICS.backButtonWidth, CHAT_HEADER_METRICS.backButtonHeight], [36, 44], "back is 36x44");
  assertEquals(CHAT_HEADER_METRICS.avatar, 32, "32pt avatars");
});

Deno.test("D9 strip is hidden for a new group (only Swipe)", () => {
  const strip = buildCollabHeaderStrip({ ...base, actionIds: ["swipe"] });
  assertEquals(strip.visible, false, "nothing in the strip");
  assertEquals(chatHeaderHeight(strip.visible), 62, "header stays 62pt");
});

Deno.test("D9 matches cell shows up to 3 photos, the count, names and an unseen dot", () => {
  const strip = buildCollabHeaderStrip({
    ...base,
    actionIds: ["matches", "swipe"],
    matches: [
      match("a", "Bature", "https://x/a.jpg"),
      match("b", "Nok", "https://x/b.jpg"),
      match("c", "Terra", "https://x/c.jpg"),
      match("d", "Rufus & Bee", "https://x/d.jpg"),
    ],
    seenMatchIds: new Set(["a", "b", "c"]),
  });
  assert(strip.visible && strip.matches, "matches cell present");
  assertEquals(strip.matches.count, 4, "count of every match");
  assertEquals(strip.matches.photos.length, 3, "at most 3 photos");
  assertEquals(strip.matches.names, "Bature, Nok, Terra", "first three names");
  assertEquals(strip.matches.hasUnseen, true, "d has not been opened");
  assertEquals(chatHeaderHeight(strip.visible), 108, "header is 108pt");
  assertEquals(hasUnseenMatches(["a"], new Set(["a"])), false, "no dot once every match is opened");
});

Deno.test("D9 plan cell: the next UPCOMING plan plus +N more", () => {
  const strip = buildCollabHeaderStrip({
    ...base,
    actionIds: ["swipe", "plans"],
    plans: [plan("old", -8, "Rufus & Bee"), plan("sat", 6, "Bature Brewery"), plan("sun", 7), plan("fri", 19)],
  });
  assert(strip.plan, "plan cell present");
  assertEquals(strip.plan.state, "upcoming", "there are upcoming plans");
  assertEquals(strip.plan.title, "Bature Brewery", "the soonest upcoming plan, not the past one");
  assertEquals(strip.plan.moreCount, 2, "+2 more upcoming");
});

Deno.test("D9 plan cell: every plan in the past shows the last plan, muted", () => {
  const strip = buildCollabHeaderStrip({
    ...base,
    actionIds: ["swipe", "plans"],
    plans: [plan("older", -20, "Nok"), plan("last", -2, "Terra rooftop")],
  });
  assert(strip.plan, "plan cell present");
  assertEquals(strip.plan.state, "past", "Last plan state");
  assertEquals(strip.plan.title, "Terra rooftop", "the most recent past plan");
  assertEquals(strip.plan.moreCount, 0, "no +N more for past plans");
});

Deno.test("D9 Plans sheet groups Upcoming (soonest first) and Past (latest first)", () => {
  const { upcoming, past } = groupPlans([plan("p1", -9), plan("u2", 9), plan("p2", -1), plan("u1", 1)], NOW);
  assertEquals(upcoming.map((row) => row.savedCardId), ["u1", "u2"], "upcoming order");
  assertEquals(past.map((row) => row.savedCardId), ["p2", "p1"], "past order");
});

Deno.test("D9 members' first names read 'Tomi, Kemi and you'", () => {
  const text = memberFirstNames(["Tomi Bello", "Kemi Ade"], "you", (names) => `${names} and you`);
  assertEquals(text, "Tomi, Kemi and you", "first names then you");
});

Deno.test("D9 wiring: MessageInterface renders ChatHeader and the pill rows are gone", async () => {
  const root = new URL("../../../", import.meta.url);
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const chat = strip(await Deno.readTextFile(new URL("components/MessageInterface.tsx", root)));
  assert(/<ChatHeader\b/.test(chat), "MessageInterface renders the shared ChatHeader");
  assert(!/collabHeaderPill|collabHeaderActionRow/.test(chat), "the 124pt pill header is gone");
  assert(/buildCollabHeaderStrip\(/.test(chat), "the strip is built from the loaded hooks");
  assert(/onStripPress=\{handleCollabStripPress\}/.test(chat), "strip taps route through the existing deck views");
  const header = strip(await Deno.readTextFile(new URL("components/chat/ChatHeader.tsx", root)));
  assert(/height: M\.titleRow/.test(header) && /height: M\.strip/.test(header), "ChatHeader sizes from CHAT_HEADER_METRICS");
  assert(/duration: STRIP_MOTION_MS/.test(header) && /STRIP_MOTION_MS = 240/.test(header), "strip opens in 240ms");
  assert(/isReduceMotionEnabled/.test(header), "no motion under Reduce Motion");
  const banners = strip(await Deno.readTextFile(new URL("components/chat/CollabSessionChatBanners.tsx", root)));
  assert(/groupPlans\(rows/.test(banners) && /chat:plansUpcoming/.test(banners) && /chat:plansPast/.test(banners),
    "the Plans sheet groups Upcoming and Past");
  assert(/chat:planSetBy/.test(banners), "each plan says who set it");
});
