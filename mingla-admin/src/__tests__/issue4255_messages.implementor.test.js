// #4255 W4 — Messages at the top of Admin (D11, D14).
//
//   M-1 the Messages button sits between Search and Live; below 768px only
//       the icon and the badge show and the top bar never wraps
//   M-2 one count call on one 30 s poll (plus realtime) feeds the badge; it
//       never re-polls what useReviewCount polls
//   M-3 #/notifications redirects to #/messages (old email links keep working)
//   M-4 the Notifications menu item and its Bell icon are gone (no hard-coded
//       menu totals: other work adds menu groups)
//   M-5 Notifications: For you / Watching / All, grouped by card, decisions
//       first; support alerts (#3988) still appear as their own group
//   M-6 Settings writes the same stored preferences the Host app writes, and
//       email keeps the #3988 per-alert setting; direct messages and group
//       messages are separate switches (fix-up, 10 Nov)
//   F-5 (fix-up) Team chats: edit and delete your own message at its
//       revision, load older pages with p_before, and @everyone only when
//       team_badge says admin
//   R-1 (rework, 11 Nov) Direct messages have the push switch alone (the
//       in-app switch did nothing); "My cards due and late" is a row; the
//       Group messages words follow its push switch
//   R-2 (rework) the 09:00 due notice is its own "Due and late" group
//   R2-1 (rework 2, P1) Admin loading for a teammate saves this browser's
//       IANA time zone (team_set_my_timezone), once per zone, again when the
//       tab comes back with a new one; Settings shows "Time zone: <zone>
//       (from this device)"
//
// Retest 2 FAILS-ON-REVERT: putting the excerpt's "· You send" tail back in
// mentionGroup (or dropping the m.decision line) reds R3-1.
//
// Rework 2 FAILS-ON-REVERT: deleting the useTeamTimeZoneSync call in
// MessagesButton, or the "zone !== lastSaved" check in timeZoneToSave, reds
// R2-1.
//
// Rework FAILS-ON-REVERT: putting "inapp" back on the Direct messages row or
// deleting the business.team_due row reds R-1's row pin; deleting
// settingHint's switch check (or MessagesSettings showing row.hint again)
// reds R-1's hint tests; deleting the work_due line in mentionGroup reds R-2.
//
// FAILS-ON-REVERT: deleting the `notifications` line from
// RETIRED_PAGE_REDIRECTS (lib/adminRoutes.js) reds M-3; putting the support
// group back out of notificationGroups reds M-5.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, HEADER_PAGE_ITEMS } from "../lib/constants.js";
import { isRetiredPageId, redirectHash } from "../lib/adminRoutes.js";
import {
  NOTIFICATION_FILTERS,
  forYouUnread,
  mentionGroup,
  mentionIds,
  messagesBadge,
  messagesButtonLabel,
  notificationGroups,
  mergeTeamPages,
  olderCursor,
  rowTarget,
  SETTING_ROWS,
  settingHint,
  teamPrefOn,
  threadFromSearch,
  createTimeZoneSync,
  deviceTimeZone,
  timeZoneLine,
  timeZoneToSave,
} from "../lib/messagesModel.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const CARD_A = "12121212-1212-4121-8121-121212121212";
const CARD_B = "13131313-1313-4131-8131-131313131313";
const THREAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const at = (m) => new Date(Date.UTC(2026, 10, 10, 12, 0) - m * 60000).toISOString();
const INBOX = {
  mentions: [
    { id: "m1", kind: "mention", source_kind: "work_card", card_id: CARD_A, actor_name: "Ray", body_excerpt: "Ray on Edit: @Seth the end card", created_at: at(34), read_at: null },
    { id: "m2", kind: "mention", source_kind: "work_card", card_id: CARD_A, actor_name: "Abimbola", body_excerpt: "Abimbola on Edit: uploading", created_at: at(40), read_at: null },
    { id: "m3", kind: "work_update", source_kind: "work_card", card_id: CARD_B, actor_name: "Taofeek", body_excerpt: "Taofeek: Approve spend · You spend", decision: true, created_at: at(12), read_at: null },
    { id: "m4", kind: "work_update", source_kind: "work_card", card_id: CARD_B, actor_name: "Taofeek", body_excerpt: "Taofeek moved it to Waiting", created_at: at(90), read_at: null },
    { id: "m5", kind: "mention", source_kind: "team_message", card_id: null, thread_id: THREAD, actor_name: "Feyikemi", body_excerpt: "@Seth flyer?", created_at: at(20), read_at: null },
  ],
  alerts: [
    { id: "a1", type: "business.support_new_ticket", title: "New ticket", body: "Lagos Social", created_at: at(60), read_at: null, ticket_resolved: false },
    { id: "a2", type: "business.support_ticket_reply", title: "Reply", body: "x", created_at: at(70), read_at: null, ticket_resolved: true },
  ],
};

