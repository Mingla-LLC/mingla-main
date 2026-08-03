import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const venueSections = read("src/components/stay/StayVenueSections.jsx");
const operations = read("src/components/stay/StayOperationsPanel.jsx");
const service = read("src/services/stayAdminService.js");
const migration = read("../supabase/migrations/20270204001448_issue_1427_admin_stay_support.sql");

test("tester: every Stay detail shows an age-aware snapshot warning instead of silently aging", () => {
  assert.match(venueSections, /StaySnapshotStatus/);
  assert.match(operations, /StaySnapshotStatus/);
  assert.match(venueSections, /snapshotAt/);
  assert.match(operations, /snapshotAt/);
});

test("tester: revoked Admin access maps to a safe restricted state without raw database detail", () => {
  assert.match(service, /mapStayAdminReadError/);
  assert.match(service, /Active Admin access is required\./);
  assert.doesNotMatch(service, /if \(error\) throw new Error\(error\.message/);
  assert.match(service, /return "The Stay support action failed\. Reload and try again\."/);
});

test("tester: retained alert metadata is an exact per-kind allowlist, including nested-key rejection", () => {
  const writer = migration.slice(
    migration.indexOf("issue_1427_record_stay_operation_alert"),
    migration.indexOf("issue_1427_resolve_stay_operation_alert"),
  );
  assert.match(writer, /jsonb_object_keys/);
  assert.match(writer, /inventory_changed[\s\S]*'action'/);
  assert.match(writer, /materialization_failed[\s\S]*'scheduleRuleId'/);
  assert.match(writer, /jsonb_path_exists/);
});
