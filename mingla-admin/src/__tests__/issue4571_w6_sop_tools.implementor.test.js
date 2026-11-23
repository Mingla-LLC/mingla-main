// Issue #4571 W6 (the SOP tooling) — implementor tests for Admin.
//
//   A-1  Archive and Merge live on the card panel, every write through
//        crmService, the board has Show archived and Duplicate pairs views in
//        the address, and the merge words come from the server's counts
//   N-1  the weekly numbers: rates the server sent as null show "--" (never
//        0%), rows keep the server's order, weeks run Monday to Sunday
//   C-1  the cadence round on a card: "Round 3 of 6 · call done · email to send"
//   S-1  the nightly sweep panel: mode words, action words, owner-only switch
//
// FAILS-ON-REVERT: before W6 lib/sopTools.js, RecordHygiene.jsx and
// HygieneViews.jsx do not exist; showing 0% for a null rate fails N-1.
//
// Run: node --test src/__tests__/issue4571_w6_sop_tools.implementor.test.js (after `npm ci`).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OUTREACH_COLUMNS, SWEEP_ACTION_WORDS, SWEEP_MODES, addDays, cadenceWords, mergeMovedWords, outreachRows,
  pairReasonWords, rateWords, sweepModeWords, weekStart,
} from "../lib/sopTools.js";
import { CRM_VIEWS, buildCrmSearch, parseCrmSearch } from "../lib/crmUrl.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

describe("A-1 archive and merge", () => {
  it("the panel shows the hygiene section", () => {
    const panel = read("components/crm/RecordPanel.jsx");
    assert.match(panel, /<RecordHygiene record=\{record\}/);
  });
  it("every write goes through crmService and the server's functions", () => {
    const svc = read("services/crmService.js");
    for (const fn of ["crm_record_archive", "crm_record_unarchive", "crm_records_archived_list", "crm_record_merge", "crm_record_unmerge", "crm_record_merges_json", "crm_duplicate_pairs"]) {
      assert.ok(svc.includes(`"${fn}"`), `${fn} is called from crmService`);
    }
    const hygiene = read("components/crm/RecordHygiene.jsx");
    assert.doesNotMatch(hygiene, /supabase\.rpc|from\("crm_/);
    assert.match(hygiene, /mergeRecords\(record\.id, pick\.id, newRequestKey\(\)\)/, "the card being viewed is the one kept, with a fresh request key");
  });
  it("Show archived and Duplicate pairs are views in the address", () => {
    assert.deepEqual([...CRM_VIEWS], ["calls", "archived", "duplicates"]);
    assert.equal(parseCrmSearch("view=archived").view, "archived");
    assert.equal(parseCrmSearch("view=duplicates").view, "duplicates");
    assert.equal(parseCrmSearch("view=everything").view, "");
    assert.equal(buildCrmSearch({ view: "duplicates" }), "view=duplicates");
    const page = read("pages/PipelinePage.jsx");
    assert.match(page, /\["duplicates", "Duplicate pairs"\], \["archived", "Show archived"\]/);
    assert.match(page, /state\.view === "archived" \?[\s\S]*<ArchivedList/);
  });
  it("the merge words read the server's counts", () => {
    assert.equal(mergeMovedWords({ activity: 4, identifiers: 1, demos: 1 }), "Moved 4 touches and notes, 1 contact and 1 demo.");
    assert.equal(mergeMovedWords({ links: 1 }), "Moved 1 Work link.");
    assert.equal(mergeMovedWords({}), "Nothing else needed moving.");
  });
  it("pair reasons are plain words", () => {
    assert.equal(pairReasonWords("shared_email"), "Same email");
    assert.equal(pairReasonWords("similar_name"), "Similar name");
    assert.equal(pairReasonWords("anything"), "Possible duplicate");
  });
  it("no typed date field is added", () => {
    for (const f of ["components/crm/RecordHygiene.jsx", "components/crm/HygieneViews.jsx"]) {
      assert.doesNotMatch(read(f), /type="date"/);
    }
  });
});

describe("N-1 weekly numbers", () => {
  it("a null rate shows --, never 0%", () => {
    assert.equal(rateWords(null), "--");
    assert.equal(rateWords(undefined), "--");
    assert.equal(rateWords(0), "0%");
    assert.equal(rateWords(0.425), "43%");
    assert.equal(rateWords(1), "100%");
  });
  it("rows keep the server's order and carry its rates", () => {
    const rows = outreachRows({ reps: [
      { rep: "b@x", name: "Bola", totals: { calls: 0, connect_rate: null, demo_rate: null }, days: [{ day: "2026-11-23", calls: 0, connect_rate: null }] },
      { rep: "a@x", name: "Ade", totals: { calls: 10, connect_rate: 0.4, demo_rate: 0.25 }, days: [] },
    ] });
    assert.deepEqual(rows.map((r) => r.name), ["Bola", "Ade"]);
    assert.equal(rows[0].connectRate, "--");
    assert.equal(rows[0].days[0].connectRate, "--");
    assert.equal(rows[1].connectRate, "40%");
    assert.equal(rows[1].demoRate, "25%");
    assert.deepEqual(outreachRows(null), []);
  });
  it("the columns are the SOP's", () => {
    assert.deepEqual(OUTREACH_COLUMNS.map((c) => c.key), ["calls", "connected", "demos_booked", "emails_sent", "replies"]);
  });
  it("weeks run Monday to Sunday", () => {
    assert.equal(weekStart("2026-11-23"), "2026-11-23");
    assert.equal(weekStart("2026-11-29"), "2026-11-23");
    assert.equal(weekStart("2026-11-30"), "2026-11-30");
    assert.equal(addDays("2026-11-23", 6), "2026-11-29");
    assert.equal(addDays("2026-11-23", -7), "2026-11-16");
  });
});

describe("C-1 cadence round", () => {
  it("an open round says what is done and what is left", () => {
    assert.equal(cadenceWords({ round: 3, has_phone: true, call_done: true, email_done: false, finished: false }), "Round 3 of 6 · call done · email to send");
    assert.equal(cadenceWords({ round: 2, has_phone: false, call_done: false, email_done: false, finished: false }), "Round 2 of 6 · email to send · no phone yet");
  });
  it("a finished cadence and a paused one", () => {
    assert.equal(cadenceWords({ finished: true, has_phone: true, calls: 6, emails: 6 }), "Cadence finished: 6 calls and 6 emails");
    assert.equal(cadenceWords({ finished: true, has_phone: false, emails: 6 }), "Cadence finished: 6 emails, no phone");
    assert.equal(cadenceWords({ counts: false, paused_reason: "Replied: the cadence waits" }), "Replied: the cadence waits");
    assert.equal(cadenceWords(null), "");
  });
});

describe("S-1 sweep words", () => {
  it("modes and actions", () => {
    assert.deepEqual(SWEEP_MODES.map((m) => m.value), ["off", "dry_run", "apply"]);
    assert.equal(sweepModeWords("dry_run"), "Dry run");
    assert.equal(sweepModeWords("nonsense"), "Off");
    assert.equal(SWEEP_ACTION_WORDS.lost, "To Lost");
  });
});