describe("M-1 the Messages button in the top bar", () => {
  const header = stripComments(read("components/layout/Header.jsx"));
  const button = stripComments(read("components/messages/MessagesButton.jsx"));
  it("sits between Search and Live, on every page", () => {
    const search = header.indexOf("onClick={onOpenSearch}");
    const messages = header.indexOf("<MessagesButton />");
    const live = header.indexOf("Live\n");
    assert.ok(search > 0 && messages > search && live > messages, "Search, then Messages, then Live");
  });
  it("below 768px the label hides: icon and badge only, a fixed 32px box", () => {
    assert.match(button, /data-messages-label="" className="hidden md:inline">Messages</);
    assert.match(button, /"w-8 justify-center px-0 md:w-auto md:justify-start md:px-2\.5"/);
    assert.match(button, /shrink-0/);
  });
  it("the top bar never wraps", () => {
    const bar = header.slice(header.indexOf("<header"), header.indexOf(">", header.indexOf("<header")));
    assert.equal(/flex-wrap/.test(bar), false);
    assert.equal(/flex-wrap/.test(header.slice(header.indexOf('className="ml-auto flex shrink-0'), header.indexOf("<MessagesButton />"))), false);
  });
  it("one badge, said in words for screen readers; the panel is 440px, top right", () => {
    assert.equal(messagesButtonLabel(0), "Messages");
    assert.equal(messagesButtonLabel(7), "Messages, 7 unread");
    assert.match(button, /aria-label=\{label\}/);
    assert.match(button, /w-\[min\(440px,calc\(100vw-24px\)\)\]/);
    assert.match(button, /fixed bottom-3 right-3/);
    assert.match(button, /Open full page/);
  });
});

