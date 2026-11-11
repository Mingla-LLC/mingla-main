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
  // [TEST-MOD #4382] the composer replaced handleReply; support-send names
  // the real staff member (sender_display_name_snapshot) on every reply.
  it("the composer sends content via support-send as staff, never writing messages itself", () => {
    const composer = read("src/components/support/SupportComposer.jsx");
    const model = read("src/components/support/supportComposerModel.js");
    const service = read("src/services/supportDeskService.js");
    assert.match(service, /invokeWithRefresh\("support-send", \{ body \}\)/);
    assert.match(model, /actorMode: "staff"/);
    assert.match(model, /content: String\(content \|\| ""\)\.trim\(\)/);
    for (const src of [composer, service]) {
      assert.equal(src.includes("notifyOnly"), false);
      assert.equal(/from\("messages"\)\s*\.insert/.test(src), false);
    }
    assert.match(read("src/components/support/SupportThread.jsx"), /sender_display_name_snapshot/);
  });
});
