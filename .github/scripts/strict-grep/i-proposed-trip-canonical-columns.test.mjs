import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = new URL(
  "./i-proposed-trip-canonical-columns.mjs",
  import.meta.url,
);
const SCRIPT_PATH = fileURLToPath(SCRIPT);

function writeFixture(root, rel, source) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

function runWithFixtures(fixtures) {
  const root = mkdtempSync(join(tmpdir(), "orch-0950-trip-capacity-"));
  try {
    for (const [rel, source] of fixtures) {
      writeFixture(root, rel, source);
    }
    return spawnSync(process.execPath, [SCRIPT_PATH, "--root", root], {
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("ORCH-0950 gate fails fixture containing theme.business_trip.capacity", () => {
  const result = runWithFixtures([
    [
      "mingla-business/src/Fixture.tsx",
      "const bad = payload.theme.business_trip.capacity;\n",
    ],
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /forbidden trip canonical-column violation/);
  assert.match(result.stderr, /theme\.business_trip\.capacity/);
});

test("ORCH-0950 gate passes inline defensive-throw allowlist tag", () => {
  const result = runWithFixtures([
    [
      "mingla-business/src/services/tripsService.ts",
      [
        "// orch-strict-grep-allow trip-capacity-defensive-throw",
        "throw new Error('theme.business_trip.capacity must not be written here');",
      ].join("\n"),
    ],
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});

test("ORCH-0950 gate passes allowlisted cutover migration filename", () => {
  const result = runWithFixtures([
    [
      "supabase/migrations/20260725000000_orch_0950_trip_capacity_single_source.sql",
      "SELECT theme.business_trip.capacity FROM legacy_strip_probe;\n",
    ],
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});

test("ORCH-0950 gate fails shallow trip RPC theme merge in future migrations", () => {
  const result = runWithFixtures([
    [
      "supabase/migrations/20260726000001_future_trip_rpc.sql",
      "UPDATE public.events SET theme = theme || (p_patch->'theme');\n",
    ],
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /theme \|\| \(p_patch->'theme'\)/);
});

test("ORCH-0950 gate fails JSONB date/destination reader literals", () => {
  const result = runWithFixtures([
    [
      "mingla-business/src/Fixture.ts",
      "const start = trip.business_trip.startAt;\nconst destination = trip.business_trip.destinationLocationText;\n",
    ],
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /business_trip\.startAt/);
  assert.match(result.stderr, /business_trip\.destinationLocationText/);
});

test("ORCH-0950 gate passes allowlisted expanded migration filename", () => {
  const result = runWithFixtures([
    [
      "supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql",
      "p_patch := p_patch #- '{theme,business_trip,startAt}';\n",
    ],
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});
