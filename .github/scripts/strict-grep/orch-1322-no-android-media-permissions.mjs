#!/usr/bin/env node
/**
 * ORCH-1322 [consumer-android-media-permission-latent] —
 * I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS (config half).
 *
 * WHY: Google Play's Photo and Video Permissions policy forbids an app that only
 * PICKS an occasional file (avatar / chat attachment / feedback screenshot) from
 * holding READ_MEDIA_IMAGES / READ_MEDIA_VIDEO; it must use the Android Photo
 * Picker (which needs no permission). This is the CONSUMER (app-mobile)
 * counterpart of the shipped ORCH-1321 business fix. The consumer app never
 * declared media perms in app.json, but the expo-image-picker@17.0.11 library
 * manifest still merges in READ_EXTERNAL_STORAGE + WRITE_EXTERNAL_STORAGE. The
 * fix force-removes any library-merged residue (and permanently locks
 * READ_MEDIA_* absent) via `expo.android.blockedPermissions`, which emits
 * `tools:node="remove"` in the merged AAB manifest.
 *
 * ASSERTS (app-mobile/app.json):
 *  A. expo.android.permissions does NOT list READ_MEDIA_IMAGES,
 *     READ_MEDIA_VIDEO, or READ_EXTERNAL_STORAGE.
 *  B. expo.android.blockedPermissions lists ALL of READ_MEDIA_IMAGES,
 *     READ_MEDIA_VIDEO, READ_EXTERNAL_STORAGE, and WRITE_EXTERNAL_STORAGE.
 *
 * A revert that re-adds any media/storage permission to `permissions`, or that
 * drops any entry from `blockedPermissions`, must FAIL CI.
 *
 * `--self-test` proves PASS-on-fix + FAIL-on-revert for each assertion.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the repo root from THIS script's location (.github/scripts/strict-grep/
// → up three levels), so the gate runs identically from CI (repo-root cwd) and
// from the `npm run test:orch-1322` script (app-mobile/ cwd).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");
const APP_JSON = path.join(root, "app-mobile/app.json");

// Must NEVER appear in expo.android.permissions.
const FORBIDDEN_IN_PERMISSIONS = [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_EXTERNAL_STORAGE",
];

// Must ALL appear in expo.android.blockedPermissions.
const REQUIRED_IN_BLOCKED = [
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
];

function checkAppJson(appJsonSrc, failures) {
  let parsed;
  try {
    parsed = JSON.parse(appJsonSrc);
  } catch (e) {
    failures.push(`app.json is not valid JSON: ${e.message}`);
    return;
  }
  const android = parsed?.expo?.android ?? {};
  const permissions = Array.isArray(android.permissions)
    ? android.permissions
    : [];
  const blocked = Array.isArray(android.blockedPermissions)
    ? android.blockedPermissions
    : [];

  // A — forbidden media/storage permissions must not be granted.
  for (const perm of FORBIDDEN_IN_PERMISSIONS) {
    if (permissions.includes(perm)) {
      failures.push(
        `expo.android.permissions must NOT list ${perm} (Google Play Photo & ` +
          `Video Permissions policy — use the Android Photo Picker instead).`,
      );
    }
  }

  // B — blockedPermissions must strip the whole media/storage set.
  for (const perm of REQUIRED_IN_BLOCKED) {
    if (!blocked.includes(perm)) {
      failures.push(
        `expo.android.blockedPermissions must list ${perm} so it is force-` +
          `stripped (tools:node="remove") from the merged manifest.`,
      );
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];

  const goodAppJson = JSON.stringify({
    expo: {
      android: {
        permissions: [
          "android.permission.CAMERA",
          "android.permission.RECORD_AUDIO",
          "android.permission.READ_CALENDAR",
        ],
        blockedPermissions: [
          "android.permission.READ_MEDIA_IMAGES",
          "android.permission.READ_MEDIA_VIDEO",
          "android.permission.READ_EXTERNAL_STORAGE",
          "android.permission.WRITE_EXTERNAL_STORAGE",
        ],
      },
    },
  });

  // Good fixture must pass clean.
  let f = [];
  checkAppJson(goodAppJson, f);
  if (f.length) self.push("good app.json wrongly flagged: " + f.join("; "));

  // Revert A: re-add READ_MEDIA_IMAGES to permissions → must fire.
  const revertPerm = JSON.parse(goodAppJson);
  revertPerm.expo.android.permissions.push(
    "android.permission.READ_MEDIA_IMAGES",
  );
  f = [];
  checkAppJson(JSON.stringify(revertPerm), f);
  if (f.length === 0) {
    self.push("re-adding READ_MEDIA_IMAGES to permissions was not flagged");
  }

  // Revert A2: re-add READ_EXTERNAL_STORAGE to permissions → must fire.
  const revertPerm2 = JSON.parse(goodAppJson);
  revertPerm2.expo.android.permissions.push(
    "android.permission.READ_EXTERNAL_STORAGE",
  );
  f = [];
  checkAppJson(JSON.stringify(revertPerm2), f);
  if (f.length === 0) {
    self.push("re-adding READ_EXTERNAL_STORAGE to permissions was not flagged");
  }

  // Revert B: drop READ_MEDIA_VIDEO from blockedPermissions → must fire.
  const revertBlocked = JSON.parse(goodAppJson);
  revertBlocked.expo.android.blockedPermissions =
    revertBlocked.expo.android.blockedPermissions.filter(
      (p) => p !== "android.permission.READ_MEDIA_VIDEO",
    );
  f = [];
  checkAppJson(JSON.stringify(revertBlocked), f);
  if (f.length === 0) {
    self.push("dropping READ_MEDIA_VIDEO from blockedPermissions was not flagged");
  }

  // Revert B2: drop blockedPermissions entirely → must fire.
  const noBlocked = JSON.parse(goodAppJson);
  delete noBlocked.expo.android.blockedPermissions;
  f = [];
  checkAppJson(JSON.stringify(noBlocked), f);
  if (f.length === 0) {
    self.push("removing blockedPermissions entirely was not flagged");
  }

  if (self.length) {
    console.error("ORCH-1322 no-android-media-permissions self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1322 no-android-media-permissions self-test PASS (5/5 cases).",
  );
  process.exit(0);
}

const failures = [];
if (!fs.existsSync(APP_JSON)) {
  failures.push(`app.json not found at ${APP_JSON}.`);
} else {
  checkAppJson(fs.readFileSync(APP_JSON, "utf8"), failures);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1322 I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS FAIL:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1322 I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS PASS — " +
    "app-mobile/app.json declares no media/storage permission and blocks the " +
    "full READ_MEDIA_*/READ_EXTERNAL_STORAGE/WRITE_EXTERNAL_STORAGE set.",
);
