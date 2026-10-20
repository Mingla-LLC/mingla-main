// Issue #3980 synced program, Wave 4 rework — the Admin side of the fixes for
// the first Wave 4 test:
//   P2-3  never more than 100 brands ticked (one confirm's limit): the
//         default ticks stop at 100, a tick past 100 does nothing, "Select
//         none" and "First 100" are on the panel, and the confirm button
//         counts only what was ticked
//   P2-4  opening the Team dashboard reads only the count; the preview comes
//         a page of 50 at a time with "Show more"
//   P1-1  a brand a person already decided about reads "Decided by <person>
//         on <date>", is not ticked by default and cannot be ticked
//   P3-2  a roadmap line splits at its LAST arrow of any kind
//   P3-4  the Feature Guide's "changed since read" check also covers who can
//         use an entry and where it appears
import { assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BRAND_CONFIRM_MAX,
  BRAND_PAGE_SIZE,
  brandDecidedWords,
  brandDefaultPicked,
  brandFirstPicked,
  brandSelectable,
  brandTogglePick,
  parseRoadmapLinkLines,
} from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));
const code = (path: string) => read(path).replace(/^\s*\/\/.*$/gm, "");

const many = (n: number, action = "create") =>
  Array.from({ length: n }, (_, i) => ({ brand_id: `b${i + 1}`, name: `Brand ${i + 1}`, action, words: "w" }));

Deno.test("#3980 W4 rework P2-3: the default ticks stop at 100, the limit one confirm accepts", () => {
  assertEquals(BRAND_CONFIRM_MAX, 100);
  const rows = many(105);
  const picked = brandDefaultPicked(rows);
  assertEquals(picked.length, 100);
  assertEquals(picked[0], "b1");
  assertEquals(picked[99], "b100");
  // Room for only 3 more (after "Show more", with 97 already ticked).
  assertEquals(brandDefaultPicked(rows, 3), ["b1", "b2", "b3"]);
  assertEquals(brandDefaultPicked(rows, 0), []);
});

Deno.test("#3980 W4 rework P2-3: a tick past 100 does nothing; untick and First 100 work", () => {
  const full = many(100).map((r) => r.brand_id);
  assertEquals(brandTogglePick(full, "b101", true), full);
  assertEquals(brandTogglePick(full, "b5", false).length, 99);
  assertEquals(brandTogglePick(["b1"], "b2", true), ["b1", "b2"]);
  assertEquals(brandTogglePick(["b1", "b2"], "b2", true), ["b1", "b2"]);
  const rows = [...many(110, "pick"), { brand_id: "x", name: "X", action: "gone" }];
  assertEquals(brandFirstPicked(rows).length, 100);
  assertEquals(brandFirstPicked(rows).includes("x"), false);
});

Deno.test("#3980 W4 rework P2-3: the panel offers Select none and First 100 and never more than 100 ticked", () => {
  const page = code("pages/TeamDashboardPage.jsx");
  assertMatch(page, /onClick=\{\(\) => setPicked\(\[\]\)\}>Select none<\/Button>/);
  assertMatch(page, /onClick=\{\(\) => setPicked\(brandFirstPicked\(rows\)\)\}>First \{BRAND_CONFIRM_MAX\}<\/Button>/);
  assertMatch(page, /setPicked\(brandDefaultPicked\(answer\?\.rows\)\)/);
  assertMatch(page, /onChange=\{\(e\) => setPicked\(brandTogglePick\(chosen, r\.brand_id, e\.target\.checked\)\)\}/);
  assertMatch(page, /disabled=\{!can \|\| state === "working" \|\| \(!on && atCap\)\}/);
  assertMatch(page, /One confirm takes at most \$\{BRAND_CONFIRM_MAX\}\./);
  // The old unbounded tick is gone.
  assertNotMatch(page, /\[\.\.\.picked, r\.brand_id\]/);
});

