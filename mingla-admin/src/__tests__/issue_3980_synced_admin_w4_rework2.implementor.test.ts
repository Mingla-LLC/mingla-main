// Issue #3980 synced program, Wave 4 rework 2 — the Admin side of the fixes
// for the Wave 4 rework retest:
//   P2-A  "Show more" reads right after the last brand already shown (the
//         page before's page.next), never by how many rows are shown, so
//         brands that gain a host card between pages cannot make a later
//         brand be skipped, and none is shown twice; the status line says
//         how many are left while more come
//   P2-C  a brand Mingla was working on at the same moment is "busy, try
//         again", never counted as left for a person; a brand that already
//         had a host card is said apart too
import { assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BRAND_PAGE_SIZE,
  brandMergePage,
  brandMoreCount,
  brandNextCursor,
  brandResultWords,
  brandShownWords,
} from "../lib/opsModel.js";

const SRC = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, SRC));
const code = (path: string) => read(path).replace(/^\s*\/\/.*$/gm, "");

type Brand = { id: string; created_at: string; carded: boolean };
type Row = { brand_id: string; name: string; action: string; words: string };
type Answer = { rows: Row[]; page: { more: boolean; left: number; next?: { created_at: string; id: string } } };

// A stand-in for the server's keyset page (ops_brand_cards_page): brands
// without a card, newest first by created_at then id, after the cursor.
function serverPage(all: Brand[], after: { created_at: string; id: string } | null, limit: number): Answer {
  const order = all.filter((b) => !b.carded)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rest = after
    ? order.filter((b) => b.created_at < after.created_at || (b.created_at === after.created_at && b.id > after.id))
    : order;
  const page = rest.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((b) => ({ brand_id: b.id, name: b.id, action: "create", words: "w" })),
    page: { more: rest.length > page.length, left: rest.length - page.length, next: last ? { created_at: last.created_at, id: last.id } : undefined },
  };
}

const brands = (n: number): Brand[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `b${String(i + 1).padStart(3, "0")}`,
    // brand 61 shares brand 60's created_at (a tie the cursor orders by id)
    created_at: new Date(Date.UTC(2026, 9, 1, 12, i + 1 === 61 ? 60 : i + 1)).toISOString(),
    carded: false,
  }));

Deno.test("#3980 W4 rework 2 P2-A: Show more after shown brands gain a card skips nothing and repeats nothing", () => {
  const all = brands(89);
  let preview = serverPage(all, null, BRAND_PAGE_SIZE) as Answer & { rows: Row[] };
  assertEquals(preview.rows.length, 50);
  // Meanwhile the cron gives three brands already shown a host card.
  for (const id of ["b089", "b088", "b087"]) all.find((b) => b.id === id)!.carded = true;
  for (let i = 0; i < 5; i++) {
    const next = brandNextCursor(preview);
    if (!preview.page.more || !next) break;
    preview = brandMergePage(preview, serverPage(all, next, BRAND_PAGE_SIZE)).preview as Answer;
  }
  const shown = new Set(preview.rows.map((r) => r.brand_id));
  const stillWithout = all.filter((b) => !b.carded).map((b) => b.id);
  assertEquals(stillWithout.filter((id) => !shown.has(id)), []);
  assertEquals(preview.rows.length, shown.size);
  assertEquals(preview.rows.length, 89);
  assertEquals(preview.page.more, false);
});

Deno.test("#3980 W4 rework 2 P2-A: the cursor is the page's next; merging keeps the newest paging and adds only new rows", () => {
  assertEquals(brandNextCursor({ page: { next: { created_at: "2026-10-01T12:00:00.123456+00:00", id: "x" } } }),
    { created_at: "2026-10-01T12:00:00.123456+00:00", id: "x" });
  assertEquals(brandNextCursor({ page: { more: true } }), null);
  assertEquals(brandNextCursor(null), null);
  const before = { rows: [{ brand_id: "a" }, { brand_id: "b" }], page: { more: true, left: 3, next: { created_at: "t1", id: "b" } } };
  const answer = { rows: [{ brand_id: "b" }, { brand_id: "c" }], page: { more: false, left: 0, next: { created_at: "t0", id: "c" } }, totals: { total: 9 } };
  const { preview, added } = brandMergePage(before, answer);
  assertEquals(preview.rows.map((r: { brand_id: string }) => r.brand_id), ["a", "b", "c"]);
  assertEquals(added.map((r: { brand_id: string }) => r.brand_id), ["c"]);
  assertEquals(preview.page, answer.page);
});

Deno.test("#3980 W4 rework 2 P2-A: the status line and the button count what is left, from the server", () => {
  assertEquals(brandShownWords({ chosen: 82, shown: 86, more: true, left: 3 }), "82 of 86 shown chosen. 3 more to show.");
  assertEquals(brandShownWords({ chosen: 86, shown: 89, more: false, left: 0 }), "86 of 89 shown chosen.");
  assertEquals(brandShownWords({ chosen: 1, shown: 2, more: true }), "1 of 2 shown chosen. More to show.");
  assertEquals(brandMoreCount({ page: { left: 12 } }, BRAND_PAGE_SIZE), 12);
  assertEquals(brandMoreCount({ page: { left: 400 } }, BRAND_PAGE_SIZE), 50);
  assertEquals(brandMoreCount({ page: {} }, BRAND_PAGE_SIZE), 50);
});

Deno.test("#3980 W4 rework 2 P2-A: the panel asks for the page after the last brand shown, never an offset", () => {
  const page = code("pages/TeamDashboardPage.jsx");
  const at = page.indexOf("const loadMore = async");
  const loadMore = page.slice(at, page.indexOf("const confirm = async", at));
  assertMatch(loadMore, /await ops\.previewBrandCardsPage\(next, BRAND_PAGE_SIZE\)/);
  assertNotMatch(loadMore, /previewBrandCardsPage\(rows\.length/);
  assertMatch(loadMore, /brandMergePage\(preview, answer\)/);
  assertMatch(page, /const next = brandNextCursor\(preview\);/);
  assertMatch(page, /const more = !!preview\?\.page\?\.more && !!next;/);
  assertMatch(page, /brandShownWords\(\{ chosen: chosen\.length, shown: rows\.length, more, left: preview\?\.page\?\.left \}\)/);
  const service = read("services/opsService.js");
  assertMatch(service, /export const previewBrandCardsPage = \(after, limit\) =>/);
  assertMatch(service, /p_after_created_at: after\?\.created_at \?\? null, p_after_id: after\?\.id \?\? null, p_limit: limit/);
  assertNotMatch(service, /p_offset/);
});

Deno.test("#3980 W4 rework 2 P2-C: busy brands are 'try again', and already-carded ones are said apart from those left for a person", () => {
  assertEquals(brandResultWords({ linked: 0, created: 12, skipped: 0, busy: 13 }),
    "0 linked, 12 added, 0 left for a person. 13 busy: Mingla was working on them at the same moment, so try again.");
  assertEquals(brandResultWords({ linked: 0, created: 12, skipped: 13, unchanged: 13 }),
    "0 linked, 12 added, 0 left for a person. 13 already had a host card or were left as they were.");
  assertEquals(brandResultWords({ linked: 1, created: 0, skipped: 3, unchanged: 1, busy: 1 }),
    "1 linked, 0 added, 2 left for a person. 1 already had a host card or was left as it was. 1 busy: Mingla was working on it at the same moment, so try again.");
  // Older answers without the new counts read as before.
  assertEquals(brandResultWords({ linked: 1, created: 2, skipped: 4 }), "1 linked, 2 added, 4 left for a person.");
});
