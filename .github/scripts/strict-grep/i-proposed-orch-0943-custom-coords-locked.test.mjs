import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

const SCRIPT = new URL(
  "./i-proposed-orch-0943-custom-coords-locked.mjs",
  import.meta.url,
);

function writeFixture(root, rel, source) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

function runAgainst(source) {
  const root = mkdtempSync(join(tmpdir(), "orch-0943-coords-lock-"));
  try {
    writeFixture(root, "Fixture.tsx", source);
    return spawnSync(process.execPath, [SCRIPT.pathname, "--root", root], {
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("ORCH-0943 gate passes the post-fix codebase", () => {
  const output = execFileSync(process.execPath, [SCRIPT.pathname], {
    encoding: "utf8",
  });
  assert.match(output, /PASS/);
  assert.match(output, /violations=0/);
});

test("ORCH-0943 gate passes full payload with custom_location and coords", () => {
  const result = runAgainst(`
    await supabase.rpc('upsert_participant_prefs', {
      p_session_id: sessionId,
      p_user_id: user.id,
      p_prefs: {
        custom_location: 'New York, NY, USA',
        custom_lat: 40.7128,
        custom_lng: -74.006,
      },
    });
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});

test("ORCH-0943 gate passes guarded GPS-mode partial coord payload", () => {
  const result = runAgainst(`
    const participantUseGps = boardSessionResult.preferences?.use_gps_location;
    if (participantUseGps !== true) return;
    await supabase.rpc('upsert_participant_prefs', {
      p_session_id: sessionId,
      p_user_id: user.id,
      p_prefs: {
        custom_lat: userLocation.lat,
        custom_lng: userLocation.lng,
      },
    });
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});

test("ORCH-0943 gate fails pre-fix partial coord payload without guard", () => {
  const result = runAgainst(`
    await supabase.rpc('upsert_participant_prefs', {
      p_session_id: sessionId,
      p_user_id: user.id,
      p_prefs: {
        custom_lat: userLocation.lat,
        custom_lng: userLocation.lng,
      },
    });
  `);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /writes custom_lat\/custom_lng without custom_location/);
  assert.match(result.stdout, /FAIL/);
});

test("ORCH-0943 gate ignores custom_location-only payloads", () => {
  const result = runAgainst(`
    await PreferencesService.updateUserPreferences(user.id, {
      custom_location: data.manualLocation,
    });
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});
