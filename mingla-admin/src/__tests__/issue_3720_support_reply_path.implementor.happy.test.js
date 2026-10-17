// #3720 Phase 0 Slice A — admin Support desk reply path (happy).
//
// Pins: handleReply sends content through support-send only; composer states
// actual-person Support attribution; no notifyOnly / direct messages insert
// in handleReply.
//
// Fails-on-revert: restoring notifyOnly or messages.insert in handleReply.

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

describe("#3720 admin support reply path (happy)", () => {
  // [TEST-MOD-APPROVED #3720] Wave 2 removes the fictional Support identity.
  it("handleReply sends content via support-send and explains actual-person attribution", () => {
    const page = read("src/pages/SupportDeskPage.jsx");
    const replyMatch = page.match(/const handleReply[\s\S]*?\}, \[/);
    assert.ok(replyMatch, "handleReply must exist");
    assert.match(replyMatch[0], /invokeSupportFn\("support-send"/);
    assert.match(replyMatch[0], /content:\s*body/);
    assert.equal(replyMatch[0].includes("notifyOnly"), false);
    assert.equal(replyMatch[0].includes('from("messages")'), false);
    assert.match(page, /your real staff name · Mingla Support/);
  });
});
