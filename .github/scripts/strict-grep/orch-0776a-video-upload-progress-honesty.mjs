#!/usr/bin/env node
/**
 * ORCH-0776a [video-upload-progress-honesty] — strict-grep gate, REWRITTEN for
 * issue #964 (D-4). The live event-cover upload reports REAL byte progress over
 * TUS: `emitUploadProgress` derives percent from actual bytes, and the web XHR
 * transport feeds it `event.loaded`/`event.total`. The determinate progress bar
 * moved from the retired Expo `createUploadTask` / `CreatorStep4Cover` copy to
 * `CoverPicker.tsx` (`width: `${videoPercent}%``). This gate pins that honest
 * byte-progress path and forbids a fabricated processing percentage.
 *
 * NO product/edge-fn code changed by #964 — CI/gate-coverage only.
 *
 * RULE — the following must ALL hold, else the gate exits non-zero:
 *   service (eventCoverVideoProcessingService.ts, comment-stripped):
 *     SV-1  `EventCoverVideoUploadProgress`         — the progress contract type.
 *     SV-2  `emitUploadProgress`                    — the byte-progress emitter.
 *     SV-3  `(bytesSent / bytesTotal) * 100`        — the real byte math.
 *     SV-4  `bytesSent` + `bytesTotal`              — the byte fields.
 *     SV-5  `xhr.upload.onprogress`                 — the web XHR real-progress hook.
 *     SV-6  `event.loaded` + `event.total`          — the real XHR byte counts.
 *     SV-CLD  `createUploadTask` ABSENT             — the dead Expo path must not return.
 *   CoverPicker.tsx (comment-stripped):
 *     CP-1  the determinate bar literal `` width: `${videoPercent}%` ``.
 *     CP-2  `videoUpload.stage.percent`             — the bar is fed real stage %.
 *     CP-NOFAB  the `videoStageCopy` block carries NO fabricated processing % —
 *               it must not bind a `%` to the "Almost ready"/processing phase.
 *
 * Self-test: `node orch-0776a-video-upload-progress-honesty.mjs --self-test`
 * proves PASS on the live shape and FAIL on each dropped byte-progress invariant
 * AND on a fabricated processing percentage / a reintroduced Expo upload task.
 *
 * Exit: 0 = clean / self-test pass, 1 = violation.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const REL = {
  service: "mingla-business/src/services/eventCoverVideoProcessingService.ts",
  coverPicker: "mingla-business/src/components/ui/CoverPicker.tsx",
};

// Written as a plain double-quoted string so the backticks and `${...}` are
// literal chars matched verbatim against the source.
const DETERMINATE_BAR = "width: `${videoPercent}%`";

export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Isolate the `const videoStageCopy = ... ;` assignment (up to its first `;`).
 * Returns the assignment body, or null if the site could not be located. */
export function videoStageCopyBlock(src) {
  const m = /const\s+videoStageCopy\s*=([\s\S]*?);/.exec(src);
  return m === null ? null : m[1];
}

/**
 * Pure checker. `sources` maps { service, coverPicker } → raw source text.
 * Both are comment-stripped internally. Returns violation messages.
 */
