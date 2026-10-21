/** toward #3697 approved fixes 1–4 — one regression for every checklist row. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { goalById } from "../lib/adBuilder/goals.js";
import { resolveGoalForPayload } from "../lib/adBuilder/objectiveResolver.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("#3697 1.1 Meta traffic defaults to landing-page views, never link clicks", () => {
  assert.deepEqual(goalById("traffic").platforms.meta, {
    objective: "OUTCOME_TRAFFIC",
    optimization_goal: "LANDING_PAGE_VIEWS",
  });
});

test("#3697 1.2 Snap uses pixel-backed page views or SWIPES with honest copy", () => {
  assert.equal(resolveGoalForPayload(["traffic"]).platforms.snapchat.optimization_goal, "SWIPES");
  assert.equal(
    resolveGoalForPayload(["traffic"], { snapPixelInstalled: true }).platforms.snapchat.optimization_goal,
    "TRAFFIC_LANDING_PAGE_VIEW",
  );
  assert.match(read("mingla-admin/src/components/campaign-builder/StepGoal.jsx"), /Snap pixel not detected/);
});

test("#3697 1.3 Meta constrains publisher platforms to Facebook and Instagram", () => {
  assert.match(read("supabase/functions/admin-ad-create-campaign/index.ts"), /publisher_platforms:\s*\["facebook", "instagram"\]/);
});

test("#3697 1.4 Meta refuses create without a linked Instagram account", () => {
  const source = read("supabase/functions/admin-ad-create-campaign/index.ts");
  assert.match(source, /error: "instagram_account_required"/);
  assert.match(source, /Connect an Instagram account/);
});

test("#3697 2.1 Meta Sales carries PURCHASE promoted_object", () => {
  const source = read("supabase/functions/admin-ad-create-campaign/index.ts");
  assert.match(source, /promotedObject:[\s\S]*?pixel_id: metaDatasetId[\s\S]*?custom_event_type: "PURCHASE"/);
});

test("#3697 2.2 Sales goal is Meta-only and pixel-signal disabled", () => {
  const sales = goalById("conversions");
  assert.equal(sales.label, "Sales (ticket purchases)");
  assert.deepEqual(sales.platforms.meta, {
    objective: "OUTCOME_SALES",
    optimization_goal: "OFFSITE_CONVERSIONS",
  });
  assert.equal(sales.requiresMetaPixelSignal, true);
  assert.match(read("mingla-admin/src/components/campaign-builder/StepGoal.jsx"), /disabled=\{disabled\}/);
});

test("#3697 2.3 Snap pixel flag comes only from live domain stats", () => {
  const connect = read("supabase/functions/admin-ad-connect/index.ts");
  assert.match(connect, /pixel_installed: pixelSignal\.hasSignal/);
  assert.doesNotMatch(connect, /pixel_installed: priorExtra\.pixel_installed/);
});

test("#3697 3.1 checkout sessions persist browser match data and request context", () => {
  const migration = read("supabase/migrations/20271205003697_issue_3697_real_visitor_ad_learning.sql");
  for (const column of ["fbp", "fbc", "scid", "client_ip", "client_user_agent"]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\s`));
  }
});

test("#3697 3.2 server events send external_id, sc_cookie1 and click id", () => {
  assert.match(read("supabase/functions/_shared/metaCapi.ts"), /external_id: input\.externalId/);
  const snap = read("supabase/functions/_shared/snapCapi.ts");
  assert.match(snap, /sc_cookie1: input\.scCookie1/);
  assert.match(snap, /sc_click_id: input\.externalClickId/);
});

test("#3697 3.3 InitiateCheckout browser and server share checkout session id", () => {
  const web = read("mingla-business/src/analytics/webAnalytics.web.ts");
  const server = read("supabase/functions/_shared/adConversionFire.ts");
  assert.match(web, /"InitiateCheckout"[\s\S]*?eventID: eventId/);
  assert.match(web, /"START_CHECKOUT"[\s\S]*?client_dedup_id: eventId/);
  assert.match(server, /eventId: checkoutSessionId/);
  assert.match(server, /"InitiateCheckout" : "START_CHECKOUT"/);
});

test("#3697 3.4 pending-consent ad visitors remain first-party-only", () => {
  const conversion = read("supabase/functions/_shared/adConversionFire.ts");
  assert.match(conversion, /consent_pending_retryable/);
  assert.match(conversion, /pending: do NOT flip \*_status off pending/);
});

test("#3697 4.1 click ids live in localStorage for exactly seven days", () => {
  const web = read("mingla-business/src/analytics/webAnalytics.web.ts");
  assert.match(web, /AD_CLICK_TTL_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(web, /window\.localStorage\.setItem/);
  assert.match(web, /stored\.expiresAt <= Date\.now\(\)/);
});

test("#3697 4.2 Snap landing macros are complete", () => {
  const create = read("supabase/functions/admin-ad-create-campaign/index.ts");
  assert.match(create, /utm_source=snapchat&utm_medium=paid_social&utm_campaign=\{\{campaign\.id\}\}&ad_squad_id=\{\{adSquad\.id\}\}&ad_id=\{\{ad\.id\}\}&mc_id=\{\{campaign\.id\}\}/);
});

test("#3697 4.3 Meta URL tags include ad-set and ad ids", () => {
  const meta = read("supabase/functions/_shared/meta.ts");
  assert.match(meta, /adset_id=\{\{adset\.id\}\}&ad_id=\{\{ad\.id\}\}/);
});

test("#3697 4.4 touches persist ad-set and ad ids", () => {
  const capture = read("supabase/functions/attribution-capture/index.ts");
  assert.match(capture, /ad_set_id:/);
  assert.match(capture, /ad_id:/);
});

test("#3697 4.5 unresolved Meta traffic is classified as social, not ad", () => {
  const capture = read("supabase/functions/attribution-capture/index.ts");
  assert.match(capture, /const metaAdResolved = requestedNetwork !== "meta"/);
  assert.match(capture, /requestedNetwork === "meta" && !metaAdResolved[\s\S]*?"other"/);
});

test("#3697 folded spend guard and pause transition both remain enforced", () => {
  assert.match(read("supabase/functions/_shared/adSpendSync.ts"), /preserveObservedSpend/);
  assert.match(read("supabase/functions/_shared/adPlanPauseTransition.ts"), /markPlanPaused/);
});
