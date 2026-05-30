// ORCH-1014 Finding B regression test — IntelligenceOverviewTab row layout
// has Seed | Refresh | Intelligence columns between Country and Servable.
//
// Source-file inspection (no JSDOM, no JSX loader; same pattern as
// orch1008_adversarial_app_shell.test.js). Asserts the rendered table:
//   - Imports SeedStatusBadge + RefreshStatusBadge
//   - Renders 2 new <th> headers labeled 'Seed status' and 'Refresh status'
//   - Renders <SeedStatusBadge> + <RefreshStatusBadge> with the correct
//     row-data prop wiring (first_seeded_at, last_seeded_at,
//     missing_fields_count, stale_refresh_count)
//   - 'Seed status' column appears BEFORE 'Refresh status' which appears
//     BEFORE 'Servable' (preserved column order per SPEC §3 B.3)
//   - No action button / CTA / anchor in the 2 new cells
//
// Fails-on-revert evidence: if the columns are reverted or the props are
// misnamed, this test FAILS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

const OVERVIEW_TAB_PATH = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "IntelligenceOverviewTab.jsx",
);
const OVERVIEW_SRC = fs.readFileSync(OVERVIEW_TAB_PATH, "utf8");

describe("ORCH-1014 — IntelligenceOverviewTab row layout (Seed | Refresh | Intelligence)", () => {
  it("imports SeedStatusBadge and RefreshStatusBadge", () => {
    assert.ok(
      /import\s+\{\s*SeedStatusBadge\s*\}/.test(OVERVIEW_SRC),
      "IntelligenceOverviewTab must import SeedStatusBadge",
    );
    assert.ok(
      /import\s+\{\s*RefreshStatusBadge\s*\}/.test(OVERVIEW_SRC),
      "IntelligenceOverviewTab must import RefreshStatusBadge",
    );
  });

  it("renders a 'Seed status' <th> header", () => {
    // JSX text nodes can have leading whitespace/newlines around the label
    assert.ok(
      /<th[^>]*>\s*Seed status\s*<\/th>/.test(OVERVIEW_SRC),
      "must render a <th>…Seed status…</th> header cell",
    );
  });

  it("renders a 'Refresh status' <th> header", () => {
    assert.ok(
      /<th[^>]*>\s*Refresh status\s*<\/th>/.test(OVERVIEW_SRC),
      "must render a <th>…Refresh status…</th> header cell",
    );
  });

  it("Seed status column comes BEFORE Refresh status which comes BEFORE Servable", () => {
    const seedIdx = OVERVIEW_SRC.indexOf("Seed status");
    const refreshIdx = OVERVIEW_SRC.indexOf("Refresh status");
    const servableIdx = OVERVIEW_SRC.indexOf(">Servable<");
    assert.ok(seedIdx > 0, "Seed status header must exist");
    assert.ok(refreshIdx > 0, "Refresh status header must exist");
    assert.ok(servableIdx > 0, "Servable header must exist");
    assert.ok(seedIdx < refreshIdx, "Seed must come before Refresh");
    assert.ok(refreshIdx < servableIdx, "Refresh must come before Servable");
  });

  it("renders <SeedStatusBadge> with firstSeededAt + lastSeededAt props wired from row", () => {
    assert.ok(
      /<SeedStatusBadge\b/.test(OVERVIEW_SRC),
      "must instantiate <SeedStatusBadge>",
    );
    assert.ok(
      /firstSeededAt=\{row\.first_seeded_at\}/.test(OVERVIEW_SRC),
      "SeedStatusBadge must wire firstSeededAt={row.first_seeded_at}",
    );
    assert.ok(
      /lastSeededAt=\{row\.last_seeded_at\}/.test(OVERVIEW_SRC),
      "SeedStatusBadge must wire lastSeededAt={row.last_seeded_at}",
    );
  });

  it("renders <RefreshStatusBadge> with missingFieldsCount + staleRefreshCount props wired from row", () => {
    assert.ok(
      /<RefreshStatusBadge\b/.test(OVERVIEW_SRC),
      "must instantiate <RefreshStatusBadge>",
    );
    assert.ok(
      /missingFieldsCount=\{row\.missing_fields_count\b/.test(OVERVIEW_SRC),
      "RefreshStatusBadge must wire missingFieldsCount={row.missing_fields_count}",
    );
    assert.ok(
      /staleRefreshCount=\{row\.stale_refresh_count\b/.test(OVERVIEW_SRC),
      "RefreshStatusBadge must wire staleRefreshCount={row.stale_refresh_count}",
    );
  });

  it("the 2 new badge cells do NOT contain <Button>, <a>, or onClick (read-only contract)", () => {
    // Slice the source between <SeedStatusBadge> and the next </td> closing
    // the Refresh cell. Then assert no Button/a/onClick in that slice.
    const seedStart = OVERVIEW_SRC.indexOf("<SeedStatusBadge");
    assert.ok(seedStart > 0, "SeedStatusBadge must be present");
    // Find end = first occurrence of "Servable" after seedStart (which is
    // the start of the next column's data cell).
    const seedToServable = OVERVIEW_SRC.indexOf(">Servable<");
    // The Servable HEADER appears earlier in the file; we want the *body* cell.
    // Use the closing </td> AFTER the RefreshStatusBadge instantiation as the end.
    const refreshStart = OVERVIEW_SRC.indexOf("<RefreshStatusBadge");
    assert.ok(refreshStart > seedStart, "RefreshStatusBadge must follow SeedStatusBadge");
    // Find the </td> that closes the Refresh badge cell — it's the first
    // </td> after refreshStart.
    const refreshCloseTd = OVERVIEW_SRC.indexOf("</td>", refreshStart);
    assert.ok(refreshCloseTd > refreshStart, "Refresh cell must close with </td>");
    const slice = OVERVIEW_SRC.slice(seedStart, refreshCloseTd);
    assert.ok(!/\bonClick\s*=/.test(slice), "no onClick in Seed/Refresh cells");
    assert.ok(!/<Button\b/.test(slice), "no <Button> in Seed/Refresh cells");
    assert.ok(!/<a\s/.test(slice), "no <a> anchor in Seed/Refresh cells");
  });
});
