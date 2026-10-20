// Issue #3980 synced program, Wave 4 — the owner's opt-in backfills in Admin
// and the words the agent reads:
//   P3-R  "Link roadmap cards to GitHub" on the Roadmap panel: lines become
//         {card_id, issue} by exact title or id, problems are said per line,
//         the panel shows only to the owner, previews first and confirms only
//         ticked ready rows with one request key per confirm
//   P3-B  "Brands without a host card (<n>)" on the Team dashboard: owner
//         only, preview first, link and add-card rows ticked to start, a row
//         whose person card already waits cannot be ticked, confirm with one
//         request key, a result summary
//   P3-0  no migration runs a backfill: the confirms appear in the W4
//         migration only inside their own definitions and comments
//   W     no old state words in the agent's runway_report description
//   L     both panels stay inside a phone screen: two columns only from lg,
//         rows wrap, lists scroll inside their own box
import { assert, assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  brandActionChip,
  brandDefaultPicked,
  brandResultWords,
  brandSelectable,
  logActionWords,
  parseRoadmapLinkLines,
  roadmapBackfillChip,
  roadmapBackfillResultWords,
} from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));
const code = (path: string) => read(path).replace(/^\s*\/\/.*$/gm, "");

const CARDS = [
  { id: "39840000-0000-4000-c100-000000000001", public_title: "Host payouts next day" },
  { id: "39840000-0000-4000-c100-000000000002", public_title: "Calendar for hosts" },
  { id: "39840000-0000-4000-c100-000000000003", public_title: "Group chats" },
  { id: "39840000-0000-4000-c100-000000000004", public_title: "Group chats" },
];

Deno.test("#3980 W4 P3-R: each line becomes a card and an issue, by exact title (any case) or id", () => {
  const r = parseRoadmapLinkLines(
    "Host payouts next day → #3801\n\n  calendar for hosts -> https://github.com/Mingla-LLC/mingla-main/issues/3980  \n39840000-0000-4000-C100-000000000003 => 12",
    CARDS,
  );
  assertEquals(r.problems, []);
  assertEquals(r.links, [
    { card_id: "39840000-0000-4000-c100-000000000001", issue: "#3801", line: 1 },
    { card_id: "39840000-0000-4000-c100-000000000002", issue: "https://github.com/Mingla-LLC/mingla-main/issues/3980", line: 3 },
    { card_id: "39840000-0000-4000-c100-000000000003", issue: "12", line: 4 },
  ]);
});

Deno.test("#3980 W4 P3-R: a line with no arrow, no issue, no such card or two cards of that name says so", () => {
  const r = parseRoadmapLinkLines("Host payouts next day #3801\nCalendar for hosts →\nWaitlists → #9\nGroup chats → #10", CARDS);
  assertEquals(r.links, []);
  assertEquals(r.problems.map((p) => `${p.line}: ${p.words}`), [
    "1: Add the issue after an arrow, like → #123.",
    "2: Add the issue after an arrow, like → #123.",
    "3: No roadmap card is called “Waitlists”.",
    "4: 2 roadmap cards are called “Group chats”. Use the card’s id instead.",
  ]);
});

Deno.test("#3980 W4 P3-R: more than 50 links is one problem before anything is sent", () => {
  const many = Array.from({ length: 51 }, (_, i) => `Host payouts next day → #${i + 1}`).join("\n");
  const r = parseRoadmapLinkLines(many, CARDS);
  assertEquals(r.links.length, 51);
  assertEquals(r.problems, [{ line: 0, text: "", words: "Preview at most 50 links at a time; this has 51." }]);
});

Deno.test("#3980 W4 P3-R: the chips and the result words", () => {
  assertEquals(roadmapBackfillChip("ready"), { label: "Ready", tone: "success" });
  assertEquals(roadmapBackfillChip("already_linked"), { label: "Already linked", tone: "default" });
  assertEquals(roadmapBackfillChip("invalid"), { label: "Can’t link", tone: "error" });
  assertEquals(roadmapBackfillChip("skipped").label, "Skipped");
  assertEquals(roadmapBackfillResultWords({ linked: 1, skipped: 2 }), "1 card linked, 2 skipped.");
  assertEquals(roadmapBackfillResultWords({ linked: 3, skipped: 0, replayed: true }), "3 cards linked, 0 skipped. This was already done; nothing changed again.");
  assertEquals(logActionWords("backfill_confirmed"), "confirmed a backfill");
});

