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

  it("handleGrant still sends email; handleRevoke sends userId only (no role wipe fields)", () => {
    const page = read("src/pages/SupportDeskPage.jsx");
    const grant = page.match(/const handleGrant[\s\S]*?\}, \[/);
    assert.ok(grant, "handleGrant must exist");
    assert.match(grant[0], /support-grant-staff/);
    assert.match(grant[0], /\{\s*email,\s*enabled:\s*true\s*\}/);

    const revoke = page.match(/const handleRevoke[\s\S]*?\}, \[/);
    assert.ok(revoke, "handleRevoke must exist");
    assert.match(revoke[0], /userId:\s*member\.user_id/);
    assert.match(revoke[0], /enabled:\s*false/);
    assert.equal(revoke[0].includes("role:"), false);
    assert.equal(revoke[0].includes("displayName"), false);
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
