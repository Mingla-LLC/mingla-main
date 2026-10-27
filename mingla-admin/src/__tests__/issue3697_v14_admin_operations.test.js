import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  campaignLifecycle,
  filterAndSortCampaigns,
} from "../lib/adCampaignWorkspace.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("#3697 Admin Ads operations workspace", () => {
  const overviewPage = read("src/pages/AdEnginePage.jsx");
  const campaignsPage = read("src/pages/CampaignsPage.jsx");
  const service = read("src/services/adEngineService.js");
  const migration = read(
    "../supabase/migrations/20271102003697_issue_3697_admin_ads_overview.sql",
  );

  it("keeps money currency-separated and labels scheduler state as evidence", () => {
    assert.match(migration, /GROUP BY upper\(s\.currency\)/);
    assert.match(migration, /GROUP BY upper\(c\.currency\)/);
    assert.match(migration, /'scheduler_configuration_proven', false/);
    assert.match(migration, /public\.is_admin_user\(\)/);
    assert.match(service, /ad_admin_operations_overview/);
    // #4130 (Wave 4b): the same two promises, in plain English.
    assert.match(overviewPage, /currencies are never added together/);
    assert.match(overviewPage, /This does not show how the scheduled sync is set up/);
  });

  it("shows real operations, action, provider and delivery evidence", () => {
    // #4130 (Wave 4b): the sections renamed in plain English.
    assert.match(overviewPage, /At a glance/);
    assert.match(overviewPage, /Needs action/);
    assert.match(overviewPage, /Connections and data freshness/);
    assert.match(overviewPage, /missing_spend_campaigns/);
    assert.match(overviewPage, /settlement_attention/);
  });

  it("keeps raw brand UUIDs out of operator labels", () => {
    assert.doesNotMatch(campaignsPage, /Brand \{plan\.brand_id\}/);
    assert.match(
      campaignsPage,
      /brandNames\[plan\.brand_id\] \?\? "Host brand"/,
    );
    assert.match(campaignsPage, /owner_label/);
  });

  it("classifies lifecycle with attention taking precedence", () => {
    const now = new Date("2026-10-17T16:00:00.000Z");
    assert.equal(
      campaignLifecycle(
        {
          status: "ACTIVE",
          currency_status: "aligned",
          status_synced_at: "2026-10-17T15:30:00.000Z",
        },
        now,
      ),
      "live",
    );
    assert.equal(
      campaignLifecycle(
        {
          status: "ACTIVE",
          currency_status: "aligned",
          status_synced_at: "2026-10-17T10:00:00.000Z",
        },
        now,
      ),
      "needs_attention",
    );
    assert.equal(
      campaignLifecycle(
        {
          status: "PAUSED",
          currency_status: "aligned",
          starts_at: "2026-10-18T10:00:00.000Z",
        },
        now,
      ),
      "scheduled",
    );
  });

  it("searches owner labels and filters and sorts campaigns", () => {
    const now = new Date("2026-10-17T16:00:00.000Z");
    const rows = [
      {
        id: "older-live",
        name: "Island launch",
        owner_label: "Femzy",
        owner_kind: "host",
        platform: "meta",
        objective: "traffic",
        status: "ACTIVE",
        currency_status: "aligned",
        status_synced_at: "2026-10-17T15:30:00.000Z",
        created_at: "2026-10-15T00:00:00.000Z",
      },
      {
        id: "newer-paused",
        name: "Wise awareness",
        owner_label: "Wise",
        owner_kind: "host",
        platform: "tiktok",
        objective: "reach",
        status: "PAUSED",
        currency_status: "aligned",
        created_at: "2026-10-16T00:00:00.000Z",
      },
    ];

    assert.deepEqual(
      filterAndSortCampaigns(rows, { query: "femzy" }, now).map(
        (row) => row.id,
      ),
      ["older-live"],
    );
    assert.deepEqual(
      filterAndSortCampaigns(
        rows,
        { lifecycle: "live", platform: "meta", owner: "host" },
        now,
      ).map((row) => row.id),
      ["older-live"],
    );
    assert.deepEqual(
      filterAndSortCampaigns(rows, { sort: "oldest" }, now).map(
        (row) => row.id,
      ),
      ["older-live", "newer-paused"],
    );
  });
});