describe("M-2 one count call, one 30 s poll, plus realtime", () => {
  const hook = stripComments(read("hooks/useMessages.js"));
  it("each tick reads the team badge and the inbox together, once", () => {
    assert.match(hook, /export const MESSAGES_POLL_MS = 30_000;/);
    assert.equal((hook.match(/setInterval\(/g) || []).length, 1, "one timer");
    assert.match(hook, /Promise\.allSettled\(\[fetchBadge\(\), getInbox\(SUPPORT_ALERT_TYPES\)\]\)/);
    assert.equal((hook.match(/fetchBadge\(/g) || []).length, 1);
  });
  it("one timer however many views are mounted (button, panel, full page)", () => {
    assert.match(hook, /if \(consumers === 1 && owner\) start\(\);/);
    assert.match(hook, /if \(consumers === 0\) stop\(\);/);
    assert.match(hook, /postgres_changes", \{ event: "\*", schema: "public", table: "team_messages" \}/);
  });
  it("it never polls the Work counts useReviewCount already polls", () => {
    assert.equal(/useReviewCount|fetchMyCounts|ops_my_counts|useOpsPoll/.test(hook), false);
  });
  it("a different person (or signing out) clears it first (rule 6)", () => {
    assert.match(hook, /emit\(\{ \.\.\.EMPTY, owner: next \}\);/);
    assert.match(hook, /const current = snap\.owner === uid \? snap : EMPTY;/);
  });
  it("the badge is unread chats plus unread notifications For you (not watched-card changes)", () => {
    assert.equal(forYouUnread(INBOX), 5); // m1, m2, m3 (decision), m5, a1 (a2 resolved)
    assert.equal(messagesBadge({ badge: { chats: 2 }, inbox: INBOX }), 7);
    assert.equal(messagesBadge({ badge: null, inbox: null }), null);
    assert.equal(messagesBadge({ badge: { chats: 0 }, inbox: { mentions: [INBOX.mentions[3]], alerts: [] } }), 0);
  });
});

describe("M-3 #/notifications redirects to #/messages", () => {
  it("the old address, with or without a query, opens Messages", () => {
    assert.equal(redirectHash("#/notifications"), "#/messages");
    assert.equal(redirectHash("#/notifications?thread=" + THREAD), "#/messages?thread=" + THREAD);
    assert.equal(isRetiredPageId("notifications"), true);
  });
  it("App routes messages to the full page and no longer has a Notifications page", () => {
    const app = stripComments(read("App.jsx"));
    assert.match(app, /messages: MessagesPage,/);
    assert.equal(/notifications: NotificationsPage/.test(app), false);
    assert.equal(fs.existsSync(path.join(SRC, "pages", "NotificationsPage.jsx")), false);
    assert.deepEqual(HEADER_PAGE_ITEMS.find((i) => i.id === "messages"), { id: "messages", label: "Messages" });
  });
  it("a team chat mention's link opens that chat", () => {
    assert.equal(threadFromSearch(`thread=${THREAD}`), THREAD);
    assert.equal(threadFromSearch("thread=../x"), null);
    assert.equal(threadFromSearch(""), null);
  });
  it("Messages carries the old page's access", () => {
    assert.match(read("lib/access.js"), /messages: Object\.freeze\(\[TEAM_NOTIFICATIONS_AREA\]\),/);
  });
});

describe("M-4 the Notifications menu item and its icon are gone", () => {
  const items = NAV_GROUPS.flatMap((g) => g.items);
  it("no menu item is Notifications", () => {
    assert.equal(items.some((i) => i.id === "notifications" || i.label === "Notifications"), false);
    assert.equal(items.some((i) => i.icon === "Bell"), false);
    assert.deepEqual(NAV_GROUPS.find((g) => g.label === "Home").items.map((i) => i.id), ["overview", "work-board"]);
  });
  it("Bell is neither registered nor imported in the Sidebar, and every menu icon still resolves", () => {
    const sidebar = read("components/layout/Sidebar.jsx");
    const block = sidebar.match(/const ICON_MAP = \{([\s\S]*?)\n\};/);
    assert.ok(block);
    const keys = [...stripComments(block[1]).matchAll(/^\s*([A-Za-z]\w*)(?:\s*:\s*[A-Za-z]\w*)?\s*,?\s*$/gm)].map((m) => m[1]);
    assert.equal(keys.includes("Bell"), false);
    const imports = stripComments(sidebar.match(/import \{([^}]*)\} from "lucide-react";/)[1]);
    assert.equal(/\bBell\b/.test(imports), false);
    for (const item of items) assert.ok(keys.includes(item.icon), item.id);
  });
});

describe("M-5 Notifications: chips and groups; support alerts stay a group", () => {
  it("For you / Watching / All", () => {
    assert.deepEqual(NOTIFICATION_FILTERS.map((f) => f.label), ["For you", "Watching", "All"]);
  });
  it("For you: decisions, then mentions and replies, then support alerts", () => {
    assert.deepEqual(notificationGroups(INBOX, "you").map((g) => g.id), ["decide", "mention", "support"]);
  });
  it("Watching: only changes on cards you own or watch", () => {
    assert.deepEqual(notificationGroups(INBOX, "watch").map((g) => g.id), ["status"]);
  });
  it("All: every group in the contract's order, support alerts included (#3988)", () => {
    const all = notificationGroups(INBOX, "all");
    assert.deepEqual(all.map((g) => g.id), ["decide", "mention", "support", "status"]);
    const support = all.find((g) => g.id === "support");
    assert.deepEqual(support.rows.map((r) => r.key), ["a-a1", "a-a2"]);
    assert.equal(support.rows[1].isNew, false, "a resolved ticket is never new");
    assert.match(support.rows[1].detail, /Resolved$/);
  });
  it("one row per card: the newest notice, '+N more on this card'", () => {
    const mention = notificationGroups(INBOX, "you").find((g) => g.id === "mention");
    const card = mention.rows.find((r) => r.cardId === CARD_A);
    assert.equal(card.key, "m-m1");
    assert.deepEqual(card.more.map((m) => m.key), ["m-m2"]);
    assert.equal(card.sources.length, 2, "Done marks both read");
  });
  it("the server's decision flag makes a decision; other card changes are Watching", () => {
    assert.equal(mentionGroup(INBOX.mentions[2]), "decide");
    assert.equal(mentionGroup(INBOX.mentions[3]), "status");
    assert.equal(mentionGroup(INBOX.mentions[0]), "mention");
  });
  it("done rows leave for this session; where each row opens", () => {
    assert.equal(notificationGroups(INBOX, "you", new Set(["a-a1", "a-a2"])).some((g) => g.id === "support"), false);
    const rows = notificationGroups(INBOX, "all").flatMap((g) => g.rows);
    assert.deepEqual(rowTarget(rows.find((r) => r.key === "m-m5")), { tab: "chats", threadId: THREAD });
    assert.deepEqual(rowTarget(rows.find((r) => r.key === "m-m1")), { hash: `#/work-board?card=${CARD_A}&side=thread:${CARD_A}` });
    assert.deepEqual(rowTarget(rows.find((r) => r.key === "m-m3")), { hash: `#/work-board?card=${CARD_B}` });
  });
  it("unread rows are flat: an orange dot and a bold title, no halo", () => {
    const view = stripComments(read("components/messages/MessagesNotifications.jsx"));
    assert.match(view, /row\.isNew \? "bg-\[var\(--color-brand-500\)\]" : "bg-transparent"/);
    assert.match(view, /row\.isNew \? "font-bold" : "font-medium"/);
    assert.equal(/ring-|shadow|bg-\[var\(--color-brand-50\)\][^"]*row\.isNew/.test(view.slice(view.indexOf("<li data-notification"), view.indexOf("</li>"))), false);
  });
});

describe("M-6 Settings writes the same stored preferences", () => {
  const service = stripComments(read("services/teamChatService.js"));
  const settings = stripComments(read("components/messages/MessagesSettings.jsx"));
  it("in-app and push are notification_channel_prefs rows of the signed-in user, as the Host app writes them", () => {
    assert.match(service, /from\("notification_channel_prefs"\)\.upsert\(\{ user_id: userId, category_key: categoryKey, channel, enabled: !!enabled, updated_at:/);
    assert.match(service, /categoryKey === "business\.team_group_message" && channel === "push" && !enabled\s*\? supabase\.from\("notification_channel_prefs"\)\.delete\(\)/);
    assert.match(service, /TEAM_PREF_CATEGORIES = Object\.freeze\(\["business\.team_mention", "business\.team_decision", "business\.team_message", "business\.team_group_message", "business\.team_due"\]\)/);
    assert.match(settings, /team\.setTeamPref\(userId, key, channel, on\)/);
  });
  it("the defaults read exactly as the Host app's (group message pushes off until switched on)", () => {
    // Fix-up: a DM pushes by default; a group only once its own switch is on.
    assert.equal(teamPrefOn([], "business.team_message", "push"), true);
    assert.equal(teamPrefOn([], "business.team_group_message", "push"), false);
    assert.equal(teamPrefOn([{ category_key: "business.team_message", channel: "push", enabled: true }], "business.team_group_message", "push"), false);
    assert.equal(teamPrefOn([{ category_key: "business.team_group_message", channel: "push", enabled: true }], "business.team_group_message", "push"), true);
    assert.equal(teamPrefOn([], "business.team_message", "inapp"), true);
    assert.equal(teamPrefOn([], "business.team_mention", "push"), true);
    assert.equal(teamPrefOn([{ category_key: "business.team_mention", channel: "push", enabled: false }], "business.team_mention", "push"), false);
    const host = path.join(SRC, "..", "..", "mingla-business", "src", "components", "minglaTeam", "TeamScreens.tsx");
    if (fs.existsSync(host)) {
      const h = fs.readFileSync(host, "utf8");
      assert.match(h, /return key !== "business\.team_group_message";/);
    }
  });
  it("Direct messages and Group messages are two rows, each a push switch alone; My cards due and late is the 09:00 row (rework)", () => {
    assert.deepEqual(SETTING_ROWS.map((r) => [r.key, r.label, r.channels.join("+")]), [
      ["business.team_mention", "Mentions and tags", "inapp+push"],
      ["business.team_decision", "Decisions for me", "inapp+push"],
      ["business.team_message", "Direct messages", "push"],
      ["business.team_group_message", "Group messages", "push"],
      ["business.team_due", "My cards due and late", "inapp+push"],
    ]);
    assert.match(settings, /\(row\.channels \|\| \["inapp", "push"\]\)\.includes\(channel\) \?/);
  });
  it("email is the #3988 per-alert setting, moved, not reset", () => {
    assert.match(settings, /collaboration\.getEmailAlertPreferences\(\)/);
    assert.match(settings, /collaboration\.setEmailAlertPreference\(alertKey, enabled\)/);
    assert.match(settings, /Every alert emails you unless you switch it off here\./);
  });
});

describe("Team chats: mentions are people in the chat", () => {
  it("RichComposer emails become user ids, only for members", () => {
    const people = [{ user_id: "u1", email: "ray@x.test" }, { user_id: "u2", email: "fey@x.test" }];
    assert.deepEqual(mentionIds(["RAY@x.test", "fey@x.test", "nobody@x.test"], people, [{ user_id: "u1" }]), ["u1"]);
  });
});

describe("F-5 Team chats: edit, delete, older pages, @everyone for admins (fix-up, 10 Nov)", () => {
  const chats = stripComments(read("components/messages/TeamChats.jsx"));
  const msg = (id, minute, extra = {}) => ({ id, created_at: at(-minute), body: id, revision: 1, ...extra });
  it("older pages and the latest page merge oldest first, each message once, the newer copy winning", () => {
    const older = [msg("a", 1), msg("b", 2), msg("c", 3, { body: "old words" })];
    const latest = [msg("c", 3, { body: "edited", revision: 2 }), msg("d", 4)];
    const merged = mergeTeamPages(older, latest);
    assert.deepEqual(merged.map((m) => m.id), ["a", "b", "c", "d"]);
    assert.equal(merged[2].body, "edited");
    assert.deepEqual(mergeTeamPages(null, undefined), []);
    assert.equal(olderCursor(merged), merged[0].created_at);
    assert.equal(olderCursor([]), null);
  });
  it("Load earlier messages reads the page before the oldest shown, as the Host app does", () => {
    assert.match(chats, /const page = await team\.getMessages\(threadId, 100, before\);/);
    assert.match(chats, /const before = olderCursor\(messages\);/);
    assert.match(chats, /data-load-older=""/);
    assert.doesNotMatch(chats, /Older messages are in the Host app\./);
  });
  it("your own messages offer Edit and Delete; both send the revision you saw", () => {
    assert.match(chats, /\{m\.mine && editing !== m\.id && \(/);
    assert.match(chats, /team\.editMessage\(m\.id, text, m\.revision\)/);
    assert.match(chats, /team\.deleteMessage\(m\.id, m\.revision\)/);
    assert.match(chats, /Delete for everyone\?/);
    // A stale revision (PT409, stale_write) shows the latest instead of failing silently.
    assert.match(chats, /if \(error\?\.token === "stale_write"\) \{\s*addToast\(\{ variant: "warning", title: "Someone changed this first\. Showing the latest\." \}\);/);
  });
  it("@everyone is offered only when team_badge says admin (the rule team_post enforces)", () => {
    assert.match(chats, /const allowEveryone = badge\?\.staff === true && badge\?\.admin === true;/);
    assert.doesNotMatch(chats, /access\?\.role === "owner"/);
    assert.match(chats, /allowEveryone=\{allowEveryone && thread\.kind !== "dm"\}/);
  });
});

describe("R-1 Settings follow what the switches do (rework, 11 Nov)", () => {
  const settings = stripComments(read("components/messages/MessagesSettings.jsx"));
  const group = SETTING_ROWS.find((r) => r.key === "business.team_group_message");
  it("the Group messages words follow its push switch", () => {
    assert.equal(settingHint(group, []), "Push off: only when you’re mentioned");
    assert.equal(settingHint(group, [{ category_key: "business.team_group_message", channel: "push", enabled: true }]), "Push on: every group message");
    assert.equal(settingHint(group, [{ category_key: "business.team_group_message", channel: "push", enabled: false }]), "Push off: only when you’re mentioned");
    const dm = SETTING_ROWS.find((r) => r.key === "business.team_message");
    assert.equal(settingHint(dm, [{ category_key: "business.team_message", channel: "push", enabled: false }]), "Push on by default", "a row without hintOn keeps its words");
  });
  it("the Settings tab shows the words through settingHint, beside each row", () => {
    assert.match(settings, /\{settingHint\(row, prefs\)\}/);
    assert.doesNotMatch(settings, /\{row\.hint\}/);
  });
  it("Direct messages offer no in-app switch; the shared settings read and write business.team_due", () => {
    assert.deepEqual(SETTING_ROWS.find((r) => r.key === "business.team_message").channels, ["push"]);
    const svc = read("services/teamChatService.js");
    assert.match(svc, /TEAM_PREF_CATEGORIES = Object\.freeze\(\[[^\]]*"business\.team_due"/);
  });
});

describe("R-2 the 09:00 due notice is its own group (rework)", () => {
  const due = { id: "d1", kind: "mention", source_kind: "work_due", card_id: null, actor_name: "Mingla", body_excerpt: "1 due today · 1 late: Book the venue", deep_link: "https://admin.usemingla.com/#/work-board?view=today&who=mine", created_at: at(5), read_at: null };
  it("it reads Due and late, sits after mentions and opens Today", () => {
    assert.equal(mentionGroup(due), "late");
    const groups = notificationGroups({ mentions: [...INBOX.mentions, due], alerts: [] }, "you");
    const ids = groups.map((g) => g.id);
    assert.ok(ids.indexOf("late") > ids.indexOf("mention") && ids.indexOf("late") > ids.indexOf("decide"));
    const row = groups.find((g) => g.id === "late").rows[0];
    assert.equal(row.label, "Due and late");
    assert.equal(row.title, "Your cards due and late");
    assert.deepEqual(rowTarget(row), { hash: "#/work-board?view=today&who=mine" });
  });
});

describe("R2-1 this browser's time zone is saved for quiet hours and the 09:00 notice (rework 2)", () => {
  it("reads the IANA zone, or null when the browser cannot tell", () => {
    assert.equal(deviceTimeZone({ DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: " Africa/Lagos " }) }) }), "Africa/Lagos");
    assert.equal(deviceTimeZone({ DateTimeFormat: () => ({ resolvedOptions: () => ({}) }) }), null);
    assert.equal(deviceTimeZone({ DateTimeFormat: () => { throw new Error("no Intl"); } }), null);
    assert.equal(deviceTimeZone(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
  it("saves once per zone per person, again after a change, and retries a failed save", async () => {
    assert.equal(timeZoneToSave(null, "Africa/Lagos"), "Africa/Lagos");
    assert.equal(timeZoneToSave("Africa/Lagos", "Africa/Lagos"), null);
    assert.equal(timeZoneToSave("Africa/Lagos", null), null);
    const sent = [];
    let fail = false;
    const sync = createTimeZoneSync(async (zone) => {
      sent.push(zone);
      if (fail) throw new Error("offline");
      return { staff: true, timezone: zone, changed: true };
    });
    assert.deepEqual(await sync("u1", "Africa/Lagos"), { staff: true, timezone: "Africa/Lagos", changed: true });
    assert.equal(await sync("u1", "Africa/Lagos"), null);
    assert.equal(await sync(null, "Africa/Lagos"), null);
    fail = true;
    await assert.rejects(sync("u1", "Europe/London"), /offline/);
    fail = false;
    await sync("u1", "Europe/London");
    await sync("u2", "Africa/Lagos");
    assert.deepEqual(sent, ["Africa/Lagos", "Europe/London", "Europe/London", "Africa/Lagos"]);
  });
  it("Admin loading for a teammate runs it, and the tab coming back runs it again", () => {
    const button = stripComments(read("components/messages/MessagesButton.jsx"));
    assert.match(button, /useTeamTimeZoneSync\(messages\.enabled \? messages\.userId : null\);/);
    const hook = stripComments(read("hooks/useMessages.js"));
    assert.match(hook, /createTimeZoneSync\(\(zone\) => setMyTimeZone\(zone\)\)/);
    assert.match(hook, /document\.addEventListener\("visibilitychange", onVisible\)/);
    assert.match(hook, /syncTeamTimeZone\(userId, deviceTimeZone\(\)\)\.catch\(/);
    const service = stripComments(read("services/teamChatService.js"));
    assert.match(service, /rpc\("team_set_my_timezone", \{ p_timezone: zone \}\)/);
  });
  it("Settings shows the zone, read-only", () => {
    assert.equal(timeZoneLine("Africa/Lagos"), "Time zone: Africa/Lagos (from this device)");
    assert.equal(timeZoneLine(null), null);
    const settings = stripComments(read("components/messages/MessagesSettings.jsx"));
    assert.match(settings, /useState\(\(\) => timeZoneLine\(deviceTimeZone\(\)\)\)/);
    assert.match(settings, /\{zoneLine && <p data-setting-timezone=""[^>]*>\{zoneLine\}<\/p>\}/);
  });
});

describe("R3-1 Needs your decision follows the server's flag only (Retest 2, P3b)", () => {
  const base = { kind: "work_update", source_kind: "work_card", card_id: CARD_B, actor_name: "Taofeek", created_at: at(3), read_at: null };
  it("a flagged notice is a decision whatever its words", () => {
    assert.equal(mentionGroup({ ...base, id: "x1", decision: true, body_excerpt: "Taofeek changed the ask: Send to Spend" }), "decide");
    const row = notificationGroups({ mentions: [{ ...base, id: "x1", decision: true, body_excerpt: "Taofeek changed the ask" }], alerts: [] }, "you")[0].rows[0];
    assert.equal(row.title, "Taofeek needs your decision");
  });
  it("words ending like a tag are not a decision without the flag (watcher, same ask, tag off)", () => {
    assert.equal(mentionGroup({ ...base, id: "x2", decision: false, body_excerpt: "Taofeek: Approve spend · You spend" }), "status");
    assert.equal(mentionGroup({ ...base, id: "x3", body_excerpt: "Over to you · Needs your OK" }), "status");
    assert.equal(mentionGroup({ ...base, id: "x4", kind: "mention", decision: false, body_excerpt: "Ray, the deck · You send" }), "mention");
  });
  it("the model no longer parses the excerpt for a tag", () => {
    const model = stripComments(read("lib/messagesModel.js"));
    const fn = model.slice(model.indexOf("export function mentionGroup"), model.indexOf("function time("));
    assert.ok(fn.length > 0);
    assert.equal(/body_excerpt|\.test\(/.test(fn), false);
    assert.match(fn, /if \(m\.decision === true\) return "decide";/);
  });
});
