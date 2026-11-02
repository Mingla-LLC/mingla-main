// Issue #4238 wave 2 — T16b: the Admin audiences panel. Customer lists with a
// state pill per app, the setup tasks (never auto-accepting terms), and no
// buyer-list flag UI.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { adminRoot, withVite } from "../../../__tests__/issue4238_ssr.helper.mjs";

test("T16 setup tasks: Meta terms with the Business Manager link, Google ineligible copy", async () => {
  await withVite(async (vite) => {
    const { audienceSetupTasks, AudienceSetupTasks } = await vite.ssrLoadModule("/src/components/ad-engine/AdAudiencesPanel.jsx");
    const terms = [
      { connection_id: "c-meta", platform: "meta", account_id: "1234567890", state: "unknown", eligibility: "unknown" },
      { connection_id: "c-google", platform: "google", state: "unknown", eligibility: "ineligible", admin_confirmed_at: null },
      { connection_id: "c-snap", platform: "snapchat", state: "unknown", eligibility: "unknown" },
    ];
    const tasks = audienceSetupTasks(terms);
    assert.deepEqual(tasks.map((t) => t.platform), ["meta", "google"]);
    const html = renderToStaticMarkup(React.createElement(AudienceSetupTasks, { terms }));
    assert.match(html, /Meta needs Mingla to accept its Custom Audience terms once\. Open Meta Business Manager and accept them, then press Check again\./);
    assert.match(html, /https:\/\/business\.facebook\.com\/ads\/manage\/customaudiences\/tos\/\?act=1234567890/);
    assert.match(html, /Check again/);
    assert.match(html, /Google only lets accounts with more than \$50,000 lifetime spend target customer lists\. Mingla&#x27;s account can&#x27;t yet\./);
    assert.match(html, /I accepted Google&#x27;s Customer Match terms/);
    assert.equal(audienceSetupTasks([{ connection_id: "c", platform: "meta", state: "accepted" }]).length, 0);
  });
});

test("T16 customer lists table shows one state pill per app with needed counts", async () => {
  await withVite(async (vite) => {
    const { CustomerListsTable, listAudienceStatePill } = await vite.ssrLoadModule("/src/components/ad-engine/AdAudiencesPanel.jsx");
    assert.deepEqual(listAudienceStatePill({ platform: "meta", state: "below_minimum", needed_count: 21 }), {
      label: "Meta: not enough people · 21 more needed",
      variant: "warning",
    });
    assert.equal(listAudienceStatePill({ platform: "google", state: "ineligible" }).label, "Google: not eligible");
    const html = renderToStaticMarkup(
      React.createElement(CustomerListsTable, {
        audiences: [{
          audience_key: "brand:4238aaaa-0000-4000-8000-000000000001:guests",
          owner_kind: "host",
          brand_name: "We Go Again",
          kind: "list",
          display_name: "Your past guests",
          member_count: 246,
          status: "active",
          platforms: [{ platform: "meta", state: "ready" }, { platform: "snapchat", state: "below_minimum", needed_count: 754 }],
        }],
      }),
    );
    assert.match(html, /Your past guests/);
    assert.match(html, /We Go Again/);
    assert.match(html, /Meta: ready/);
    assert.match(html, /Snapchat: not enough people · 754 more needed/);
  });
});

test("T16 the buyer-list flag UI is gone and no code accepts terms", () => {
  const panel = fs.readFileSync(path.join(adminRoot, "src/components/ad-engine/AdAudiencesPanel.jsx"), "utf8");
  assert.doesNotMatch(panel, /buyerListEnabled|buyer_list_sync_enabled|needs privacy approval/);
  assert.match(panel, /New audience/);
  assert.match(panel, /Preview count/);
  const service = fs.readFileSync(path.join(adminRoot, "src/services/adEngineService.js"), "utf8");
  assert.doesNotMatch(service, /action: "accept/);
  assert.match(service, /action: "confirm_terms"/);
});
