// Issue #3697 — the Creative Library "Archived" chip shows archived items and
// Restore brings them back; the library body never spins forever.
// Production (2026-10-19): after an archive the Archived chip (count 1) said
// "Nothing archived" (the optimistic hide outlived the view), and re-selecting
// a chip cleared the rows without a request ("Loading creatives…" forever).
// MINGLA-INVARIANT: I-ADMIN-LIBRARY-LOAD-ENDS | issue #3697 | every Creative Library load ends in content, empty or an error, and each chip asks the server for its own rows
// Invariant I-CREATIVE-ARCHIVE-NOT-DELETE (declared in supabase/migrations/__tests__/issue_3697_creative_library_lifecycle.implementor.pg17.test.sql)
//
// FAILS ON REVERT: bring back `setRows(null)` on a chip click, drop the
// selected-chip guard, keep `hidden` across a fresh server answer, drop the
// load deadline, or ask the server for "active" under Archived.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LIBRARY_TIMEOUT_MESSAGE,
  libraryBodyState,
  libraryRequest,
  libraryViewKey,
  loadWithDeadline,
  visibleLibraryRows,
} from "../../components/ad-engine/creativeLibraryModel.js";

const page = readFileSync(new URL("../AdEnginePage.jsx", import.meta.url), "utf8");
const panel = page.slice(page.indexOf("function CreativeLibraryPanel()"), page.indexOf("export function AdEnginePage()"));

test("#3697 the Archived chip asks the server for archived items", () => {
  assert.deepEqual(libraryRequest("archived", "", null), { status: "archived", q: undefined, before: undefined });
  assert.deepEqual(libraryRequest("all", "lantern", null), { status: "active", q: "lantern", before: undefined });
  assert.equal(libraryRequest("unknown").status, "active");
  // The panel builds its request from the chip, through the model.
  assert.match(panel, /listAdCreatives\(libraryRequest\(filter\.id, debouncedQuery, before\)\)/);
});

test("#3697 an archived item hidden in All shows under Archived once that view loads", () => {
  // Archive in All hides id c1 optimistically …
  const hidden = new Set(["c1"]);
  const archivedRows = [{ id: "c1", status: "archived" }];
  assert.equal(visibleLibraryRows(archivedRows, hidden).length, 0, "the stale hide is what read 'Nothing archived'");
  // … and the panel clears it on a chip change and on every fresh answer.
  assert.equal(visibleLibraryRows(archivedRows, new Set()).length, 1);
  assert.match(panel, /setFilterId\(item\.id\);\s*setHidden\(new Set\(\)\);/);
  assert.match(panel, /if \(!append\) \{\s*setRowsKey\(key\);\s*setPending\(data\?\.pending \?\? \[\]\);[\s\S]{0,120}setHidden\(new Set\(\)\);/);
});

test("#3697 Restore un-archives on the server, says so, and reloads", () => {
  const restore = panel.slice(panel.indexOf("const restore = async"), panel.indexOf("const confirmDelete"));
  assert.match(restore, /await unarchiveCreative\(creative\.id\)/);
  assert.match(restore, /title: "Restored\. It's available for new campaigns again\."/);
  assert.match(restore, /void load\(\);/);
});

test("#3697 the body state always ends: loading only until the selected view answers", () => {
  const all = libraryViewKey("all", "");
  const archived = libraryViewKey("archived", "");
  assert.equal(libraryBodyState({ error: null, rowsKey: null, viewKey: all, empty: true }), "loading");
  assert.equal(libraryBodyState({ error: null, rowsKey: all, viewKey: archived, empty: false }), "loading");
  assert.equal(libraryBodyState({ error: null, rowsKey: archived, viewKey: archived, empty: true }), "empty");
  assert.equal(libraryBodyState({ error: null, rowsKey: archived, viewKey: archived, empty: false }), "content");
  assert.equal(libraryBodyState({ error: "x", rowsKey: null, viewKey: archived, empty: true }), "error");
  // Re-selecting the current chip is a no-op; nothing clears the rows by hand.
  assert.match(panel, /if \(selected\) return;/);
  assert.doesNotMatch(panel, /setRows\(null\)/);
  assert.doesNotMatch(panel, /rows === null \?/);
  assert.match(panel, /bodyState === "loading" \?/);
});

test("#3697 a load that never answers ends in a timeout error", async () => {
  const pendingTimers = [];
  const timers = {
    setTimeout: (fn, ms) => {
      pendingTimers.push({ fn, ms });
      return pendingTimers.length;
    },
    clearTimeout: () => {},
  };
  const result = loadWithDeadline(() => new Promise(() => {}), 20000, timers);
  assert.equal(pendingTimers[0].ms, 20000);
  pendingTimers[0].fn();
  const { data, error } = await result;
  assert.equal(data, null);
  assert.equal(error.timeout, true);
  assert.equal(error.message, LIBRARY_TIMEOUT_MESSAGE);
  assert.match(panel, /await loadWithDeadline\(\(\) =>/);
});

test("#3697 a thrown load becomes an error, and an answer passes through", async () => {
  const thrown = await loadWithDeadline(() => {
    throw new Error("Failed to fetch");
  }, 1000);
  assert.equal(thrown.error.message, "Failed to fetch");
  const ok = await loadWithDeadline(async () => ({ data: { creatives: [] }, error: null }), 1000);
  assert.deepEqual(ok, { data: { creatives: [] }, error: null });
});
