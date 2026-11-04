// Issue #4238 — Admin's page list shows a series' NEXT date and "+N more".
//
// ad_advertisable_pages now returns next_date / dates_remaining /
// last_bookable_at / timezone. Admin maps master_start_at from next_date (the
// first date of a series is often past) and StepDestination appends "+N more"
// for a series. Fails on revert: mapping master_start_at back to row.starts_at
// alone, or dropping the "+N more" suffix, reds this test.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, rel), "utf8");
const service = read("../services/adDestinationsService.js");
const step = read("../components/campaign-builder/StepDestination.jsx");

describe("#4238 Admin destinations show the next date of a series", () => {
  it("maps the next bookable date, not the first one", () => {
    assert.match(service, /master_start_at: row\.next_date \?\? row\.starts_at/);
    assert.match(service, /dates_remaining: row\.dates_remaining \?\? null/);
    assert.match(service, /last_bookable_at: row\.last_bookable_at \?\? null/);
  });

  it("says how many more dates the series has", () => {
    assert.match(step, /row\.dates_remaining > 1/);
    assert.match(step, /\+\$\{row\.dates_remaining - 1\} more/);
  });
});

// #4238 rework (P2 Admin): a dated page gets the Host builder's behaviour —
// the end defaults to the last bookable moment, the inputs are capped there,
// and the server's schedule codes read as a plain sentence.
import {
  adminScheduleBoundError,
  adminScheduleCodeMessage,
  adminScheduleLimit,
  adminScheduleLimitNote,
  isoToZonedLocal,
} from "../lib/adBuilder/scheduleBound.js";
import { zonedLocalToIso } from "../lib/adBuilder/scheduleTimeZone.js";

const page = "../pages/CampaignBuilderPage.jsx";
const budgetStep = read("../components/campaign-builder/StepBudget.jsx");
const builder = read(page);
// 23:30 UTC Sun 6 Dec = 00:30 Mon 7 Dec in Lagos.
const SERIES = { page_type: "event", last_bookable_at: "2026-12-06T23:30:00.000Z", timezone: "Africa/Lagos" };

describe("#4238 Admin builder ends a dated page's campaign by its last bookable moment", () => {
  it("knows the limit in the schedule zone, and its input max never passes it", () => {
    const limit = adminScheduleLimit(SERIES, "Africa/Lagos");
    assert.equal(limit.lastIso, "2026-12-06T23:30:00.000Z");
    assert.equal(limit.maxLocal, "2026-12-07T00:30");
    assert.equal(limit.label, "Mon 7 Dec, 00:30");
    assert.equal(zonedLocalToIso(limit.maxLocal, "Africa/Lagos"), limit.lastIso);
    const ny = adminScheduleLimit(SERIES, "America/New_York");
    assert.equal(ny.maxLocal, "2026-12-06T18:30");
    assert.equal(ny.label, "Sun 6 Dec, 18:30");
    // Seconds round DOWN so the default never lands past the limit.
    const odd = adminScheduleLimit({ last_bookable_at: "2026-12-06T23:30:45.500Z" }, "UTC");
    assert.ok(Date.parse(zonedLocalToIso(odd.maxLocal, "UTC")) <= Date.parse(odd.lastIso));
    assert.equal(adminScheduleLimit({ page_type: "brand" }, "UTC"), null);
    assert.equal(isoToZonedLocal("nope", "UTC"), null);
  });

  it("refuses a missing, later or too-late start in plain words; an end at the limit is fine", () => {
    const limit = adminScheduleLimit(SERIES, "Africa/Lagos");
    assert.match(adminScheduleBoundError({ endsAt: null }, limit), /Set an end on or before Mon 7 Dec, 00:30/);
    assert.match(
      adminScheduleBoundError({ endsAt: "2026-12-06T23:31:00.000Z" }, limit),
      /can run until Mon 7 Dec, 00:30 \(Africa\/Lagos\).*Pick an earlier end/,
    );
    assert.match(
      adminScheduleBoundError({ startsAt: "2026-12-06T23:30:00.000Z", endsAt: "2026-12-06T23:30:00.000Z" }, limit),
      /has to start before/,
    );
    assert.equal(adminScheduleBoundError({ endsAt: limit.lastIso }, limit), null);
    assert.equal(adminScheduleBoundError({ endsAt: null }, null), null);
    assert.match(adminScheduleLimitNote(limit), /Mon 7 Dec, 00:30 \(Africa\/Lagos\)/);
  });

  it("never shows the raw schedule codes", () => {
    const limit = adminScheduleLimit(SERIES, "Africa/Lagos");
    for (const code of ["schedule_end_required", "schedule_ends_after_last_date", "schedule_starts_after_last_date"]) {
      for (const msg of [adminScheduleCodeMessage(code, limit), adminScheduleCodeMessage(`plan_preflight_failed:${code}`, null)]) {
        assert.ok(msg, code);
        assert.doesNotMatch(msg, /schedule_|_required|_after_/);
      }
    }
    assert.equal(adminScheduleCodeMessage("something_else", limit), null);
  });

  it("the builder defaults the end, caps both inputs, blocks the step and maps the codes", () => {
    assert.match(builder, /adminScheduleLimit\(firstDestination, scheduleZone\)/);
    assert.match(builder, /endsAtLocal: scheduleLimit\.maxLocal/);
    assert.match(builder, /if \(scheduleBoundError\) return false;/);
    assert.match(builder, /adminScheduleCodeMessage\(detail, scheduleLimit\) \?\? String\(detail\)/);
    assert.match(builder, /scheduleLimit=\{scheduleLimit\}/);
    const maxes = budgetStep.match(/max=\{scheduleLimit\?\.maxLocal \?\? undefined\}/g) ?? [];
    assert.equal(maxes.length, 2, "start and end inputs are both capped");
    assert.match(budgetStep, /adminScheduleLimitNote\(scheduleLimit\)/);
    assert.match(budgetStep, /\{scheduleBoundError\}/);
  });
});
