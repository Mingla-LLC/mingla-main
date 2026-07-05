#!/usr/bin/env node
/**
 * ORCH-1308 [web-video-duration-integer] — strict-grep gate.
 *
 * WHY: `event_cover_video_jobs.source_duration_ms` / `trim_start_ms` /
 * `trim_end_ms` are INTEGER columns (source_bytes is bigint). The web cover path
 * reads `<video>.duration` — FRACTIONAL seconds — and multiplied by 1000 it
 * yields a non-integer millisecond (e.g. a 17.97s clip → 17971.995). That value
 * flowed unrounded into the `event-cover-video-upload-intent` edge INSERT, so
 * Postgres rejected it: "invalid input syntax for type integer: 17971.995" →
 * detail `job_insert_failed` → HTTP 500 → the client toast "Could not create a
 * video processing job." (deterministically confirmed in the prod postgres
 * logs). This is why web video covers never uploaded.
 *
 * FIX (ORCH-1308) — round to a whole millisecond at every site that feeds those
 * integer columns:
 *   A. edge `event-cover-video-upload-intent`: Math.round() sourceDurationMs,
 *      trimStartMs, trimEndMs (and source_bytes) at derivation — the
 *      AUTHORITATIVE server gate that protects the columns from ANY client.
 *   B. client `coverPickerDeviceMedia.ts` `readBrowserVideoDurationMs`:
 *      Math.round(video.duration * 1000) — round at the browser read (the
 *      origin of the fractional value).
 *   C. client `coverPickerVideoTrimUpload.ts` `normalizePickerDurationMs`:
 *      returns a rounded (whole-ms) value.
 *
 * Self-test (`--self-test`): the GOOD (post-fix) shapes pass; the un-rounded
 * reverts fail. Invariant I-PROPOSED-1308-VIDEO-DURATION-INTEGER.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const EDGE_REL = "supabase/functions/event-cover-video-upload-intent/index.ts";
const DEVICE_REL = "mingla-business/src/components/ui/coverPickerDeviceMedia.ts";
const NORMALIZE_REL = "mingla-business/src/components/ui/coverPickerVideoTrimUpload.ts";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

/** Rule A — edge rounds the integer-bound fields at derivation. */
function scanEdge(src) {
  const failures = [];
  const s = normalize(src);
  const rounds = (field) =>
    new RegExp(`Math\\.round\\(\\s*Number\\(\\s*body\\.${field}`).test(s);
  for (const field of ["sourceDurationMs", "trimStartMs", "trimEndMs"]) {
    if (!rounds(field)) {
      failures.push(
        `A: event-cover-video-upload-intent does not Math.round(Number(body.${field})) ` +
          `at derivation — a fractional value can reach the INTEGER column and fail ` +
          `the INSERT (ORCH-1308).`,
      );
    }
  }
  return failures;
}

/** Rule B — the browser duration read is rounded. */
function scanDevice(src) {
  const failures = [];
  const s = normalize(src);
  if (!/Math\.round\(\s*video\.duration\s*\*\s*1000\s*\)/.test(s)) {
    failures.push(
      "B: coverPickerDeviceMedia.ts readBrowserVideoDurationMs no longer rounds " +
        "`video.duration * 1000` — the fractional browser duration reaches the " +
        "INTEGER source_duration_ms column (ORCH-1308).",
    );
  }
  return failures;
}

/** Rule C — normalizePickerDurationMs returns a rounded value. */
function scanNormalize(src) {
  const failures = [];
  const s = normalize(src);
  // The function body must Math.round its computed ms before returning.
  if (!/normalizePickerDurationMs[\s\S]{0,400}Math\.round\(/.test(s)) {
    failures.push(
      "C: coverPickerVideoTrimUpload.ts normalizePickerDurationMs no longer " +
        "Math.round()s its result — a fractional duration flows to the INTEGER " +
        "columns (ORCH-1308).",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const EDGE_OK = `
    const sourceBytes = Math.round(Number(body.sourceBytes ?? 0));
    const sourceDurationMs = Math.round(Number(body.sourceDurationMs ?? 0));
    const trimStartMs = Math.round(Number(body.trimStartMs ?? 0));
    const rawTrimEndMs = Math.round(Number(body.trimEndMs ?? sourceDurationMs));
    const trimEndMs = Math.min(rawTrimEndMs, MAX_DURATION_MS);`;
  const EDGE_BAD = `
    const sourceDurationMs = Number(body.sourceDurationMs ?? 0);
    const trimStartMs = Number(body.trimStartMs ?? 0);
    const rawTrimEndMs = Number(body.trimEndMs ?? sourceDurationMs);`;
  const DEVICE_OK = `
    const duration = Number.isFinite(video.duration)
      ? Math.round(video.duration * 1000) : null;`;
  const DEVICE_BAD = `
    const duration = Number.isFinite(video.duration) ? video.duration * 1000 : null;`;
  const NORMALIZE_OK = `
    export const normalizePickerDurationMs = (duration) => {
      if (typeof duration !== "number") return 0;
      const ms = duration > 0 && duration < 1000 ? duration * 1000 : duration;
      return Math.round(ms);
    };`;
  const NORMALIZE_BAD = `
    export const normalizePickerDurationMs = (duration) => {
      if (typeof duration !== "number") return 0;
      return duration > 0 && duration < 1000 ? duration * 1000 : duration;
    };`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) {
      console.error(`ORCH-1308 self-test FAIL: ${label} should have failed but passed.`);
      process.exit(1);
    }
    if (!expectFail && failures.length !== 0) {
      console.error(
        `ORCH-1308 self-test FAIL: ${label} should have passed but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  check("edge GOOD", scanEdge(EDGE_OK), false);
  check("edge BAD (unrounded)", scanEdge(EDGE_BAD), true);
  check("device GOOD", scanDevice(DEVICE_OK), false);
  check("device BAD (unrounded)", scanDevice(DEVICE_BAD), true);
  check("normalize GOOD", scanNormalize(NORMALIZE_OK), false);
  check("normalize BAD (unrounded)", scanNormalize(NORMALIZE_BAD), true);

  console.log("ORCH-1308 gate self-test PASS (6/6: 3 rounded shapes pass; 3 reverts fail).");
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1308 gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = [
  ...scanEdge(read(EDGE_REL)),
  ...scanDevice(read(DEVICE_REL)),
  ...scanNormalize(read(NORMALIZE_REL)),
];

if (failures.length > 0) {
  console.error(
    "ORCH-1308 gate FAIL — a video-cover duration can reach an INTEGER column " +
      "unrounded:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nEvery ms that feeds event_cover_video_jobs.source_duration_ms / " +
      "trim_*_ms MUST be a whole integer (a browser <video>.duration is " +
      "fractional). See ORCH-1308.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1308 gate PASS — the edge rounds source_duration/trim fields; the web " +
    "browser duration read + normalizePickerDurationMs round to whole ms.",
);