export function scan(sources) {
  const failures = [];
  const svc = stripComments(sources.service ?? "");
  const cp = stripComments(sources.coverPicker ?? "");

  // ── service byte-progress ──────────────────────────────────────────────
  if (!svc.includes("EventCoverVideoUploadProgress")) {
    failures.push("SV-1: service no longer exposes the `EventCoverVideoUploadProgress` progress contract type.");
  }
  if (!svc.includes("emitUploadProgress")) {
    failures.push("SV-2: service no longer has `emitUploadProgress` — the byte-progress emitter is gone.");
  }
  if (!svc.includes("(bytesSent / bytesTotal) * 100")) {
    failures.push("SV-3: service no longer derives percent from real bytes `(bytesSent / bytesTotal) * 100` — progress may be fabricated.");
  }
  if (!svc.includes("bytesSent") || !svc.includes("bytesTotal")) {
    failures.push("SV-4: service no longer carries the `bytesSent`/`bytesTotal` byte fields.");
  }
  if (!svc.includes("xhr.upload.onprogress")) {
    failures.push("SV-5: service web transport no longer wires `xhr.upload.onprogress` — the real-progress hook is gone.");
  }
  if (!svc.includes("event.loaded") || !svc.includes("event.total")) {
    failures.push("SV-6: service web transport no longer reads `event.loaded`/`event.total` — the real XHR byte counts are gone.");
  }
  if (svc.includes("createUploadTask")) {
    failures.push("SV-CLD: the dead Expo `createUploadTask` path reappeared in the service. Upload is TUS-only (#966).");
  }

  // ── CoverPicker determinate UI ─────────────────────────────────────────
  if (!cp.includes(DETERMINATE_BAR)) {
    failures.push("CP-1: CoverPicker no longer renders the determinate bar literal `width: `${videoPercent}%`` — the progress bar is not byte-determinate.");
  }
  if (!cp.includes("videoUpload.stage.percent")) {
    failures.push("CP-2: CoverPicker no longer feeds the bar `videoUpload.stage.percent` — the real stage percent source is gone.");
  }
  const block = videoStageCopyBlock(cp);
  if (block === null) {
    failures.push("CP-NOFAB: could not locate the `const videoStageCopy = ...;` assignment — the stage-copy site moved or was removed; a fabricated processing % can no longer be ruled out.");
  } else {
    if (/Almost ready[^"'`]*%/.test(block)) {
      failures.push("CP-NOFAB: the processing-phase copy (`Almost ready...`) now carries a numeric `%`. Processing progress is indeterminate — no fabricated percentage.");
    }
    if (/Processing[^"'`]*\$\{[^}]*percent/.test(block)) {
      failures.push("CP-NOFAB: the processing-phase copy interpolates a `percent` value. Processing progress is indeterminate — no fabricated percentage.");
    }
  }

  return failures;
}

// ---- Self-test ----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const good = {
    service: [
      "export interface EventCoverVideoUploadProgress {",
      "  bytesSent: number;",
      "  bytesTotal: number;",
      "  percent: number;",
      "}",
      "const emitUploadProgress = (cb, bytesSent, bytesTotal) => {",
      "  const percent = clampPercent((bytesSent / bytesTotal) * 100);",
      "  cb?.({ bytesSent, bytesTotal, percent });",
      "};",
      "xhr.upload.onprogress = (event) => {",
      "  emitUploadProgress(input.onProgress, event.loaded, event.total);",
      "};",
    ].join("\n"),
    coverPicker: [
      "const videoStageCopy =",
      '  videoUpload.stage.phase === "compressing"',
      '    ? "Compressing on your phone..."',
      '    : videoUpload.stage.phase === "uploading"',
      '      ? "Uploading..."',
      '      : videoUpload.stage.phase === "processing"',
      '        ? "Almost ready..."',
      "        : null;",
      "return (",
      "  <View style={[styles.progressFill, { width: `${videoPercent}%` }]} />",
      ");",
      "// videoPercent={videoUpload.stage.percent}",
      "const x = videoUpload.stage.percent;",
    ].join("\n"),
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const cases = [];
  const good0 = scan(good);
  cases.push({ name: "GOOD live shape passes (0 failures)", ok: good0.length === 0, detail: good0 });

  const bad = (name, mutate, wantPrefix) => {
    const s = clone(good);
    mutate(s);
    const f = scan(s);
    cases.push({ name, ok: f.some((m) => m.startsWith(wantPrefix)), detail: f });
  };

  bad("drop EventCoverVideoUploadProgress trips SV-1", (s) => { s.service = s.service.replaceAll("EventCoverVideoUploadProgress", "Foo"); }, "SV-1:");
  bad("drop emitUploadProgress trips SV-2", (s) => { s.service = s.service.replaceAll("emitUploadProgress", "foo"); }, "SV-2:");
  bad("drop byte math trips SV-3", (s) => { s.service = s.service.replace("(bytesSent / bytesTotal) * 100", "70"); }, "SV-3:");
  bad("drop xhr.upload.onprogress trips SV-5", (s) => { s.service = s.service.replace("xhr.upload.onprogress", "xhr.foo"); }, "SV-5:");
  bad("drop event.loaded/total trips SV-6", (s) => { s.service = s.service.replace("event.loaded, event.total", "0, 1"); }, "SV-6:");
  bad("reintroduce createUploadTask trips SV-CLD", (s) => { s.service += "\nconst t = FileSystem.createUploadTask(url);"; }, "SV-CLD:");
  bad("drop determinate bar trips CP-1", (s) => { s.coverPicker = s.coverPicker.replace("width: `${videoPercent}%`", "flex: 1"); }, "CP-1:");
  bad("drop stage.percent trips CP-2", (s) => { s.coverPicker = s.coverPicker.replaceAll("videoUpload.stage.percent", "0"); }, "CP-2:");
  bad("fabricated 'Almost ready ${percent}%' trips CP-NOFAB", (s) => { s.coverPicker = s.coverPicker.replace('"Almost ready..."', '`Almost ready ${videoPercent}%`'); }, "CP-NOFAB:");
  bad("fabricated 'Processing ${stage.percent}%' trips CP-NOFAB", (s) => { s.coverPicker = s.coverPicker.replace('"Almost ready..."', '`Processing ${videoUpload.stage.percent}%`'); }, "CP-NOFAB:");
  bad("removed videoStageCopy block trips CP-NOFAB", (s) => { s.coverPicker = s.coverPicker.replace(/const\s+videoStageCopy[\s\S]*?null;/, "const other = 1;"); }, "CP-NOFAB:");

  // The determinate upload bar (`${videoPercent}%`) must NOT be caught by
  // CP-NOFAB — that % is honest byte progress, not a fabricated processing %.
  // The GOOD case already contains the bar and passes; assert explicitly.
  const co = scan(good);
  cases.push({ name: "determinate upload % is NOT flagged as fabricated (scope proof)", ok: !co.some((m) => m.startsWith("CP-NOFAB:")), detail: co });

  let bad_ = 0;
  for (const c of cases) {
    console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`);
    if (!c.ok) { bad_++; console.log(`        failures: ${JSON.stringify(c.detail)}`); }
  }
  if (bad_) {
    console.error(`\nORCH-0776a self-test FAILED: ${bad_}/${cases.length} cases.`);
    process.exit(1);
  }
  console.log(`\nORCH-0776a gate self-test PASS (${cases.length}/${cases.length}).`);
  process.exit(0);
}

// ---- Live mode ----------------------------------------------------------
let sources;
try {
  sources = {
    service: readFileSync(join(REPO_ROOT, REL.service), "utf8"),
    coverPicker: readFileSync(join(REPO_ROOT, REL.coverPicker), "utf8"),
  };
} catch (err) {
  console.error(`[orch-0776a] cannot read a target file: ${err.message}`);
  process.exit(1);
}

const failures = scan(sources);
if (failures.length > 0) {
  console.error(
    "[orch-0776a] video upload progress honesty guard FAILED:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nThe LIVE upload reports REAL byte progress over TUS (emitUploadProgress + XHR " +
      "event.loaded/total), and CoverPicker renders a byte-determinate bar with NO fabricated " +
      "processing %. See issue #964.",
  );
  process.exit(1);
}
console.log("[orch-0776a] video upload progress honesty guard passed");
