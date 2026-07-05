#!/usr/bin/env node
/**
 * ORCH-1311 [web-video-duration-read-robust] — strict-grep gate.
 *
 * WHY: a gallery clip picked on Android web is a content-URI-backed File. The
 * single-shot `readBrowserVideoDurationMs` (a `<video>` + one `loadedmetadata`
 * read) failed ON-DEVICE — reproduced 2/2 on Seth's Samsung: "Could not read
 * this video's duration. Try another clip." — even though the SAME clip's bytes
 * report a finite duration when loaded in memory. Two failure modes: (1)
 * `video.duration` is Infinity/0 until a SEEK forces the browser to compute it
 * (common MP4 encodings); (2) the first metadata read misses on a just-resumed
 * tab (right after the OS photo picker) and a RETRY succeeds. The old code gave
 * up → durationMs<=0 → the pick was rejected before it could upload.
 *
 * FIX (ORCH-1311): read robustly — on a non-finite duration, seek to the end and
 * read on durationchange/timeupdate; cap each attempt with a timeout so a stuck
 * load never hangs the pick; retry the whole read once. ORCH-1308 rounding is
 * preserved (whole-ms only for the INTEGER columns).
 *
 * RULE — all must hold against coverPickerDeviceMedia.ts (comment-stripped):
 *   A. a seek-to-end forces a non-finite duration to resolve
 *      (`video.currentTime = Number.MAX_SAFE_INTEGER`), with a durationchange or
 *      timeupdate listener to read the resolved value.
 *   B. each attempt is time-capped (a setTimeout finishes the attempt).
 *   C. the read RETRIES (readBrowserVideoDurationMs calls the single-attempt
 *      helper more than once).
 *   D. the ORCH-1308 rounding survives (Math.round(video.duration * 1000)).
 *
 * Self-test (`--self-test`): GOOD (robust) passes; BAD (single-shot revert) fails.
 * Invariant I-PROPOSED-1311-WEB-VIDEO-DURATION-READ-ROBUST.
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
  if (!/currentTime\s*=\s*Number\.MAX_SAFE_INTEGER/.test(s)) {
    failures.push(
      "A: coverPickerDeviceMedia.ts no longer seeks to the end " +
        "(`video.currentTime = Number.MAX_SAFE_INTEGER`) to resolve a non-finite " +
        "duration — Infinity/0-duration clips are rejected again (ORCH-1311).",
    );
  }
  if (!/ondurationchange|ontimeupdate/.test(s)) {
    failures.push(
      "A: coverPickerDeviceMedia.ts no longer listens for durationchange/timeupdate " +
        "after the seek — the resolved duration is never read (ORCH-1311).",
    );
  }
  if (!/setTimeout\s*\(/.test(s)) {
    failures.push(
      "B: coverPickerDeviceMedia.ts video-duration read has no timeout — a stuck " +
        "content-URI load can hang the pick (ORCH-1311).",
    );
  }
  // C: the exported read must call the single-attempt helper more than once (retry).
  const onceCalls = (s.match(/readBrowserVideoDurationOnce\s*\(/g) || []).length;
  if (onceCalls < 2) {
    failures.push(
      "C: readBrowserVideoDurationMs no longer RETRIES (calls " +
        "readBrowserVideoDurationOnce at least twice) — a missed first metadata " +
        "read on a just-resumed tab is not recovered (ORCH-1311).",
    );
  }
  if (!/Math\.round\(\s*video\.duration\s*\*\s*1000\s*\)/.test(s)) {
    failures.push(
      "D: coverPickerDeviceMedia.ts dropped the ORCH-1308 whole-ms rounding " +
        "(Math.round(video.duration * 1000)) — a fractional ms breaks the INTEGER " +
        "column insert (ORCH-1311 must preserve ORCH-1308).",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const GOOD = `
    const readBrowserVideoDurationOnce = (uri) => new Promise((resolve) => {
      const video = document.createElement("video");
      const finiteMs = () => Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 1000) : null;
      video.onloadedmetadata = () => {
        const ms = finiteMs(); if (ms !== null) return resolve(ms);
        video.ondurationchange = () => { const m=finiteMs(); if(m!==null) resolve(m); };
        video.ontimeupdate = () => { const m=finiteMs(); if(m!==null) resolve(m); };
        try { video.currentTime = Number.MAX_SAFE_INTEGER; } catch { resolve(null); }
      };
      const timer = setTimeout(() => resolve(finiteMs()), 6000);
      video.src = uri;
    });
    const readBrowserVideoDurationMs = async (uri) => {
      const first = await readBrowserVideoDurationOnce(uri);
      if (first !== null && first > 0) return first;
      return readBrowserVideoDurationOnce(uri);
    };`;
  const BAD_SINGLE_SHOT = `
    const readBrowserVideoDurationMs = async (uri) => new Promise((resolve) => {
      const video = document.createElement("video");
      video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null);
      video.onerror = () => resolve(null);
      video.src = uri;
    });`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) {
      console.error(`ORCH-1311 self-test FAIL: ${label} should have failed but passed.`);
      process.exit(1);
    }
    if (!expectFail && failures.length !== 0) {
      console.error(
        `ORCH-1311 self-test FAIL: ${label} should have passed but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  check("robust GOOD", scan(GOOD), false);
  check("single-shot BAD", scan(BAD_SINGLE_SHOT), true);

  console.log("ORCH-1311 gate self-test PASS (2/2).");
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1311 gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = scan(read(REL));

if (failures.length > 0) {
  console.error(
    "ORCH-1311 gate FAIL — the web video duration read regressed to a fragile " +
      "single shot:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nA picked content-URI video's duration MUST be read robustly (seek to " +
      "resolve Infinity/0 + retry + timeout), or gallery video covers fail with " +
      "'Could not read this video's duration'. See ORCH-1311.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1311 gate PASS — video duration read seeks to resolve non-finite " +
    "durations, retries, and is time-capped (keeps ORCH-1308 whole-ms rounding).",
);
