// #3720 Phase 0 Slice C — grant-by-email + session refresh (happy).
//
// Pins: Support desk invokeSupportFn uses invokeWithRefresh; grant sends email;
// Sign in again CTA on sessionExpired; EmailPage retries 401 once.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(ADMIN_ROOT, rel), "utf8");
}

describe("#3720 support grant + session (happy)", () => {
  it("invokeSupportFn uses invokeWithRefresh and surfaces sessionExpired", () => {
    const page = read("src/pages/SupportDeskPage.jsx");
    const helper = page.match(/async function invokeSupportFn[\s\S]*?\n\}/);
    assert.ok(helper, "invokeSupportFn must exist");
    assert.match(helper[0], /invokeWithRefresh\(/);
    assert.equal(helper[0].includes("supabase.functions.invoke"), false);
    assert.match(helper[0], /sessionExpired:\s*true/);
    assert.match(helper[0], /isSessionExpiredError/);
    assert.match(page, /Sign in again/);
    assert.match(page, /sessionExpired &&/);
  });

  // [TEST-MOD-APPROVED #3988] Grant/revoke by email left the desk; Support is
  // set per teammate in People and roles, which the desk links to.
  it("the desk links Admins to People and roles instead of granting by email", () => {
    const page = read("src/pages/SupportDeskPage.jsx");
    assert.equal(/const handleGrant|const handleRevoke|support-grant-staff/.test(page), false);
    // #4130 Wave 6: People and roles is a tab of the Support page.
    assert.match(page, /MANAGE_SUPPORT_PEOPLE_HREF = "#\/support\?tab=team"/);
    assert.match(page, /\{canManageAgents && \(\s*<a href=\{MANAGE_SUPPORT_PEOPLE_HREF\}/);
    assert.match(page, /Manage who's on Support/);
  });

  it("EmailPage callEdgeFunction retries once on 401 then SessionExpiredError", () => {
    const page = read("src/pages/EmailPage.jsx");
    const call = page.match(/async function callEdgeFunction[\s\S]*?\n\}/);
    assert.ok(call, "callEdgeFunction must exist");
    assert.match(call[0], /response\.status === 401/);
    assert.match(call[0], /refreshSession/);
    assert.match(call[0], /retried/);
    assert.match(call[0], /SessionExpiredError/);
    assert.match(page, /Sign in again/);
  });
});
