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
