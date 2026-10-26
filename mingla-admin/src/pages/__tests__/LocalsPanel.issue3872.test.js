import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const panel = fs.readFileSync(path.join(root, "pages/locals/LocalsPanel.jsx"), "utf8");
const queue = fs.readFileSync(path.join(root, "pages/GigQueuePage.jsx"), "utf8");

test("#3872 Admin owns Local seats, applications, reviews and shared-ledger payout preparation", () => {
  for (const contract of ["admin_local_queue", "local_city_program_save", "local_application_decide", "local_review_decide", "local-payout"]) {
    assert.match(panel, new RegExp(contract));
  }
  assert.match(panel, /Mingla—not the place/);
  assert.match(panel, /Required before accepting anyone/);
  assert.match(panel, /Create city program/);
  assert.match(panel, /Open applications immediately/);
  assert.match(queue, /LocalsPanel/);
});
