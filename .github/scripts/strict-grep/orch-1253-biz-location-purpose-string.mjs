#!/usr/bin/env node
/**
 * ORCH-1253 [Apple ITMS-90683 "Missing purpose string in Info.plist —
 * NSLocationWhenInUseUsageDescription" on the BUSINESS iOS app] — strict-grep
 * gate.
 *
 * Apple warned/rejected the business build with ITMS-90683 because a bundled
 * SDK (react-native-appsflyer and/or react-native-onesignal) references the
 * CoreLocation API. When a linked SDK references CoreLocation, Apple REQUIRES
 * an NSLocationWhenInUseUsageDescription purpose string in the final Info.plist
 * even though the business app has no user-facing location feature (the only
 * reason the capability exists is analytics/attribution via AppsFlyer).
 *
 * The consumer app (app-mobile/app.json) already carries this string; the
 * business app (mingla-business/app.json) was MISSING it. This gate prevents a
 * regression by asserting the resolved business iOS infoPlist contains a
 * non-empty NSLocationWhenInUseUsageDescription.
 *
 * Scope + authority: mingla-business/app.json ios.infoPlist is the authoritative
 * source. mingla-business/app.config.js spreads `...config` and NEVER rebuilds
 * or replaces `ios` / `ios.infoPlist`, so the app.json value survives verbatim
 * into the resolved Expo config (verified via `npx expo config`). Asserting on
 * app.json is therefore both simple and robust.
 *
 * Exit 0 clean, 1 on violation. Supports --self-test.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");

const KEY = "NSLocationWhenInUseUsageDescription";

function evaluate(infoPlist) {
  const violations = [];
  const val = infoPlist?.[KEY];
  if (typeof val !== "string" || val.trim().length === 0) {
    violations.push(
      `${KEY} is missing/empty in mingla-business/app.json ios.infoPlist. ` +
        "A linked SDK (AppsFlyer/OneSignal) references CoreLocation, so Apple " +
        "requires this purpose string or the business build trips ITMS-90683.",
    );
  }
  return violations;
}

function selfTest() {
  const good = evaluate({
    [KEY]:
      "Mingla Business uses your location to help measure the performance of our marketing and improve our services.",
  });
  const missing = evaluate({
    NSCameraUsageDescription: "Mingla Business uses your camera.",
  });
  const empty = evaluate({ [KEY]: "   " });
  const ok = good.length === 0 && missing.length > 0 && empty.length > 0;
  console.log(
    ok
      ? "[ORCH-1253 — orch-1253-biz-location-purpose-string] SELF-TEST PASS"
      : "[ORCH-1253] SELF-TEST FAIL",
  );
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes("--self-test")) selfTest();

const json = JSON.parse(
  readFileSync(join(ROOT, "mingla-business/app.json"), "utf8"),
);
const info = json?.expo?.ios?.infoPlist ?? {};
const violations = evaluate(info);

if (violations.length > 0) {
  console.error(
    "\n[ORCH-1253 — orch-1253-biz-location-purpose-string] VIOLATIONS:\n",
  );
  for (const v of violations) console.error(`  • ${v}`);
  console.error(
    "\nApple ITMS-90683: a linked SDK references CoreLocation, so the final " +
      "Info.plist MUST declare NSLocationWhenInUseUsageDescription.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-1253 — orch-1253-biz-location-purpose-string] PASS — business iOS infoPlist declares a non-empty NSLocationWhenInUseUsageDescription.",
);
process.exit(0);
