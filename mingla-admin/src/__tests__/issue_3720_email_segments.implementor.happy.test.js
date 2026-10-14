// #3720 Phase 0 Slice B — Email page segments + single log writer (happy).
//
// Pins: City/Tier/Last Active removed from SEGMENT_TYPES; confirmSend does not
// insert admin_email_log (edge is the sole writer).

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

describe("#3720 admin email segments + single log writer (happy)", () => {
  it("SEGMENT_TYPES excludes city, tier, last_active", () => {
    const page = read("src/pages/EmailPage.jsx");
    const match = page.match(/const SEGMENT_TYPES = \[([\s\S]*?)\];/);
    assert.ok(match, "SEGMENT_TYPES must exist");
    const block = match[1];
    assert.match(block, /id: "all"/);
    assert.match(block, /id: "country"/);
    assert.match(block, /id: "onboarding"/);
    assert.match(block, /id: "status"/);
    assert.equal(block.includes("city"), false);
    assert.equal(block.includes("tier"), false);
    assert.equal(block.includes("last_active"), false);
  });

  it("confirmSend does not insert admin_email_log (edge-only writer)", () => {
    const page = read("src/pages/EmailPage.jsx");
    const confirm = page.match(/async function confirmSend\(\) \{([\s\S]*?)\n  \}/);
    assert.ok(confirm, "confirmSend must exist");
    assert.equal(
      confirm[1].includes('from("admin_email_log")'),
      false,
      "client must not insert admin_email_log",
    );
    assert.match(confirm[1], /callEdgeFunction/);
    assert.match(page, /admin_email_log is written only by admin-send-email/);
  });
});
