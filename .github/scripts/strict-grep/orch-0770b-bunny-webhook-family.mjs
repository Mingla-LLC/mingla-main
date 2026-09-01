#!/usr/bin/env node
/**
 * ORCH-0770b [bunny-webhook-family] — NEW strict-grep gate, issue #964 (D-4).
 * The Bunny library webhook is the AUTHENTICITY boundary of the live event-cover
 * pipeline: it verifies a v1/hmac-sha256 signature envelope, maps the numeric
 * Bunny status, keys the owning job by `source_asset_id`, and finalizes
 * retries when a processed MP4 is not yet available. This slice is high-security enough to
 * own its own gate (the sibling `orch-0770` pins upload-intent + shared; this
 * pins webhook + presign-verify + source-uploaded Bunny-truth).
 *
 * NO product/edge-fn code changed by #964 — CI/gate-coverage only.
 *
 * RULE — the following must ALL hold, else the gate exits non-zero:
 *   webhook (event-cover-video-webhook/index.ts, comment-stripped):
 *     WH-1  `verifyBunnyWebhookSignature`           — signature verification invoked.
 *     WH-2  reads all three v1 envelope headers: `x-bunnystream-signature`,
 *           `-signature-version`, `-signature-algorithm`.
 *     WH-3  `mapBunnyStatusFromWebhook`             — WEBHOOK-enum status → lifecycle.
 *     WH-4  `assertProcessedDerivative`             — fail-closed derivative check.
 *     WH-5  keys the job on `.eq("source_asset_id", …)` — the VideoGuid job key.
 *     WH-6  `derivative_not_ready` HTTP 503          — retryable, non-mutating
 *           derivative lag; neither failure transition nor asset deletion is allowed.
 *     WH-CLD  `x-cld-timestamp` / `verifyCloudinaryNotificationSignature` ABSENT
 *             — Cloudinary webhook signing must not reappear (reintroduction guard).
 *   _shared/bunnyStream.ts (comment-stripped):
 *     BS-1  `verifyBunnyWebhookSignature` + BS-2 `"v1"` + BS-3 `"hmac-sha256"`
 *           + BS-4 `constantTimeEqual` — the v1 HMAC envelope + constant-time compare.
 *     BS-5  `mapBunnyStatusFromWebhook`.
 *     BS-6  `mapBunnyStatusFromApiVideo` + `bunnyApiVideoStatusAsWebhookStatus`
 *           — issue #2905: Bunny publishes TWO numeric status enums under the
 *           same name (webhook 3 = Finished; API video-object 4 = Finished) and
 *           they were sharing ONE unnamed mapper. Each enum must keep its own
 *           named mapper and the crossing must stay a named function.
 *   reaper (event-cover-video-reaper/index.ts, comment-stripped):
 *     RP-1  synthesises the replay body through
 *           `bunnyApiVideoStatusAsWebhookStatus`, and NEVER passes
 *           `provider.video.status` straight into the webhook `Status` field.
 *     RP-2  `COVER_VIDEO_STALL_MS` + `evaluateCoverVideoStall` — a non-terminal
 *           job must have a bounded deadline after which it fails visibly.
 *   source-uploaded (event-cover-video-source-uploaded/index.ts, comment-stripped):
 *     SU-1  `bunnyGetVideo` + SU-2 `storageSize` + SU-3 `MAX_SOURCE_VIDEO_BYTES` —
 *           source truth read from Bunny, cap enforced on the REAL stored bytes.
 *
 * Comment-stripped before scanning: prose naming Cloudinary / the headers must
 * neither satisfy nor trip an assertion.
 *
 * Self-test: `node orch-0770b-bunny-webhook-family.mjs --self-test` proves PASS
 * on the live shape and FAIL on each dropped authenticity invariant AND on a
 * reintroduced Cloudinary webhook shape.
 *
 * Exit: 0 = clean / self-test pass, 1 = violation.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const REL = {
  webhook: "supabase/functions/event-cover-video-webhook/index.ts",
  bunnyStream: "supabase/functions/_shared/bunnyStream.ts",
  sourceUploaded: "supabase/functions/event-cover-video-source-uploaded/index.ts",
  reaper: "supabase/functions/event-cover-video-reaper/index.ts",
};

export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Pure checker. `sources` maps { webhook, bunnyStream, sourceUploaded } → raw
 * source text; all comment-stripped internally. Returns violation messages.
 */
