#!/usr/bin/env node
/**
 * ORCH-1303 [web cover VIDEO upload — mangled blob URL] — strict-grep gate.
 *
 * WHY: on business WEB the raw-clip branch of `CoverPicker.pickVideoCover`
 * ran `normalizeLocalFileUri(asset.uri)` on the picker's browser object URL
 * (`blob:https://…`). `normalizeLocalFileUri` prefixes `file://`, producing
 * `file://blob:https://…`. The web TUS upload's first web statement is
 * `fetch(input.uri)` (eventCoverVideoProcessingService.ts) — fetching a
 * `file://blob:` uri from an https origin rejects ("Failed to fetch"), so a
 * web VIDEO cover NEVER uploaded. IMAGE covers worked (uri passed unmangled);
 * NATIVE worked (real /var/… file paths that genuinely need `file://`). The
 * mangle is target-agnostic, so it broke web video cover for venue, the
 * META-ORCH-1290 wizard Cover step, brand, and trip/event covers alike.
 *
 * FIX (ORCH-1303, web-only, native byte-identical): the raw-clip branch calls
 * the pure helper `resolveRawClipUploadUri(asset.uri, Platform.OS === "web")`.
 * On web it returns the blob uri UNMANGLED; on native it still normalizes the
 * real file path. The web TUS `fetch(input.uri)` then succeeds on a `blob:`
 * uri. The Bunny signing/edge/TUS transport is untouched (it was always fine,
 * just never reached).
 *
 * RULE (structural anti-recurrence) — all must hold, else exit non-zero:
 *   A. CoverPicker.tsx raw-clip branch calls
 *      `resolveRawClipUploadUri(asset.uri, Platform.OS === "web")` AND does
 *      NOT carry the unconditional mangle `uri: normalizeLocalFileUri(asset.uri)`
 *      (reverting to it re-breaks every web video cover).
 *   B. coverPickerVideoTrimUpload.ts defines `resolveRawClipUploadUri` with a
 *      web-conditional body (`isWeb ? assetUri : normalizeLocalFileUri(...)`),
 *      i.e. web passes the uri through UNMANGLED. An unconditional-normalize
 *      revert (dropping the `isWeb ? assetUri :` guard) fails.
 *
 * Comment-stripped before scanning (the rationale comments name the very
 * tokens the gate forbids). Self-test: `--self-test` proves the GOOD shapes
 * pass and each reverted BAD shape fails.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const PICKER_REL = "mingla-business/src/components/ui/CoverPicker.tsx";
const HELPER_REL = "mingla-business/src/components/ui/coverPickerVideoTrimUpload.ts";

/** Strip block comments + whole-line `//` comments so prose can't satisfy/trip. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Collapse whitespace so multi-line exprs match on a single normalized line. */
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

/** Scan the CoverPicker call site (rule A). */
function scanPicker(src) {
  const failures = [];
  const s = normalize(src);
  const callsHelper =
    /resolveRawClipUploadUri\(\s*asset\.uri\s*,\s*Platform\.OS\s*===\s*["']web["']\s*\)/.test(
      s,
    );
  if (!callsHelper) {
    failures.push(
      "A: CoverPicker.tsx raw-clip branch no longer calls " +
        'resolveRawClipUploadUri(asset.uri, Platform.OS === "web") — the web ' +
        "video-cover uri is no longer routed through the platform split (ORCH-1303).",
    );
  }
  if (/uri\s*:\s*normalizeLocalFileUri\(\s*asset\.uri\s*\)/.test(s)) {
    failures.push(
      "A: CoverPicker.tsx carries the unconditional mangle " +
        "`uri: normalizeLocalFileUri(asset.uri)` again — on web this prefixes " +
        "file:// onto the blob: URL (file://blob:…) and the web TUS fetch() " +
        "rejects, re-breaking every web video cover (ORCH-1303).",
    );
  }
  return failures;
}

/** Scan the helper definition (rule B). */
function scanHelper(src) {
  const failures = [];
  const s = normalize(src);
  if (!/resolveRawClipUploadUri\s*=/.test(s)) {
    failures.push(
      "B: coverPickerVideoTrimUpload.ts no longer defines resolveRawClipUploadUri " +
        "— the ORCH-1303 web/native uri split is gone.",
    );
  }
  if (
    !/isWeb\s*\?\s*assetUri\s*:\s*normalizeLocalFileUri\(\s*assetUri\s*\)/.test(s)
  ) {
    failures.push(
      "B: resolveRawClipUploadUri no longer returns the raw uri on web " +
        "(`isWeb ? assetUri : normalizeLocalFileUri(assetUri)`) — dropping the " +
        "`isWeb ? assetUri :` guard normalizes the web blob: URL again and " +
        "re-breaks the web video-cover upload (ORCH-1303).",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const PICKER_OK = `
    const uploadFile = trimResult !== null
      ? await buildTrimmedVideoUploadFile({ trimResult })
      : {
          bytes: asset.fileSize ?? 0,
          durationMs: normalizePickerDurationMs(asset.duration),
          uri: resolveRawClipUploadUri(asset.uri, Platform.OS === "web"),
        };`;
  const PICKER_BAD_MANGLE = `
    const uploadFile = trimResult !== null
      ? await buildTrimmedVideoUploadFile({ trimResult })
      : {
          bytes: asset.fileSize ?? 0,
          durationMs: normalizePickerDurationMs(asset.duration),
          uri: normalizeLocalFileUri(asset.uri),
        };`;
  const HELPER_OK = `
    export const resolveRawClipUploadUri = (assetUri, isWeb) =>
      isWeb ? assetUri : normalizeLocalFileUri(assetUri);`;
  const HELPER_BAD_UNCONDITIONAL = `
    export const resolveRawClipUploadUri = (assetUri, isWeb) =>
      normalizeLocalFileUri(assetUri);`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) {
      console.error(`ORCH-1303 self-test FAIL: ${label} should have failed but passed.`);
      process.exit(1);
    }
    if (!expectFail && failures.length !== 0) {
      console.error(
        `ORCH-1303 self-test FAIL: ${label} should have passed but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  // GOOD shapes pass.
  check("picker GOOD", scanPicker(PICKER_OK), false);
  check("helper GOOD", scanHelper(HELPER_OK), false);

  // BAD shapes (each a plausible revert) fail.
  check("picker BAD (unconditional mangle)", scanPicker(PICKER_BAD_MANGLE), true);
  check("helper BAD (unconditional normalize)", scanHelper(HELPER_BAD_UNCONDITIONAL), true);

  console.log(
    "ORCH-1303 gate self-test PASS (4/4: 2 fixed shapes pass; 2 reverts fail).",
  );
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1303 gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = [
  ...scanPicker(read(PICKER_REL)),
  ...scanHelper(read(HELPER_REL)),
];

if (failures.length > 0) {
  console.error(
    "ORCH-1303 gate FAIL — the web cover-video uri regressed:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nOn business WEB the picked video's blob: object URL MUST reach the " +
      "uploader UNMANGLED (resolveRawClipUploadUri, web branch). Prefixing " +
      "file:// (normalizeLocalFileUri) corrupts it to file://blob:… and the " +
      "web TUS fetch() rejects. See ORCH-1303.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1303 gate PASS — web raw-clip cover video uri passes through unmangled " +
    "(resolveRawClipUploadUri web branch); native still normalizes; the " +
    "unconditional file://blob: mangle is gone.",
);
