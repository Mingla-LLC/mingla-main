#!/usr/bin/env node
/**
 * ORCH-1312 [web-video-duration-retry-delay] — strict-grep gate.
 *
 * WHY: ORCH-1311 made the picked-video duration read RETRY, but retried
 * IMMEDIATELY. On Android web the read fails during the brief tab-resume window
 * right after the OS photo picker closes — deterministically confirmed on Seth's
 * Samsung: an immediate `<video>` metadata read errors, while the SAME clip/URL
 * reads a finite duration ~3s later. Back-to-back (no-delay) attempts both land
 * in that unstable window and both fail → "Could not read this video's duration"
 * → the gallery video pick is rejected before it can upload.
 *
 * FIX (ORCH-1312): space the retries out with a DELAY so a later attempt lands
 * after the tab has settled. The happy path still returns immediately.
 *
 * RULE — all must hold against coverPickerDeviceMedia.ts (comment-stripped):
 *   A. a retry-delay schedule exists (VIDEO_DURATION_RETRY_DELAYS_MS) and is a
 *      non-empty array of millisecond waits.
 *   B. the read AWAITS a delay between attempts (await + setTimeout-backed delay)
 *      — i.e. the retries are not back-to-back.
 *   C. the ORCH-1311 robustness is preserved (seek-to-end + the single-attempt
 *      helper is still called more than once).
 *
 * Self-test (`--self-test`): GOOD (delayed retries) passes; BAD (immediate
 * retry) fails. Invariant I-PROPOSED-1312-VIDEO-DURATION-RETRY-DELAY.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const REL = "mingla-business/src/components/ui/coverPickerDeviceMedia.ts";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

function scan(src) {
  const failures = [];
  const s = normalize(src);
  // A: a non-empty delay schedule array.
  if (!/VIDEO_DURATION_RETRY_DELAYS_MS\s*=\s*\[\s*\d+/.test(s)) {
    failures.push(
      "A: coverPickerDeviceMedia.ts has no VIDEO_DURATION_RETRY_DELAYS_MS delay " +
        "schedule — the duration read has no spaced retries (ORCH-1312).",
    );
  }
  // B: the read awaits a delay between attempts (setTimeout-backed).
  const awaitsDelay =
    /await\s+delay\s*\(/.test(s) ||
    /await\s+new Promise\([^)]*setTimeout/.test(s);
  const hasSetTimeoutDelayHelper =
    /const delay\s*=\s*\([^)]*\)\s*(:|=>)[\s\S]{0,80}setTimeout/.test(s);
  if (!awaitsDelay || !hasSetTimeoutDelayHelper) {
    failures.push(
      "B: coverPickerDeviceMedia.ts does not AWAIT a setTimeout-backed delay " +
        "between duration-read retries — retries fire back-to-back inside the " +
        "unstable tab-resume window (ORCH-1312).",
    );
  }
  // C: ORCH-1311 robustness preserved.
  if (!/currentTime\s*=\s*Number\.MAX_SAFE_INTEGER/.test(s)) {
    failures.push(
      "C: coverPickerDeviceMedia.ts dropped the ORCH-1311 seek-to-end — " +
        "non-finite durations no longer resolve (ORCH-1312 must preserve ORCH-1311).",
    );
  }
  const onceCalls = (s.match(/readBrowserVideoDurationOnce\s*\(/g) || []).length;
  if (onceCalls < 2) {
    failures.push(
      "C: readBrowserVideoDurationMs no longer retries the single-attempt read " +
        "(ORCH-1312 must preserve ORCH-1311's retry).",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const GOOD = `
    const VIDEO_DURATION_RETRY_DELAYS_MS = [900, 1600, 2400];
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const readBrowserVideoDurationOnce = (uri) => new Promise((r)=>{ const v=document.createElement("video"); try{v.currentTime=Number.MAX_SAFE_INTEGER;}catch{} r(null); });
    const readBrowserVideoDurationMs = async (uri) => {
      let result = await readBrowserVideoDurationOnce(uri);
      for (const wait of VIDEO_DURATION_RETRY_DELAYS_MS) {
        if (result !== null && result > 0) return result;
        await delay(wait);
        result = await readBrowserVideoDurationOnce(uri);
      }
      return result;
    };`;
  const BAD_IMMEDIATE = `
    const readBrowserVideoDurationOnce = (uri) => new Promise((r)=>{ const v=document.createElement("video"); try{v.currentTime=Number.MAX_SAFE_INTEGER;}catch{} r(null); });
    const readBrowserVideoDurationMs = async (uri) => {
      const first = await readBrowserVideoDurationOnce(uri);
      if (first !== null && first > 0) return first;
      return readBrowserVideoDurationOnce(uri);
    };`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) { console.error(`ORCH-1312 self-test FAIL: ${label} should have failed but passed.`); process.exit(1); }
    if (!expectFail && failures.length !== 0) { console.error(`ORCH-1312 self-test FAIL: ${label} should have passed but reported:\n`+failures.join("\n")); process.exit(1); }
  };
  check("delayed GOOD", scan(GOOD), false);
  check("immediate BAD", scan(BAD_IMMEDIATE), true);
  console.log("ORCH-1312 gate self-test PASS (2/2).");
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try { return readFileSync(join(REPO_ROOT, rel), "utf8"); }
  catch (err) { console.error(`ORCH-1312 gate FAIL — cannot read ${rel}: ${err.message}`); process.exit(1); }
}

const failures = scan(read(REL));
if (failures.length > 0) {
  console.error(
    "ORCH-1312 gate FAIL — the picked-video duration read retries without a " +
      "delay:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nRetries MUST be spaced out so a later attempt lands after the tab " +
      "settles from the OS photo picker; back-to-back retries both fail in the " +
      "resume window. See ORCH-1312.",
  );
  process.exit(1);
}
console.log(
  "ORCH-1312 gate PASS — the picked-video duration read spaces its retries " +
    "(VIDEO_DURATION_RETRY_DELAYS_MS + awaited delay), preserving ORCH-1311's " +
    "seek + retry.",
);
