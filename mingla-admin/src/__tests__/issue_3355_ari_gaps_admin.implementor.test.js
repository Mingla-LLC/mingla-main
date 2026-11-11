// Issue #3355 Wave D (D3) — Admin "Ari gaps": counts by type and week, the
// excerpt, a link to the conversation's quality case, "Turn into eval", and
// the weekly digest's Work board card.
//
// The SQL half (admin-only RPCs, one eval per gap, one digest card per week)
// is proven in
// supabase/migrations/__tests__/issue_3355_ari_gap_logging.implementor.pg17.test.sql.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARI_GAP_TYPES,
  digestCardLabel,
  gapTypeLabel,
  gapTypesPresent,
  gapWeekRows,
} from "../lib/ariGaps.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(here, relative), "utf8");

describe("#3355 Wave D — Admin Ari gaps", () => {
  it("builds the weekly table: one row per week, a count per type, newest first", () => {
    const rows = gapWeekRows([
      { week_start: "2026-11-02", gap_type: "refusal", count: 3 },
      { week_start: "2026-11-09", gap_type: "frustration", count: 1 },
      { week_start: "2026-11-09", gap_type: "refusal", count: 2 },
      { week_start: "2026-11-09", gap_type: "refusal", count: "1" },
      null,
      { gap_type: "refusal", count: 9 },
    ]);
    assert.deepEqual(rows, [
      { week_start: "2026-11-09", total: 4, counts: { frustration: 1, refusal: 3 } },
      { week_start: "2026-11-02", total: 3, counts: { refusal: 3 } },
    ]);
    assert.deepEqual(gapTypesPresent(rows), ["refusal", "frustration"]);
    assert.deepEqual(gapWeekRows(undefined), []);
  });

  it("names every gap type in plain words, the same words as the SQL", () => {
    const sql = read("../../../supabase/migrations/20280623073355_issue_3355_ari_gap_logging.sql");
    for (const type of ARI_GAP_TYPES) {
      const label = gapTypeLabel(type);
      assert.notEqual(label, "Other", type);
      assert.ok(sql.includes(`WHEN '${type}' THEN '${label.replace("'", "''")}'`), `SQL label for ${type}`);
    }
    assert.equal(gapTypeLabel("made_up"), "Other");
  });

  it("says what happened to each week's Work board card", () => {
    assert.equal(digestCardLabel({ status: "added", number: 1160, id: "x" }), "Work card 1160");
    assert.equal(digestCardLabel({ status: "kept", number: 1160 }), "Work card 1160");
    assert.equal(digestCardLabel({ status: "kept", id: "x" }), "Work card already on the board");
    assert.equal(digestCardLabel({ status: "skipped_empty" }), "No gaps, no card");
    assert.match(digestCardLabel({ status: "refused", fixes: [] }), /refused/);
    assert.equal(digestCardLabel(null), "Not posted");
  });

  it("the service reads and writes only through the admin RPCs", () => {
    const service = read("../services/ariImprovementService.js");
    assert.match(service, /export async function loadAriGaps\(\{ weeks = 8, type = null, limit = 100 \} = \{\}\)/);
    assert.match(service, /supabase\.rpc\("ari_admin_capability_gap_events", \{\s*p_weeks: weeks,\s*p_type: type,\s*p_limit: limit,\s*\}\)/);
    assert.match(service, /supabase\.rpc\("ari_admin_gap_to_eval", \{\s*p_event_id: eventId,\s*\}\)/);
    assert.ok(!/from\("ari_capability_gap_events"\)/.test(service), "no direct table read");
  });

  it("the Improvement Lab has an Ari gaps tab with the excerpt, case link, eval action and digest", () => {
    const page = read("../pages/AriImprovementLabPage.jsx");
    assert.match(page, /\["gaps", "Ari gaps"\]/);
    assert.match(page, /\{tab === "gaps" && <AriGapsPanel onOpenCase=\{setSelectedCase\} \/>\}/);
    const panel = read("../components/ari/AriGapsPanel.jsx");
    for (const needle of [
      "loadAriGaps({ weeks: 8",
      "turnAriGapIntoEval(event.id)",
      "Turn into eval",
      "Open the quality case",
      "onOpenCase?.({ id: event.quality_case_id })",
      "event.excerpt",
      "Weekly digest",
      "digestCardLabel(digest.card)",
      "eval_scenario_key",
    ]) {
      assert.ok(panel.includes(needle), needle);
    }
    // Every async state is handled: loading, error with retry, empty.
    assert.match(panel, /<LoadError title="Couldn’t load Ari gaps"/);
    assert.match(panel, /No Ari gaps logged in the last 8 weeks\./);
    assert.match(panel, /role="alert"/);
  });
});
