#!/usr/bin/env node
/**
 * ORCH-0776a [video-upload-progress-honesty] — strict-grep gate, REWRITTEN for
 * issue #964 (D-4). The live event-cover upload reports REAL byte progress over
 * TUS: `emitUploadProgress` derives percent from actual bytes, and the web XHR
 * transport feeds it `event.loaded`/`event.total`. `CoverPicker.tsx` renders
 * the canonical projection's nullable percent as an accessible scaleX bar.
 * Upload percent comes from bytes; processing percent is shown only when the
 * provider reports one. The former hardcoded "Almost ready" state is forbidden.
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
 *     CP-1  `videoProjectionCopy(stage, status)` owns truthful state copy.
 *     CP-2  `copy.percent` feeds an accessible progressbar and scaleX width.
 *     CP-NOFAB  hardcoded `Almost ready` / numeric processing progress is absent.
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
  hook: "mingla-business/src/hooks/useEventCoverVideoUpload.ts",
};

export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Pure checker. `sources` maps { service, coverPicker } → raw source text.
 * Both are comment-stripped internally. Returns violation messages.
 */
export function scan(sources) {
  const failures = [];
  const svc = stripComments(sources.service ?? "");
  const cp = stripComments(sources.coverPicker ?? "");
  const hook = stripComments(sources.hook ?? "");

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
  if (!cp.includes("videoProjectionCopy(stage, status)")) {
    failures.push("CP-1: CoverPicker no longer derives UI from the canonical `videoProjectionCopy(stage, status)` projection.");
  }
  if (!cp.includes('accessibilityRole="progressbar"') ||
      !cp.includes("scaleX: copy.percent / 100") ||
      !cp.includes("Math.round(copy.percent)")) {
    failures.push("CP-2: CoverPicker must render nullable canonical progress as an accessible scaleX determinate bar.");
  }
  const processingCopy = cp.match(/case\s+["']processing["'][\s\S]*?case\s+["']reattaching["']/)?.[0] ?? "";
  if (!processingCopy.includes("percent: stage.percent")) {
    failures.push("CP-NOFAB: processing copy must consume the canonical nullable `stage.percent`.");
  }
  if (/Almost ready/i.test(cp) || /percent\s*:\s*\d+(?:\.\d+)?\b/.test(processingCopy)) {
    failures.push("CP-NOFAB: fabricated hardcoded processing progress or the old `Almost ready` state returned.");
  }
  if (!hook.includes('phase: "processing", percent: next.progressKind === "determinate" ? next.progressPercent : null')) {
    failures.push("HOOK-NOFAB: processing projection must expose provider progress only when progressKind is determinate.");
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
      "const copy = videoProjectionCopy(stage, status);",
      'case "processing": return { title: "Processing video", percent: stage.percent };',
      'case "reattaching": return { title: "Reconnecting", percent: null };',
      '<View accessibilityRole="progressbar" accessibilityValue={{ now: Math.round(copy.percent) }}>',
      "  <View style={{ transform: [{ scaleX: copy.percent / 100 }] }} />",
      "</View>",
    ].join("\n"),
    hook: 'setStage({ phase: "processing", percent: next.progressKind === "determinate" ? next.progressPercent : null });',
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
  bad("drop canonical projection trips CP-1", (s) => { s.coverPicker = s.coverPicker.replace("videoProjectionCopy(stage, status)", "legacyCopy(stage)"); }, "CP-1:");
  bad("drop accessible determinate bar trips CP-2", (s) => { s.coverPicker = s.coverPicker.replace('accessibilityRole="progressbar"', 'accessibilityRole="none"'); }, "CP-2:");
  bad("drop scaleX percent source trips CP-2", (s) => { s.coverPicker = s.coverPicker.replace("scaleX: copy.percent / 100", "width: 70"); }, "CP-2:");
  bad("fabricated Almost ready trips CP-NOFAB", (s) => { s.coverPicker = s.coverPicker.replace("Processing video", "Almost ready"); }, "CP-NOFAB:");
  for (const value of [35, 45, 69, 70]) {
    bad(`fabricated processing ${value} trips CP-NOFAB`, (s) => { s.coverPicker = s.coverPicker.replace("percent: stage.percent", `percent: ${value}`); }, "CP-NOFAB:");
  }
  bad("literal hook progress trips HOOK-NOFAB", (s) => { s.hook = s.hook.replace('next.progressKind === "determinate" ? next.progressPercent : null', "45"); }, "HOOK-NOFAB:");

  // Honest nullable canonical/provider progress must not be flagged as fabricated.
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
    hook: readFileSync(join(REPO_ROOT, REL.hook), "utf8"),
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
