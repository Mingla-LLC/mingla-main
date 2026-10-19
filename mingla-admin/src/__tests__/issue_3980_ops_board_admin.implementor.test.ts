// Issue #3980 Wave 1 — the Work board, Agent log and To review in Mingla Admin:
// the menu, who may open them, the one caller of ops_* functions, the pure
// words in lib/opsModel.js, and the layout and state rules of the new screens.
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { NAV_GROUPS } from "../lib/constants.js";
import { PAGE_AREA_OVERRIDES, canOpenPage } from "../lib/access.js";
import {
  agentName,
  agentPromptFor,
  buildWorkSearch,
  groupCards,
  logChip,
  opsErrorWords,
  parseLogSearch,
  parseReviewSearch,
  parseWorkSearch,
  runwayLabel,
  sprintLabel,
} from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const read = (relative: string) => Deno.readTextFileSync(new URL(relative, SRC));

function walk(dir: URL, out: string[] = []): string[] {
  for (const entry of Deno.readDirSync(dir)) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const next = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) walk(next, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(next.pathname);
  }
  return out;
}

const growth = { email: "g@test.local", role: "growth", status: "active", areas: ["role_home", "crm", "beta_leads"] };
const partner = { email: "p@test.local", role: "partner", status: "active", areas: ["role_home", "crm", "beta_leads"] };
const nocrm = { email: "x@test.local", role: "growth", status: "active", areas: ["role_home"] };

Deno.test("#3980 the Pipeline menu: To review, Work board, Agent log, Calendar, in order", () => {
  const pipeline = NAV_GROUPS.find((g: { label: string | null }) => g.label === "Pipeline");
  assertEquals(
    pipeline.items.map((i: { id: string; label: string; icon: string }) => `${i.id}:${i.label}:${i.icon}`),
    [
      "hosts:Hosts:Handshake",
      "creators:Creators:Sparkles",
      "drafts:To review:FileText",
      "work-board:Work board:SquareKanban",
      "agent-log:Agent log:ScrollText",
      "beta-leads:Beta Leads:Inbox",
      "tool-leads:Tool Leads:Wrench",
      "content-calendar:Calendar:CalendarClock",
      "team-dashboard:Team dashboard:BarChart3",
    ],
  );
});

Deno.test("#3980 every pipeline teammate opens the Work board and Agent log; nobody else", () => {
  assertEquals(PAGE_AREA_OVERRIDES["work-board"], "crm");
  assertEquals(PAGE_AREA_OVERRIDES["agent-log"], "crm");
  for (const a of [growth, partner]) {
    assert(canOpenPage(a, "work-board"), a.role);
    assert(canOpenPage(a, "agent-log"), a.role);
    assert(canOpenPage(a, "drafts"), a.role);
    assert(!canOpenPage(a, "team-dashboard"), a.role);
  }
  assert(!canOpenPage(nocrm, "work-board"));
  assert(!canOpenPage(nocrm, "agent-log"));
});

Deno.test("#3980 the pages are registered and their icons exist in the one icon map", () => {
  const app = read("App.jsx");
  assertMatch(app, /"work-board": WorkBoardPage,/);
  assertMatch(app, /"agent-log": AgentLogPage,/);
  const sidebar = read("components/layout/Sidebar.jsx");
  const map = sidebar.slice(sidebar.indexOf("const ICON_MAP = {"), sidebar.indexOf("};", sidebar.indexOf("const ICON_MAP = {")));
  assertMatch(map, /\bSquareKanban,/);
  assertMatch(map, /\bScrollText,/);
  assertMatch(sidebar, /item\.id === "drafts" \? reviewCount\.total/);
});

