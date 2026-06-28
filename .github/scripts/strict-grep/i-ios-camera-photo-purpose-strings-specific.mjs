#!/usr/bin/env node
/**
 * ORCH-1242 [iOS camera + photo-library purpose strings too vague → Apple
 * 5.1.1(ii) rejection of build 33] — strict-grep gate.
 *
 * Apple rejected build 33 because NSCameraUsageDescription /
 * NSPhotoLibraryUsageDescription did not clearly describe the use of the
 * resource and gave no concrete example. This gate prevents a regression to
 * a vague purpose string by asserting each string:
 *   - is NOT the old rejected wording ("...to capture photos for your
 *     experiences" / "...to select images for your experiences"),
 *   - contains a concrete example marker ("for example"),
 *   - is reasonably descriptive (length floor),
 *   - references a real, truthful use surface (profile / chat / message).
 *
 * Scope: app-mobile/app.json infoPlist (the authoritative source — app.config.ts
 * does not override infoPlist).
 *
 * Exit 0 clean, 1 on violation. Supports --self-test.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");

const REJECTED = [
  "capture photos for your experiences",
  "select images for your experiences",
];

function evaluate(camera, photo) {
  const violations = [];
  const checks = [
    ["NSCameraUsageDescription", camera],
    ["NSPhotoLibraryUsageDescription", photo],
  ];
  for (const [key, val] of checks) {
    if (typeof val !== "string" || val.trim().length === 0) {
      violations.push(`${key} is missing/empty.`);
      continue;
    }
    const low = val.toLowerCase();
    if (REJECTED.some((r) => low.includes(r))) {
      violations.push(`${key} uses the Apple-rejected vague wording. Describe the real use + give a concrete example.`);
    }
    if (!low.includes("for example")) {
      violations.push(`${key} must include a concrete example ("for example, …") per Apple 5.1.1(ii).`);
    }
    if (val.length < 60) {
      violations.push(`${key} is too short (${val.length} chars) to clearly describe the use + an example.`);
    }
    if (!/(profile|chat|message|photo|picture|video)/i.test(val)) {
      violations.push(`${key} should reference the real use surface (profile / chat / message).`);
    }
  }
  return violations;
}

function selfTest() {
  const good = evaluate(
    "Mingla uses the camera so you can take a photo to set as your profile picture or share in a chat — for example, snapping a photo to send in a group plan conversation.",
    "Mingla uses your photo library so you can choose existing photos or videos to set as your profile picture or share in chats — for example, picking a saved photo to send in a direct or group message.",
  );
  const badVague = evaluate(
    "Mingla needs camera access to capture photos for your experiences.",
    "Mingla needs photo library access to select images for your experiences.",
  );
  const badNoExample = evaluate(
    "Mingla uses the camera for your profile picture and chats.",
    "Mingla uses your photo library for your profile picture and chats.",
  );
  const ok =
    good.length === 0 && badVague.length > 0 && badNoExample.length > 0;
  console.log(ok
    ? "[ORCH-1242 — i-ios-camera-photo-purpose-strings-specific] SELF-TEST PASS"
    : "[ORCH-1242] SELF-TEST FAIL");
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes("--self-test")) selfTest();

const json = JSON.parse(readFileSync(join(ROOT, "app-mobile/app.json"), "utf8"));
const info = json?.expo?.ios?.infoPlist ?? {};
const violations = evaluate(
  info.NSCameraUsageDescription,
  info.NSPhotoLibraryUsageDescription,
);

if (violations.length > 0) {
  console.error("\n[ORCH-1242 — i-ios-camera-photo-purpose-strings-specific] VIOLATIONS:\n");
  for (const v of violations) console.error(`  • ${v}`);
  console.error("\nApple 5.1.1(ii): purpose strings must clearly describe the use + give a concrete example.");
  process.exit(1);
}

console.log("[ORCH-1242 — i-ios-camera-photo-purpose-strings-specific] PASS — camera + photo-library purpose strings are specific with a concrete example.");
process.exit(0);