Deno.test("#3980 W4 rework P2-4: opening the dashboard reads the count only; the preview is paged with Show more", () => {
  const page = code("pages/TeamDashboardPage.jsx");
  const at = page.indexOf("function BrandCardsBackfill");
  const effect = page.slice(at, page.indexOf("if (!canEdit) return null;", at));
  assertMatch(effect, /ops\.countBrandCards\(\)/);
  assertNotMatch(effect, /previewBrandCards/);
  assertMatch(page, /await ops\.previewBrandCardsPage\(rows\.length, BRAND_PAGE_SIZE\)/);
  assertMatch(page, /Show \$\{[^}]*BRAND_PAGE_SIZE[^}]*\} more/);
  assertEquals(BRAND_PAGE_SIZE, 50);
  const service = read("services/opsService.js");
  assertMatch(service, /supabase\.rpc\("ops_brand_cards_preview_page", \{ p_offset: offset, p_limit: limit \}\)/);
  assertMatch(service, /supabase\.rpc\("ops_brand_cards_count"\)/);
});

Deno.test("#3980 W4 rework P1-1: a decided brand says who decided and when, and cannot be ticked", () => {
  const decided = { brand_id: "d1", name: "Decided", action: "pick", words: "w", decided: { by: "ola@x.test", by_name: "Ola", at: "2026-10-03T10:00:00Z" } };
  assertEquals(brandDecidedWords(decided.decided), "Decided by Ola on 3 Oct 2026");
  assertEquals(brandDecidedWords({ by: "ola@x.test" }), "Decided by ola@x.test");
  assertEquals(brandSelectable(decided), false);
  assertEquals(brandDefaultPicked([{ ...decided, action: "link" }, { brand_id: "n1", action: "create" }]), ["n1"]);
  const page = code("pages/TeamDashboardPage.jsx");
  assertMatch(page, /\{brandDecidedWords\(r\.decided\)\}\. Mingla leaves this brand as it is\./);
});

Deno.test("#3980 W4 rework P3-2: a roadmap line splits at its last arrow, whatever kind", () => {
  const cards = [
    { id: "39850000-0000-4000-c100-000000000001", public_title: "Fast -> faster payouts" },
    { id: "39850000-0000-4000-c100-000000000002", public_title: "Fast" },
  ];
  const r = parseRoadmapLinkLines("Fast -> faster payouts -> #3700\nFast => #12\nFast -> faster payouts → #3701", cards);
  assertEquals(r.problems, []);
  assertEquals(r.links, [
    { card_id: "39850000-0000-4000-c100-000000000001", issue: "#3700", line: 1 },
    { card_id: "39850000-0000-4000-c100-000000000002", issue: "#12", line: 2 },
    { card_id: "39850000-0000-4000-c100-000000000001", issue: "#3701", line: 3 },
  ]);
});

Deno.test("#3980 W4 rework P3-4: the guide's base check hashes who can use an entry and where it appears", () => {
  const sql = Deno.readTextFileSync(new URL("supabase/migrations/20271127003980_issue_3980_synced_w4_backfills_guide.sql", ROOT));
  const pre = sql.slice(sql.indexOf("DO $preflight3980sync$"), sql.indexOf("$preflight3980sync$;"));
  assertMatch(pre, /md5\(concat_ws\('\|', c\.title, c\.outcome_summary, c\.how_to, c\.limitations, c\.support_wording,\s*array_to_json\(c\.who_can_use\)::text, array_to_json\(c\.surfaces\)::text\)\) <> b\.content_md5/);
  assertMatch(pre, /RAISE EXCEPTION 'issue3980_sync_guide_entry_changed_since_read: %'/);
  // Seven base hashes, one per existing entry.
  const base = sql.slice(sql.indexOf("CREATE TEMP TABLE issue_3980_sync_guide_base"), sql.indexOf("AS b(capability_key, content_md5)"));
  assertEquals([...base.matchAll(/\('staff-[a-z-]+', '[0-9a-f]{32}'\)/g)].length, 7);
});
