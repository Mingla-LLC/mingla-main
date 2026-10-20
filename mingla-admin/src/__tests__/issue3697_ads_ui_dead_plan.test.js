// MINGLA-INVARIANT: I-3697-DEAD-PLAN-HAS-ONE-ACTION | issue #3697 | a Mingla plan in creation_failed_terminal shows its recorded provider IDs, why it stopped, the money held and one "Check with <provider>" action, never warnings with no button
/**
 * Issue #3697 — the dead-plan recovery card.
 *
 * Live evidence (2026-10-20): plan 534424c7 (hash 1fde3e33…) sat above live
 * campaigns as "CREATION FAILED TERMINAL" with three warnings and no button,
 * and its $120 hold stayed "held". Its recorded Meta campaign 52609719519827
 * no longer exists.
 *
 * Run: node --test src/__tests__/issue3697_ads_ui_dead_plan.test.js
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import {
  clearedPlanNote,
  deadPlanFacts,
  recordedProviderObjects,
} from "../lib/adBuilder/deadPlan.js";
import { housePlanNextAction } from "../lib/adBuilder/housePlanPath.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = resolve(__dirname, "..", "..");
const SRC = (relativePath) =>
  readFileSync(resolve(__dirname, "..", relativePath), "utf8");

const VERSION_ID = "534424c7-0000-4000-8000-000000000002";
const HASH = "1fde3e33cd9611bda2806c7b3b10b8987c563fe7" + "0".repeat(24);

function deadItem(overrides = {}) {
  return {
    plan: {
      id: "534424c7-9143-474c-87ca-ae16ff051391",
      owner_kind: "mingla",
      state: "creation_failed_terminal",
      updated_at: "2026-10-20T00:23:00.000Z",
    },
    version: {
      id: VERSION_ID,
      plan_hash: HASH,
      canonical_plan: {
        name: "Deserted Island 6.0 — first attempt",
        schedule: { time_zone: "Africa/Lagos" },
        execution_payloads: { meta: {} },
      },
    },
    provider_allocations: [{ platform: "meta", host_currency: "USD", host_budget_cents: 12000 }],
    funding_hold: { state: "held", currency: "USD", amount_cents: 12000 },
    provider_attempts: [{
      command: "create_paused_objects",
      platform: "meta",
      state: "failed_terminal",
      external_ids: { external_campaign_id: "52609719519827" },
      error_detail: "db_persist_failed_platform_rolled_back",
    }],
    provider_failure_events: [{
      platform: "meta",
      action: "create_failed",
      created_at: "2026-10-20T00:23:00.000Z",
      external_ids: {
        external_campaign_id: "52609719519827",
        external_adset_id: null,
        plan_version_id: VERSION_ID,
        plan_hash: HASH,
      },
      provider_response: { db_error: "ad_campaign_plan_binding_mismatch", campaign_rolled_back: true },
    }],
    campaigns: [],
    ...overrides,
  };
}

let vite;
let DeadPlanCard;

before(async () => {
  vite = await createServer({
    root: ADMIN_ROOT,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ DeadPlanCard } = await vite.ssrLoadModule(
    "/src/components/ad-engine/DeadPlanCard.jsx",
  ));
});

after(async () => {
  await vite?.close();
});

const html = (props) => renderToStaticMarkup(createElement(DeadPlanCard, props));

describe("#3697 dead-plan facts come from the recorded rows", () => {
  it("lists the recorded Meta campaign once, with the hold and reason", () => {
    assert.deepEqual(recordedProviderObjects(deadItem()), [
      { platform: "meta", level: "campaign", external_id: "52609719519827" },
    ]);
    const facts = deadPlanFacts(deadItem());
    assert.equal(facts.checkLabel, "Check with Meta");
    assert.equal(facts.holdLabel, "$120 on Mingla's own account · nothing charged");
    assert.equal(facts.reason, "Mingla couldn't save it, so it was rolled back");
    assert.equal(facts.failedAt, "Oct 20, 01:23");
  });

  it("never claims a rollback the audit row does not record", () => {
    const item = deadItem();
    item.provider_failure_events[0].provider_response = {
      db_error: "x",
      campaign_rolled_back: false,
    };
    assert.match(deadPlanFacts(item).reason, /did not finish/);
    assert.equal(
      deadPlanFacts(deadItem({ funding_hold: null })).holdLabel,
      "No money is held",
    );
  });

  it("the next action is a provider check, not a dead end", () => {
    const next = housePlanNextAction({
      state: "creation_failed_terminal",
      platforms: ["meta"],
    });
    assert.equal(next.kind, "reconcile");
    assert.equal(next.canReconcile, true);
    assert.equal(next.canResume, false);
    assert.equal(next.title, "Check with Meta");
  });
});

describe("#3697 the dead-plan card", () => {
  it("shows a plain status, the IDs and one primary button", () => {
    const markup = html({ item: deadItem(), onCheck() {} });
    assert.match(markup, /Didn&#x27;t finish|Didn't finish/);
    assert.match(markup, /52609719519827/);
    assert.match(markup, /Check with Meta/);
    assert.match(markup, /\$120 on Mingla(&#x27;|')s own account · nothing charged/);
    assert.doesNotMatch(markup, /Provider attention required/);
    assert.doesNotMatch(markup, /Inspect the provider evidence/);
    assert.doesNotMatch(markup, /CREATION FAILED TERMINAL/i);
    assert.doesNotMatch(markup, /Delete on Meta/);
  });

  it("lists survivors with Open in Meta links and the typed delete", () => {
    const markup = html({
      item: deadItem(),
      onCheck() {},
      result: {
        verdict: "still_exists",
        accounts: { meta: "act_1234" },
        objects: [{
          platform: "meta",
          level: "campaign",
          external_id: "52609719519827",
          verdict: "exists",
          provider_status: "PAUSED",
        }],
      },
    });
    assert.match(markup, /Still on Meta/);
    assert.match(
      markup,
      /adsmanager\.facebook\.com\/adsmanager\/manage\/campaigns\?act=1234&amp;selected_campaign_ids=52609719519827/,
    );
    assert.match(markup, /Delete on Meta, then clear/);
  });

  it("says nothing changed when the provider could not be checked", () => {
    const markup = html({
      item: deadItem(),
      onCheck() {},
      result: {
        verdict: "unknown",
        objects: [{
          platform: "meta",
          level: "campaign",
          external_id: "52609719519827",
          verdict: "unknown",
          detail: "ad_account_unreadable",
        }],
      },
    });
    assert.match(markup, /Couldn(&#x27;|')t confirm with Meta/);
    assert.match(markup, /Nothing was changed/);
  });
});

describe("#3697 the page clears and notes it", () => {
  it("summarises a cleared plan in one line", () => {
    const note = clearedPlanNote([{
      platform: "meta",
      provider_response: {
        plan_name: "Deserted Island 6.0 (first attempt)",
        platforms: ["meta"],
        hold_currency: "USD",
        hold_amount_cents: 12000,
      },
    }]);
    assert.equal(note.headline, "1 old plan was cleared.");
    assert.deepEqual(note.details, [
      "Deserted Island 6.0 (first attempt) had no live Meta objects — its $120 hold was released.",
    ]);
    assert.equal(clearedPlanNote([]), null);
  });

  it("wires terminal plans to the card, the governed action and the typed delete", () => {
    const page = SRC("pages/CampaignsPage.jsx");
    assert.match(page, /if \(terminal && sealed\) \{[\s\S]{0,80}<DeadPlanCard/);
    assert.match(page, /reconcileAdminAdPlan\(item, options\)/);
    assert.match(page, /confirmPhrase="DELETE ON PROVIDER"/);
    assert.match(page, /recently_cleared/);
    assert.match(page, /clearedPlanNote\(recentlyCleared\)/);
    const service = SRC("services/adEngineService.js");
    assert.match(service, /action: "reconcile_provider_objects"/);
    assert.match(service, /delete_on_provider: true, phrase/);
    const workspace = page.indexOf('title="Campaign workspace"');
    const recovery = page.indexOf('title="Mingla plans that need recovery"');
    assert.ok(workspace > -1 && recovery > workspace, "dead plans no longer sit above live work");
  });
});