export function scan(sources) {
  const failures = [];
  const wh = stripComments(sources.webhook ?? "");
  const bs = stripComments(sources.bunnyStream ?? "");
  const su = stripComments(sources.sourceUploaded ?? "");
  const rp = stripComments(sources.reaper ?? "");

  // ── webhook authenticity + finalize ────────────────────────────────────
  if (!wh.includes("verifyBunnyWebhookSignature")) {
    failures.push("WH-1: webhook no longer invokes `verifyBunnyWebhookSignature` — the signature authenticity check is gone.");
  }
  for (const header of [
    '"x-bunnystream-signature"',
    '"x-bunnystream-signature-version"',
    '"x-bunnystream-signature-algorithm"',
  ]) {
    if (!wh.includes(header)) {
      failures.push(`WH-2: webhook no longer reads the v1 envelope header ${header} — the signature envelope is incomplete.`);
    }
  }
  if (!wh.includes("mapBunnyStatusFromWebhook")) {
    failures.push("WH-3: webhook no longer maps the numeric Bunny status via `mapBunnyStatusFromWebhook`.");
  }
  // [#2905] The webhook handler reads the WEBHOOK enum only. If it ever reaches
  // for the API video-object mapper, the two enums are being confused again.
  if (wh.includes("mapBunnyStatusFromApiVideo")) {
    failures.push("WH-7: the webhook must not use the API video-object mapper — it receives the WEBHOOK enum (#2905).");
  }
  if (!wh.includes("assertProcessedDerivative")) {
    failures.push("WH-4: webhook no longer calls `assertProcessedDerivative` — the fail-closed derivative check is gone.");
  }
  if (!/\.eq\(\s*"source_asset_id"/.test(wh)) {
    failures.push('WH-5: webhook no longer keys the owning job on `.eq("source_asset_id", …)` — the Bunny VideoGuid job key changed.');
  }
  // [TEST-MOD-APPROVED #2715 A13] Derivative propagation lag is retryable. Pin
  // both missing-derivative branches to the stable 503 response and forbid any
  // terminal mutation/destruction inside either branch.
  const retryableDerivativeBranches = wh.match(
    /if\s*\(\s*(?:best|head)\s*===\s*null\s*\)\s*\{\s*return\s+jsonResponse\(\s*\{\s*error:\s*["']derivative_not_ready["']\s*\}\s*,\s*503\s*\)\s*;\s*\}/g,
  ) ?? [];
  if (retryableDerivativeBranches.length !== 2) {
    failures.push("WH-6: missing processed derivatives must return stable `derivative_not_ready` HTTP 503 without a terminal job mutation or asset deletion.");
  }
  for (const cld of ["x-cld-timestamp", "verifyCloudinaryNotificationSignature"]) {
    if (wh.includes(cld)) {
      failures.push(`WH-CLD: dead Cloudinary webhook signing token \`${cld}\` reappeared. The cover-video webhook is Bunny-only (#966).`);
    }
  }

  // ── _shared/bunnyStream.ts signing envelope ────────────────────────────
  if (!bs.includes("verifyBunnyWebhookSignature")) {
    failures.push("BS-1: `_shared/bunnyStream.ts` no longer defines `verifyBunnyWebhookSignature`.");
  }
  if (!bs.includes('"v1"')) {
    failures.push('BS-2: the signing envelope no longer pins the `"v1"` version.');
  }
  if (!bs.includes('"hmac-sha256"')) {
    failures.push('BS-3: the signing envelope no longer pins the `"hmac-sha256"` algorithm.');
  }
  if (!bs.includes("constantTimeEqual")) {
    failures.push("BS-4: signature comparison no longer uses `constantTimeEqual` — the constant-time HMAC compare is gone.");
  }
  if (!bs.includes("mapBunnyStatusFromWebhook")) {
    failures.push("BS-5: `_shared/bunnyStream.ts` no longer defines `mapBunnyStatusFromWebhook`.");
  }
  // [#2905] Two enums, two named mappers, one named crossing. Collapsing any of
  // the three back into a single unnamed `mapBunnyStatus` is the defect that
  // wedged every cover video for 18 days.
  for (const symbol of ["mapBunnyStatusFromApiVideo", "bunnyApiVideoStatusAsWebhookStatus"]) {
    if (!bs.includes(symbol)) {
      failures.push(`BS-6: \`_shared/bunnyStream.ts\` no longer defines \`${symbol}\` — the Bunny webhook and API video-object status enums are sharing one mapper again (#2905).`);
    }
  }

  // ── reaper: the ONE sanctioned enum crossing + the stall deadline ──────
  if (!rp.includes("bunnyApiVideoStatusAsWebhookStatus")) {
    failures.push("RP-1: the reconciler no longer translates the Bunny API video-object status before replaying it as a webhook body (#2905).");
  }
  // \b keeps a diagnostic field like `apiStatus: provider.video.status` from
  // tripping this — only the synthesised webhook body key `Status:` is banned.
  if (/\bStatus:\s*provider\.video\.status/.test(rp)) {
    failures.push("RP-1: the reconciler passes the raw API video-object status straight into the webhook `Status` field — API 4 Finished would be read as still-encoding (#2905).");
  }
  for (const symbol of ["COVER_VIDEO_STALL_MS", "evaluateCoverVideoStall"]) {
    if (!rp.includes(symbol)) {
      failures.push(`RP-2: the reconciler no longer carries \`${symbol}\` — a non-terminal job can wedge forever with no failure_code (#2905).`);
    }
  }

  // ── source-uploaded Bunny truth + cap ──────────────────────────────────
  if (!su.includes("bunnyGetVideo")) {
    failures.push("SU-1: source-uploaded no longer reads source truth from Bunny via `bunnyGetVideo`.");
  }
  if (!su.includes("storageSize")) {
    failures.push("SU-2: source-uploaded no longer reads Bunny `storageSize` — it may trust the client-declared byte count.");
  }
  if (!su.includes("MAX_SOURCE_VIDEO_BYTES")) {
    failures.push("SU-3: source-uploaded no longer enforces the `MAX_SOURCE_VIDEO_BYTES` source cap.");
  }

  return failures;
}

// ---- Self-test ----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const good = {
    webhook: [
      'import { assertProcessedDerivative } from "../_shared/eventCoverVideo.ts";',
      'import { mapBunnyStatusFromWebhook, verifyBunnyWebhookSignature } from "../_shared/bunnyStream.ts";',
      'const signatureHeader = req.headers.get("x-bunnystream-signature");',
      'const signatureVersion = req.headers.get("x-bunnystream-signature-version");',
      'const signatureAlgorithm = req.headers.get("x-bunnystream-signature-algorithm");',
      "const verification = await verifyBunnyWebhookSignature({ rawBody, signatureHeader });",
      "const mapped = mapBunnyStatusFromWebhook(status);",
      '.eq("source_asset_id", videoGuid)',
      "const best = bunnyBestMp4(video.video);",
      'if (best === null) { return jsonResponse({ error: "derivative_not_ready" }, 503); }',
      "const head = await headWithRetry(best.url);",
      'if (head === null) { return jsonResponse({ error: "derivative_not_ready" }, 503); }',
      "const derivative = assertProcessedDerivative({ url, mimeType });",
    ].join("\n"),
    bunnyStream: [
      "export async function verifyBunnyWebhookSignature(input) {",
      '  if (version !== "v1") return { ok: false };',
      '  if (algorithm !== "hmac-sha256") return { ok: false };',
      "  if (!constantTimeEqual(expected, provided)) return { ok: false };",
      "}",
      "export function mapBunnyStatusFromWebhook(status) { return 'ready'; }",
      "export function mapBunnyStatusFromApiVideo(status) { return 'ready'; }",
      "export function bunnyApiVideoStatusAsWebhookStatus(status) { return 3; }",
    ].join("\n"),
    sourceUploaded: [
      'import { bunnyGetVideo } from "../_shared/bunnyStream.ts";',
      "const video = await deps.bunnyGetVideo(guid);",
      "const storageSize = video.video.storageSize;",
      "if (storageSize > MAX_SOURCE_VIDEO_BYTES) { await fail(); }",
    ].join("\n"),
    reaper: [
      'import { bunnyApiVideoStatusAsWebhookStatus, mapBunnyStatusFromApiVideo } from "../_shared/bunnyStream.ts";',
      "const webhookStatus = bunnyApiVideoStatusAsWebhookStatus(provider.video.status);",
      "const rawBody = JSON.stringify({ VideoGuid: guid, Status: webhookStatus });",
      "export const COVER_VIDEO_STALL_MS = 12 * 60 * 60 * 1000;",
      "export function evaluateCoverVideoStall(input) { return { stalled: false }; }",
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

  // The named revert demo from the SPEC: drop verifyBunnyWebhookSignature.
  bad("drop verifyBunnyWebhookSignature (webhook) trips WH-1", (s) => { s.webhook = s.webhook.replaceAll("verifyBunnyWebhookSignature", "foo"); }, "WH-1:");
  bad("drop x-bunnystream-signature-version trips WH-2", (s) => { s.webhook = s.webhook.replace('"x-bunnystream-signature-version"', '"x-foo"'); }, "WH-2:");
  bad("drop mapBunnyStatusFromWebhook (webhook) trips WH-3", (s) => { s.webhook = s.webhook.replaceAll("mapBunnyStatusFromWebhook", "foo"); }, "WH-3:");
  bad("webhook reaching for the API mapper trips WH-7", (s) => { s.webhook += "\nconst wrong = mapBunnyStatusFromApiVideo(status);"; }, "WH-7:");
  bad("drop assertProcessedDerivative trips WH-4", (s) => { s.webhook = s.webhook.replaceAll("assertProcessedDerivative", "foo"); }, "WH-4:");
  bad("drop source_asset_id keying trips WH-5", (s) => { s.webhook = s.webhook.replace('.eq("source_asset_id", videoGuid)', '.eq("id", x)'); }, "WH-5:");
  // [TEST-MOD-APPROVED #2715 A13] WH-6 rejects each unsafe historical shape.
  bad("revert derivative lag to processed_mp4_unavailable trips WH-6", (s) => { s.webhook = s.webhook.replace("derivative_not_ready", "processed_mp4_unavailable"); }, "WH-6:");
  bad("return 2xx for derivative lag trips WH-6", (s) => { s.webhook = s.webhook.replace("}, 503);", "}, 200);"); }, "WH-6:");
  bad("delete an asset during derivative lag trips WH-6", (s) => { s.webhook = s.webhook.replace('return jsonResponse({ error: "derivative_not_ready" }, 503);', 'await destroyCoverVideoAsset(existingJob); return jsonResponse({ error: "derivative_not_ready" }, 503);'); }, "WH-6:");
  bad("terminally mutate during derivative lag trips WH-6", (s) => { s.webhook = s.webhook.replace('return jsonResponse({ error: "derivative_not_ready" }, 503);', 'await supabase.rpc("cover_video_transition_job", { p_to_status: "failed" }); return jsonResponse({ error: "derivative_not_ready" }, 503);'); }, "WH-6:");
  bad("reintroduce x-cld-timestamp trips WH-CLD", (s) => { s.webhook += '\nconst t = req.headers.get("x-cld-timestamp");'; }, "WH-CLD:");
  bad("reintroduce verifyCloudinaryNotificationSignature trips WH-CLD", (s) => { s.webhook += "\nverifyCloudinaryNotificationSignature(x);"; }, "WH-CLD:");
  bad("drop \"v1\" envelope trips BS-2", (s) => { s.bunnyStream = s.bunnyStream.replace('"v1"', '"v9"'); }, "BS-2:");
  bad("drop \"hmac-sha256\" trips BS-3", (s) => { s.bunnyStream = s.bunnyStream.replace('"hmac-sha256"', '"md5"'); }, "BS-3:");
  bad("drop constantTimeEqual trips BS-4", (s) => { s.bunnyStream = s.bunnyStream.replaceAll("constantTimeEqual", "eq"); }, "BS-4:");
  bad("drop mapBunnyStatusFromWebhook (shared) trips BS-5", (s) => { s.bunnyStream = s.bunnyStream.replace("export function mapBunnyStatusFromWebhook", "export function foo"); }, "BS-5:");
  bad("collapse the API mapper back into one shared mapper trips BS-6", (s) => { s.bunnyStream = s.bunnyStream.replaceAll("mapBunnyStatusFromApiVideo", "mapBunnyStatusFromWebhook"); }, "BS-6:");
  bad("drop the named enum crossing trips BS-6", (s) => { s.bunnyStream = s.bunnyStream.replaceAll("bunnyApiVideoStatusAsWebhookStatus", "foo"); }, "BS-6:");
  bad("reaper dropping the crossing trips RP-1", (s) => { s.reaper = s.reaper.replaceAll("bunnyApiVideoStatusAsWebhookStatus", "foo"); }, "RP-1:");
  bad("reaper passing the raw API status trips RP-1", (s) => { s.reaper = s.reaper.replace("Status: webhookStatus", "Status: provider.video.status"); }, "RP-1:");
  bad("reaper dropping the stall deadline trips RP-2", (s) => { s.reaper = s.reaper.replaceAll("COVER_VIDEO_STALL_MS", "0"); }, "RP-2:");
  bad("reaper dropping the stall evaluator trips RP-2", (s) => { s.reaper = s.reaper.replaceAll("evaluateCoverVideoStall", "foo"); }, "RP-2:");
  bad("drop bunnyGetVideo trips SU-1", (s) => { s.sourceUploaded = s.sourceUploaded.replaceAll("bunnyGetVideo", "foo"); }, "SU-1:");
  bad("drop storageSize trips SU-2", (s) => { s.sourceUploaded = s.sourceUploaded.replaceAll("storageSize", "bytes"); }, "SU-2:");
  bad("drop MAX_SOURCE_VIDEO_BYTES trips SU-3", (s) => { s.sourceUploaded = s.sourceUploaded.replaceAll("MAX_SOURCE_VIDEO_BYTES", "0"); }, "SU-3:");

  // Comment-only Cloudinary mention must NOT trip WH-CLD (strip proof).
  const co = clone(good);
  co.webhook += "\n// the Cloudinary x-cld-timestamp arm was removed as dead residue.";
  const cor = scan(co);
  cases.push({ name: "comment-only Cloudinary mention does NOT trip WH-CLD (strip proof)", ok: !cor.some((m) => m.startsWith("WH-CLD:")), detail: cor });

  let bad_ = 0;
  for (const c of cases) {
    console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`);
    if (!c.ok) { bad_++; console.log(`        failures: ${JSON.stringify(c.detail)}`); }
  }
  if (bad_) {
    console.error(`\nORCH-0770b self-test FAILED: ${bad_}/${cases.length} cases.`);
    process.exit(1);
  }
  console.log(`\nORCH-0770b gate self-test PASS (${cases.length}/${cases.length}).`);
  process.exit(0);
}

// ---- Live mode ----------------------------------------------------------
const missing = Object.values(REL).filter((p) => !existsSync(join(REPO_ROOT, p)));
if (missing.length > 0) {
  console.error("[orch-0770b] missing required file(s):\n  - " + missing.join("\n  - "));
  process.exit(1);
}

let sources;
try {
  sources = {
    webhook: readFileSync(join(REPO_ROOT, REL.webhook), "utf8"),
    bunnyStream: readFileSync(join(REPO_ROOT, REL.bunnyStream), "utf8"),
    sourceUploaded: readFileSync(join(REPO_ROOT, REL.sourceUploaded), "utf8"),
    reaper: readFileSync(join(REPO_ROOT, REL.reaper), "utf8"),
  };
} catch (err) {
  console.error(`[orch-0770b] cannot read a target file: ${err.message}`);
  process.exit(1);
}

const failures = scan(sources);
if (failures.length > 0) {
  console.error(
    "[orch-0770b] Bunny webhook-family authenticity guard FAILED:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nThe LIVE cover-video webhook verifies a v1/hmac-sha256 Bunny signature, keys the job " +
      "by source_asset_id, and finalizes fail-closed; source-uploaded reads Bunny truth and caps " +
      "real bytes. A dropped authenticity invariant or a reintroduced Cloudinary shape trips this " +
      "gate. See issue #964.",
  );
  process.exit(1);
}
console.log("[orch-0770b] Bunny webhook-family authenticity guard passed");