Deno.test("#3980 W4 P3-R: the Roadmap panel shows the disclosure to the owner only, previews first, confirms ticked ready rows once", () => {
  const panel = code("components/community/RoadmapPanel.jsx");
  assertMatch(panel, /const canBackfill = !!opsConfig\.data\?\.settings\?\.can_edit;/);
  // It stays mounted while the cards reload after a confirm, so the result stays on screen.
  assertMatch(panel, /\{canBackfill \? <RoadmapLinksBackfill cards=\{rows\} onLinked=\{\(\) => void load\(\)\} \/> : null\}/);
  assertMatch(panel, /<summary[^>]*>[\s\S]*Link roadmap cards to GitHub/);
  assertMatch(panel, /await previewRoadmapLinks\(links\)/);
  assertMatch(panel, /const links = chosen\.map\(\(r\) => sent\[r\.i\]\);/);
  assertMatch(panel, /await confirmRoadmapLinks\(links, confirmKey\)/);
  assertMatch(panel, /setConfirmKey\(requestKey\("roadmap_links"\)\); setState\("confirm"\);/);
  assertMatch(panel, /Link selected \(\{chosen\.length\}\)/);
  assertMatch(panel, /const can = r\.status === "ready" && typeof onToggle === "function";/);
  const service = read("services/opsService.js");
  assertMatch(service, /supabase\.rpc\("ops_roadmap_links_preview", \{ p_links: links \}\)/);
  assertMatch(service, /supabase\.rpc\("ops_roadmap_links_confirm", \{ p_links: links, p_request_key: requestKey \}\)/);
});

const BRANDS = [
  { brand_id: "b1", name: "Email Brand", action: "link", words: "Link to Host: same email." },
  { brand_id: "b2", name: "New Rooftop", action: "create", words: "Add a host card in Onboarded." },
  { brand_id: "b3", name: "Phone Brand", action: "pick", words: "Several host cards match." },
  { brand_id: "b4", name: "Lounge Returns", action: "reopen", words: "Lost." , open_card: { id: "k4", title: "Reopen Lounge?" } },
  { brand_id: "b5", name: "Near Brand", action: "pick", words: "Only near matches." },
];

Deno.test("#3980 W4 P3-B: link and add-card rows start ticked; a row whose person card already waits cannot be ticked", () => {
  assertEquals(brandDefaultPicked(BRANDS), ["b1", "b2"]);
  assertEquals(BRANDS.map(brandSelectable), [true, true, true, false, true]);
  assertEquals(brandSelectable({ action: "gone" }), false);
  assertEquals(brandActionChip("link"), { label: "Link", tone: "success" });
  assertEquals(brandActionChip("create").label, "Add card");
  assertEquals(brandActionChip("pick").label, "Person picks");
  assertEquals(brandActionChip("reopen").label, "Reopen?");
  assertEquals(brandResultWords({ linked: 1, created: 2, skipped: 4 }), "1 linked, 2 added, 4 left for a person.");
  assertEquals(brandResultWords({ linked: 0, created: 0, skipped: 1, replayed: true }), "0 linked, 0 added, 1 left for a person. This was already done; nothing changed again.");
});

Deno.test("#3980 W4 P3-B: the Team dashboard panel is the owner's, previews first and confirms the ticked brands once", () => {
  const page = code("pages/TeamDashboardPage.jsx");
  assertMatch(page, /function BrandCardsBackfill\(\{ online \}\)/);
  assertMatch(page, /const canEdit = !!settingsRead\.data\?\.can_edit;/);
  assertMatch(page, /if \(!canEdit\) return null;/);
  assertMatch(page, /Brands without a host card\{count !== null \? ` \(\$\{count\}\)` : ""\}/);
  assertMatch(page, /<AutomaticSteps online=\{online\} \/>\s*<BrandCardsBackfill online=\{online\} \/>/);
  assertMatch(page, /await ops\.confirmBrandCards\(chosen, confirmKey\)/);
  assertMatch(page, /setConfirmKey\(requestKey\("brand_cards"\)\); setState\("confirm"\);/);
  assertMatch(page, /Confirm selected \(\{chosen\.length\}\)/);
  assertMatch(page, /const chosen = picked\.filter\(\(id\) => rows\.some\(\(r\) => r\.brand_id === id && brandSelectable\(r\)\)\);/);
  const service = read("services/opsService.js");
  assertMatch(service, /supabase\.rpc\("ops_brand_cards_preview"\)/);
  assertMatch(service, /supabase\.rpc\("ops_brand_cards_confirm", \{ p_brand_ids: brandIds, p_request_key: requestKey \}\)/);
});

