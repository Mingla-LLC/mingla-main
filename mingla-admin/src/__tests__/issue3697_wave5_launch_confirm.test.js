/**
 * toward #3697 Wave 5 — challenge-based LAUNCH (#3704).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LAUNCH_CONFIRM_PHRASE } from "../lib/adLaunchConfirm.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ADMIN = path.join(ROOT, "mingla-admin/src");

test("LAUNCH_CONFIRM_PHRASE is LAUNCH and matches shared Deno constant", () => {
  assert.equal(LAUNCH_CONFIRM_PHRASE, "LAUNCH");
  const shared = fs.readFileSync(
    path.join(ROOT, "supabase/functions/_shared/adLaunchConfirm.ts"),
    "utf8",
  );
  assert.match(shared, /export const LAUNCH_CONFIRM_PHRASE = "LAUNCH"/);
});

test("CampaignsPage uses HighRiskActionModal with LAUNCH challenge (not one-click)", () => {
  const src = fs.readFileSync(path.join(ADMIN, "pages/CampaignsPage.jsx"), "utf8");
  assert.match(src, /HighRiskActionModal/);
  assert.match(src, /confirmPhrase=\{LAUNCH_CONFIRM_PHRASE\}/);
  assert.match(src, /confirm_phrase:\s*LAUNCH_CONFIRM_PHRASE/);
  assert.match(src, /requireReason/);
  // One-click Launch footer must be gone.
  assert.doesNotMatch(src, /ModalFooter[\s\S]*handleAction\(target,\s*"launch"\)/);
  assert.doesNotMatch(src, /from "\.\.\/components\/ui\/Modal"/);
});

test("campaignAction forwards confirm_phrase + reason only for launch", () => {
  const src = fs.readFileSync(path.join(ADMIN, "services/adEngineService.js"), "utf8");
  assert.match(src, /action === "launch"/);
  assert.match(src, /confirm_phrase/);
  assert.match(src, /extras\.reason/);
});

test("builder still never launches (SC-10)", () => {
  const builder = fs.readFileSync(
    path.join(ADMIN, "pages/CampaignBuilderPage.jsx"),
    "utf8",
  );
  assert.doesNotMatch(builder, /campaignAction/);
  assert.doesNotMatch(builder, /admin-ad-campaign-action/);
});
