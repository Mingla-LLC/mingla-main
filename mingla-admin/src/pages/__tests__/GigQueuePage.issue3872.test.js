import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const page = fs.readFileSync(path.join(root, "pages/GigQueuePage.jsx"), "utf8");
const timeline = fs.readFileSync(path.join(root, "pages/crm/GigTimeline.jsx"), "utf8");
test("#3872 Admin queue shows shared evidence and explicit outcomes", () => {
  assert.match(page, /admin_gig_queue/);
  assert.match(page, /gig-dispute-resolve/);
  assert.match(page, /Release fee/);
  assert.match(page, /Partial refund/);
  assert.match(page, /Full refund/);
  assert.match(timeline, /Shared contract timeline/);
});