Deno.test("#3980 W4 L: both panels fit a phone: two columns only from lg, wrapping rows, lists scroll inside their box", () => {
  const panel = code("components/community/RoadmapPanel.jsx");
  const page = code("pages/TeamDashboardPage.jsx");
  assertMatch(panel, /grid min-w-0 grid-cols-1 gap-4 border-t[^"]* lg:grid-cols-2/);
  assertMatch(page, /grid min-w-0 grid-cols-1 gap-4 px-4 py-3 sm:px-5 lg:grid-cols-\[minmax\(0,2fr\)_minmax\(0,3fr\)\]/);
  for (const [name, src] of [["RoadmapPanel", panel], ["TeamDashboardPage", page]]) {
    assertMatch(src, /max-h-\[4[24]0px\] min-w-0 flex-col divide-y divide-\[var\(--gray-100\)\] overflow-y-auto/, name);
    assertMatch(src, /grid min-w-0 grid-cols-\[auto_minmax\(0,1fr\)\]/, name);
    const at = src.indexOf(name === "RoadmapPanel" ? "export function RoadmapLinksBackfill" : "function BrandCardsBackfill");
    assert(at > 0, name);
    assertNotMatch(src.slice(at, at + 9000), /min-w-\[(?:[5-9]\d\d|\d{4})px\]|overflow-x-auto|bg-white|text-black/, name);
  }
});

Deno.test("#3980 W4 P3-0: no migration runs a backfill; the W4 migration only defines the confirms", () => {
  const dir = new URL("supabase/migrations/", ROOT);
  let found = 0;
  for (const entry of Deno.readDirSync(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = Deno.readTextFileSync(new URL(entry.name, dir)).replace(/--.*$/gm, "");
    // Outside a function body (the text between AS $$ and $$;), nothing may call a confirm or brand auto-link.
    const outside = sql.replace(/AS \$\$[\s\S]*?\$\$;/g, "").replace(/\$kit\$[\s\S]*?\$kit\$/g, "");
    assertNotMatch(outside, /\b(?:SELECT|PERFORM|FROM)\s+(?:\*\s+FROM\s+)?(?:public\.)?(?:ops_roadmap_links_confirm|ops_brand_cards_confirm|ops_brand_autolink(?:_one)?)\s*\(/i, entry.name);
    if (entry.name === "20271202003980_issue_3980_synced_w4_backfills_guide.sql") {
      found++;
      assertMatch(sql, /CREATE FUNCTION public\.ops_roadmap_links_confirm\(p_links jsonb, p_request_key text\)/);
      assertMatch(sql, /CREATE FUNCTION public\.ops_brand_cards_confirm\(p_brand_ids uuid\[\], p_request_key text\)/);
      assertMatch(sql, /RAISE EXCEPTION 'issue 3980 synced W4 self-check: a backfill ran'/);
    }
  }
  assertEquals(found, 1);
});

Deno.test("#3980 W4 W: the agent's runway report uses the four plain states, not the old words", () => {
  const tools = Deno.readTextFileSync(new URL("supabase/functions/_shared/teamAgentWorkTools.ts", ROOT));
  const block = tools.slice(tools.indexOf('name: "runway_report"'), tools.indexOf('name: "runway_report"') + 700);
  assertMatch(block, /Ready to promote[\s\S]*Promote now[\s\S]*Too late for promo[\s\S]*Not live yet/);
  assertNotMatch(tools, /full launch|organic only|\btight\b|\bmissed\b/i);
  assert(block.includes("with the ones at risk first"));
});
