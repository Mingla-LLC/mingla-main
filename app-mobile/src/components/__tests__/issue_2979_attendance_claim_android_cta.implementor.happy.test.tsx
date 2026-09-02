// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// Issue #2979 — Android attendance-claim CTA reachability regression.
//
// On-device acceptance proved that BaseBottomSheet's stickyFooter branch let
// the body ScrollView consume the full remaining Pixel 7 sheet height. The CTA
// was therefore mounted below the Android viewport and did not exist in the
// accessibility tree. The repository's ORCH-1016/1043 sheet contract already
// establishes the safe shape: a primitive-owned scroll with body and CTA as
// ordinary scroll-content siblings.
//
// Run with:
//   node app-mobile/src/components/__tests__/issue_2979_attendance_claim_android_cta.implementor.happy.test.tsx

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const source = fs.readFileSync(
  path.join(root, "src/components/AttendanceClaimSheet.tsx"),
  "utf8",
);
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

assert.ok(
  /<BaseBottomSheet[\s\S]*?scrollMode="scroll"[\s\S]*?>/.test(code),
  "AttendanceClaimSheet must use the primitive-owned scroll viewport",
);
assert.ok(
  !/stickyFooter=/.test(code),
  "AttendanceClaimSheet must not route its CTA through the Android-cut-off stickyFooter branch",
);
assert.ok(
  /<BaseBottomSheet[\s\S]*?<View style=\{styles\.body\}[\s\S]*?<\/View>\s*\{footer\}\s*<\/BaseBottomSheet>/.test(
    code,
  ),
  "attendance body and CTA footer must be ordered scroll-content siblings",
);
assert.ok(
  /const footer = \([\s\S]*?<Pressable[\s\S]*?<Text style=\{styles\.buttonText\}>\{label\}<\/Text>[\s\S]*?<\/View>\s*\);/.test(
    code,
  ),
  "the reachable footer must retain its phase-aware attendance action",
);

console.log("issue #2979 Android attendance CTA reachability guard passed");
