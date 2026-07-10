#!/usr/bin/env node
/**
 * ORCH-1322 [consumer-android-media-permission-latent] —
 * I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS (routing half).
 *
 * WHY (runtime-equivalent guard): once app.json blocks READ/WRITE_EXTERNAL_STORAGE
 * (config gate orch-1322-no-android-media-permissions.mjs), any consumer gallery
 * gate that still calls the raw expo-image-picker permission API would, on
 * Android <= 12, be DENIED the now-stripped storage permission and DEAD-TAP.
 * The fix is a single shared wrapper (app-mobile/src/utils/mediaLibraryPermission.ts)
 * that short-circuits to { granted: true } on Android BEFORE calling ImagePicker
 * (the Android Photo Picker needs no permission), while iOS still requests it.
 * Every gallery gate MUST route through that wrapper.
 *
 * app-mobile has no jest runner (no jest key/dep), so this node .mjs check is the
 * definitely-runnable runtime-equivalent proof (OQ-1 resolution).
 *
 * ASSERTS:
 *  A. app-mobile/src/utils/mediaLibraryPermission.ts exists and its Android
 *     branch (`Platform.OS === 'android'`) returns `granted: true` BEFORE any
 *     `ImagePicker.requestMediaLibraryPermissionsAsync(` token (comment-stripped).
 *  B. Each routed gate site imports from `mediaLibraryPermission` AND calls
 *     `requestGalleryPermission(`:
 *       - app-mobile/src/components/BetaFeedbackModal.tsx
 *       - app-mobile/src/components/MessageInterface.tsx
 *       - app-mobile/src/services/cameraService.ts
 *  C. NO file under app-mobile/src (except the wrapper itself and __tests__)
 *     contains `ImagePicker.requestMediaLibraryPermissionsAsync(` (comment-stripped).
 *
 * Fails-on-revert: removing the Android short-circuit fails A; un-routing a site
 * (back to a raw ImagePicker permission call) fails B AND C; adding a raw call in
 * any other file fails C.
 *
 * `--self-test` proves PASS-on-fix + FAIL-on-revert for each assertion with
 * in-memory fixtures (no repo dependency).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");

const WRAPPER_REL = "app-mobile/src/utils/mediaLibraryPermission.ts";
const SITE_RELS = [
  "app-mobile/src/components/BetaFeedbackModal.tsx",
  "app-mobile/src/components/MessageInterface.tsx",
  "app-mobile/src/services/cameraService.ts",
];
const SRC_DIR = "app-mobile/src";
const RAW_CALL = "ImagePicker.requestMediaLibraryPermissionsAsync(";

// Strip // line comments and /* */ block comments so prose/JSDoc mentions of the
// raw API don't count as real calls.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// A — wrapper short-circuits granted:true on Android before delegating to iOS.
function checkWrapper(src, failures) {
  const code = stripComments(src);
  const androidIdx = code.search(/Platform\.OS\s*===\s*['"]android['"]/);
  const grantedIdx = code.search(/granted\s*:\s*true/);
  const callIdx = code.indexOf(RAW_CALL);

  if (androidIdx < 0) {
    failures.push(
      "wrapper: missing the `Platform.OS === 'android'` short-circuit branch.",
    );
  }
  if (grantedIdx < 0) {
    failures.push("wrapper: Android branch must return `granted: true`.");
  }
  if (callIdx < 0) {
    failures.push(
      "wrapper: must delegate to `ImagePicker.requestMediaLibraryPermissionsAsync(` on iOS.",
    );
  }
  if (androidIdx >= 0 && grantedIdx >= 0 && callIdx >= 0) {
    if (!(androidIdx < grantedIdx && grantedIdx < callIdx)) {
      failures.push(
        "wrapper: the Android `granted: true` short-circuit must appear BEFORE " +
          "the iOS ImagePicker.requestMediaLibraryPermissionsAsync call " +
          "(otherwise Android <=12 dead-taps).",
      );
    }
  }
}

// B — a routed site imports the wrapper and calls requestGalleryPermission(.
function checkSiteRouting(label, src, failures) {
  const code = stripComments(src);
  if (!/from\s+['"][^'"]*mediaLibraryPermission['"]/.test(code)) {
    failures.push(`${label}: must import from '../utils/mediaLibraryPermission'.`);
  }
  if (!code.includes("requestGalleryPermission(")) {
    failures.push(`${label}: must call requestGalleryPermission(...).`);
  }
  if (code.includes(RAW_CALL)) {
    failures.push(
      `${label}: must NOT call ImagePicker.requestMediaLibraryPermissionsAsync directly (route through the wrapper).`,
    );
  }
}

// C — no raw call outside the wrapper (+ __tests__).
function checkNoRawCalls(files, failures) {
  for (const { rel, src } of files) {
    const norm = rel.replace(/\\/g, "/");
    if (norm.endsWith(WRAPPER_REL) || norm.includes("/__tests__/")) continue;
    if (stripComments(src).includes(RAW_CALL)) {
      failures.push(
        `${norm}: raw ImagePicker.requestMediaLibraryPermissionsAsync call outside the wrapper (route through requestGalleryPermission).`,
      );
    }
  }
}

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const expectClean = (name, fn) => {
    const f = [];
    fn(f);
    if (f.length) self.push(`${name} wrongly flagged: ${f.join("; ")}`);
  };
  const expectFail = (name, fn) => {
    const f = [];
    fn(f);
    if (f.length === 0) self.push(`${name} was not flagged`);
  };

  const goodWrapper = `
    import { Platform } from 'react-native';
    import * as ImagePicker from 'expo-image-picker';
    export async function requestGalleryPermission() {
      if (Platform.OS === 'android') {
        return { granted: true, canAskAgain: true, status: ImagePicker.PermissionStatus.GRANTED, expires: 'never' };
      }
      return ImagePicker.requestMediaLibraryPermissionsAsync();
    }`;
  const wrapperNoAndroid = `
    import * as ImagePicker from 'expo-image-picker';
    export async function requestGalleryPermission() {
      return ImagePicker.requestMediaLibraryPermissionsAsync();
    }`;
  const wrapperReordered = `
    import { Platform } from 'react-native';
    import * as ImagePicker from 'expo-image-picker';
    export async function requestGalleryPermission() {
      const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (Platform.OS === 'android') { return { granted: true }; }
      return r;
    }`;

  expectClean("good wrapper", (f) => checkWrapper(goodWrapper, f));
  expectFail("wrapper w/o android short-circuit", (f) =>
    checkWrapper(wrapperNoAndroid, f),
  );
  expectFail("wrapper calling ImagePicker before granted:true", (f) =>
    checkWrapper(wrapperReordered, f),
  );

  const goodSite = `
    import { requestGalleryPermission } from '../utils/mediaLibraryPermission';
    const { status } = await requestGalleryPermission();`;
  const unroutedSite = `
    import * as ImagePicker from 'expo-image-picker';
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();`;

  expectClean("good site", (f) => checkSiteRouting("site", goodSite, f));
  expectFail("un-routed site", (f) => checkSiteRouting("site", unroutedSite, f));

  expectClean("no raw calls (only wrapper)", (f) =>
    checkNoRawCalls(
      [
        { rel: WRAPPER_REL, src: goodWrapper },
        { rel: "app-mobile/src/components/Other.tsx", src: goodSite },
      ],
      f,
    ),
  );
  expectFail("raw call in a non-wrapper file", (f) =>
    checkNoRawCalls(
      [
        { rel: WRAPPER_REL, src: goodWrapper },
        { rel: "app-mobile/src/components/Rogue.tsx", src: unroutedSite },
      ],
      f,
    ),
  );

  if (self.length) {
    console.error("ORCH-1322 gallery-permission-wrapper-routed self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1322 gallery-permission-wrapper-routed self-test PASS (7/7 cases).",
  );
  process.exit(0);
}

const failures = [];

// A — wrapper
const wrapperPath = path.join(root, WRAPPER_REL);
if (!fs.existsSync(wrapperPath)) {
  failures.push(`wrapper not found at ${WRAPPER_REL}.`);
} else {
  checkWrapper(fs.readFileSync(wrapperPath, "utf8"), failures);
}

// B — routed sites
for (const rel of SITE_RELS) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    failures.push(`routed site not found at ${rel}.`);
  } else {
    checkSiteRouting(rel, fs.readFileSync(p, "utf8"), failures);
  }
}

// C — no raw call anywhere else under app-mobile/src
const srcRoot = path.join(root, SRC_DIR);
if (fs.existsSync(srcRoot)) {
  const files = [];
  walk(srcRoot, files);
  checkNoRawCalls(
    files.map((full) => ({
      rel: path.relative(root, full),
      src: fs.readFileSync(full, "utf8"),
    })),
    failures,
  );
}

if (failures.length > 0) {
  console.error(
    "ORCH-1322 gallery-permission-wrapper-routed FAIL " +
      "(I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS):\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1322 gallery-permission-wrapper-routed PASS — the shared wrapper " +
    "short-circuits granted:true on Android and all 3 gallery gates route " +
    "through requestGalleryPermission (no raw ImagePicker permission call " +
    "outside the wrapper).",
);
