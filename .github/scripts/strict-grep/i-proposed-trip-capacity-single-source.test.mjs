import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = new URL(
  "./i-proposed-trip-capacity-single-source.mjs",
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
  assert.match(result.stderr, /forbidden trip-capacity JSONB reference/);
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

test("ORCH-0950 gate passes unrelated business_trip destination key", () => {
  const result = runWithFixtures([
    [
      "mingla-business/src/Fixture.ts",
      "const destination = theme.business_trip.destination_location_text;\n",
    ],
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});