Deno.test("#3980 opsService.js is the only browser caller of ops_ functions", () => {
  const callers = walk(SRC).filter((file) => /\.rpc\(\s*["']ops_/.test(Deno.readTextFileSync(file)));
  assertEquals(callers.map((f) => f.slice(f.indexOf("/src/") + 5)), ["services/opsService.js"]);
});

Deno.test("#3980 runway words for every band", () => {
  assertEquals(runwayLabel({ band: "full", lead_days: 30 }), "Full launch · live 30 days ahead");
  assertEquals(runwayLabel({ band: "tight", lead_days: 24 }), "Tight · live 24 days ahead");
  assertEquals(runwayLabel({ band: "organic", lead_days: 10 }), "Organic only · live 10 days ahead");
  assertEquals(runwayLabel({ band: "not_live", go_live_by: "2026-11-02" }), "Not live yet · go live by 2 Nov");
  assertEquals(runwayLabel({ band: "missed" }), "Missed go-live: organic only");
  assertEquals(runwayLabel(null), "No date yet");
});

Deno.test("#3980 names, prompts, sprints and the board's address", () => {
  assertEquals(agentName("Seth", "claude"), "Seth's Claude");
  assertEquals(agentName("Seth", "codex"), "Seth's Codex");
  assertEquals(agentName("Seth", null), "Seth");
  assertEquals(
    agentPromptFor({ title: "Collect the menu", number: 12 }),
    'Do card "Collect the menu" (Card 12) in Mingla. Check the agent log first, claim it, follow the instructions, and close it with proof or push back with a reason.',
  );
  assertEquals(sprintLabel("2026-10-19"), "Sprint 19 to 25 Oct");
  assertEquals(sprintLabel("2026-10-26"), "Sprint 26 Oct to 1 Nov");
  const id = "0f0e0d0c-0b0a-4908-8706-050403020100";
  const parsed = parseWorkSearch(`card=${id}&group=person&who=mine&week=2026-10-21&add=1`);
  assertEquals(parsed, { card: id, cardInvalid: false, group: "person", who: "mine", week: "2026-10-19", add: true });
  assertEquals(buildWorkSearch(parsed), `card=${id}&group=person&who=mine&week=2026-10-19&add=1`);
  assertEquals(parseWorkSearch("card=nope&group=nope&who=nope").cardInvalid, true);
  assertEquals(parseWorkSearch("group=nope").group, "status");
  assertEquals(parseLogSearch("who=mine").who, "mine");
  assertEquals(parseLogSearch("who=x").who, "all");
  assertEquals(parseReviewSearch("tab=spend").tab, "spend");
  assertEquals(parseReviewSearch("").tab, "messages");
});

Deno.test("#3980 refusals in plain words, including the server's list of fixes", () => {
  assertEquals(opsErrorWords({ token: "network" }), "You’re offline. Reconnect and try again.");
  assertEquals(opsErrorWords({ token: "stale_write", message: "x" }), "This card changed. Showing the latest.");
  assertEquals(opsErrorWords({ token: "undo_expired" }), "That change can no longer be undone.");
  assertEquals(
    opsErrorWords({ token: "invalid_card", fixes: [{ field: "title", message: "Title is missing." }, { field: "owners", message: "No owner." }] }),
    "Title is missing. No owner.",
  );
  assertEquals(
    opsErrorWords({ token: "claimed", message: "Seth's Claude is working on this host since 10:00 UTC." }),
    "Seth's Claude is working on this host since 10:00 UTC.",
  );
  assertEquals(opsErrorWords({ token: "forbidden" }), "Your account can’t do this.");
  assertEquals(opsErrorWords({ token: "unknown" }), "That didn’t work. Try again, and if it keeps happening tell an admin.");
});

Deno.test("#3980 log chips and board groups", () => {
  assertEquals(logChip({ outcome: "stopped", action: "draft_stopped" }), { label: "Stopped", tone: "error" });
  assertEquals(logChip({ outcome: "ok", action: "closed" }), { label: "Closed", tone: "success" });
  assertEquals(logChip({ outcome: "ok", action: "claimed" }), { label: "Working", tone: "default" });
  assertEquals(logChip({ outcome: "ok", action: "card_added" }), { label: "Added", tone: "brand" });
  const cards = [
    { id: "a", status: "todo", owners: [{ email: "x", name: "Xi" }], anchor: null },
    { id: "b", status: "person", owners: [{ email: "x", name: "Xi" }, { email: "y", name: "Yo" }], anchor: { kind: "event", id: "e", title: "Night", start_on: "2026-11-02" } },
  ];
  assertEquals(groupCards(cards, "status").map((g: { title: string; cards: unknown[] }) => `${g.title}:${g.cards.length}`), ["To do:1", "Doing:0", "Needs a person:1", "Done this week:0"]);
  assertEquals(groupCards(cards, "person").map((g: { title: string; cards: unknown[] }) => `${g.title}:${g.cards.length}`), ["Xi:2", "Yo:1"]);
  assertEquals(groupCards(cards, "event").map((g: { title: string }) => g.title), ["Night · 2 Nov", "No event"]);
});

Deno.test("#3980 the new screens: two columns, Undo, offline words, tokens only, no overlays", () => {
  const board = read("pages/WorkBoardPage.jsx");
  const log = read("pages/AgentLogPage.jsx");
  const drafts = read("pages/DraftsPage.jsx");
  const two = read("components/ops/TwoColumn.jsx");
  assertMatch(two, /grid min-w-0 grid-cols-1 gap-4 min-\[1180px\]:grid-cols-\[minmax\(0,1fr\)_minmax\(360px,440px\)\]/);
  assertMatch(two, /min-\[1180px\]:sticky min-\[1180px\]:top-4/);
  for (const page of [board, log]) assertMatch(page, /<TwoColumn/);
  assertMatch(read("components/ops/ReviewQueue.jsx"), /<TwoColumn/);
  assertMatch(board, /You’re offline\. You can read the board; adding and changes need a connection\./);
  assertMatch(board, /title="Work board"/);
  assertMatch(log, /title="Agent log"/);
  assertMatch(drafts, /title="To review"/);
  assertMatch(drafts, /\{ value: "spend", label: "Spend or publish" \}/);
  const detail = read("components/ops/WorkDetail.jsx");
  assertMatch(detail, /label: "Undo"/);
  assertMatch(detail, /This card changed\. Showing the latest\./);
  assertMatch(detail, /A card needs at least one owner\./);
  assertMatch(detail, /Prompt copied\./);
  const opsFiles = [...Deno.readDirSync(new URL("components/ops/", SRC))].map((e) => read(`components/ops/${e.name}`));
  for (const source of [board, log, ...opsFiles]) {
    assertNotMatch(source, /bg-white|text-black/);
    assertNotMatch(source, /from "\.\.\/(?:\.\.\/)?(?:components\/)?ui\/(?:Modal|Drawer)"|from "\.\/(?:Modal|Drawer)"/);
    assertNotMatch(source, /#[0-9a-fA-F]{6}\b/);
  }
});

Deno.test("#3980 host and creator card notices carry none of the banned words", () => {
  const notice = read("components/crm/RecentTouchNotice.jsx");
  for (const word of ["Drafts to send", "Draft, not sent", "@mention", "mention", "will get an email", "Getting started"]) {
    assert(!notice.includes(word), word);
  }
  assertMatch(notice, /Allow one more message/);
  assertMatch(notice, /Allowed for 24 hours\./);
  assertMatch(read("components/crm/RecordDrawer.jsx"), /<RecentTouchNotice /);
});
