#!/usr/bin/env node
/**
 * ORCH-0770 [event-cover-video-processing] — strict-grep gate, REWRITTEN for
 * issue #964 (D-4). The live event-cover video upload path is TUS → Bunny
 * (post-META-1270 / #966, CLOSED). The pre-Bunny (Cloudinary-era) expectations
 * this gate used to pin matched ZERO times in live code, so it was held
 * `unenforced` while the surface users exercise had no coverage. This rewrite
 * pins the LIVE Bunny upload-intent + `_shared/eventCoverVideo.ts` +
 * `_shared/bunnyStream.ts` presign recipe + config.toml + PublicEventPage
 * invariants, and adds the AccessKey-absent security guard (the Bunny secret
 * must NEVER reach the client). The Bunny webhook authenticity family lives in
 * the sibling gate `orch-0770b-bunny-webhook-family.mjs`.
 *
 * NO product/edge-fn code changed by #964 — this is CI/gate-coverage only. The
 * Cloudinary residue is dead (its removal is D-7's domain, #966 CLOSED).
 *
 * RULE — the following must ALL hold, else the gate exits non-zero:
 *   upload-intent (event-cover-video-upload-intent/index.ts, comment-stripped):
 *     UI-1  invokes `bunnyCreateVideo(`            — the Bunny create leg.
 *     UI-2  invokes `bunnyPresignTusUpload(`       — the Bunny presign leg.
 *     UI-3  returns `protocol: "tus"`              — the transport discriminator.
 *     UI-4  returns ALL four presign fields (AuthorizationSignature /
 *           AuthorizationExpire / LibraryId / VideoId).
 *     UI-5  returns `provider_not_configured`      — the honest not-configured path.
 *     UI-SEC  `AccessKey` ABSENT (after comment-strip). The Bunny secret must
 *             never reach the client — the load-bearing security guard.
 *     UI-CLD  `vc_h264` / `ac_aac` / `f_mp4` ABSENT — dead Cloudinary eager
 *             transform must not return.
 *   _shared/eventCoverVideo.ts (comment-stripped):
 *     SH-1  `coverVideoProvider` returns `"bunny"` — bunny-only provider.
 *     SH-2  `assertProcessedDerivative`            — the derivative validator.
 *     SH-3  `"video/mp4"` + SH-4 `FINAL_MAX_BYTES` + SH-5 `26214400` — the 25 MiB
 *           processed budget (env default).
 *     SH-6  `MAX_SOURCE_VIDEO_BYTES` + SH-7 `104857600` — the 100 MiB source cap.
 *     SH-CLD  `verifyCloudinaryNotificationSignature` / `x-cld-timestamp` /
 *             `rawBody}${input.timestamp}` ABSENT — dead Cloudinary signing.
 *   _shared/bunnyStream.ts (comment-stripped):
 *     BS-1  the presign recipe literal
 *           `` `${libraryId}${apiKey}${authorizationExpire}${videoId}` ``.
 *   supabase/config.toml:
 *     CFG-1 `[functions.event-cover-video-webhook]` present.
 *     CFG-2 that block sets `verify_jwt = false` (third-party Bunny callbacks).
 *   PublicEventPage.tsx (comment-stripped):
 *     PP-1  `isLegacyUnsafeEventCoverVideoUrl` — no legacy unsafe MOV/QuickTime.
 *
 * Comment-stripped before scanning: prose that names AccessKey / Cloudinary /
 * "tus" to explain the pipeline must neither satisfy nor trip an assertion.
 *
 * Self-test: `node orch-0770-event-cover-video-processing.mjs --self-test`
 * proves PASS on the live shape and FAIL on each dropped live invariant AND on
 * each reintroduced Cloudinary/secret-leak shape.
 *
 * Exit: 0 = clean / self-test pass, 1 = violation.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// .github/scripts/strict-grep → up 3 = repo root (cwd-independent).
const REPO_ROOT = join(__dirname, "..", "..", "..");

const REL = {
  uploadIntent: "supabase/functions/event-cover-video-upload-intent/index.ts",
  shared: "supabase/functions/_shared/eventCoverVideo.ts",
  bunnyStream: "supabase/functions/_shared/bunnyStream.ts",
  config: "supabase/config.toml",
  publicPage: "mingla-business/src/components/event/PublicEventPage.tsx",
};

// mustExist — the whole live event-cover video surface. KEEP + extend (source-
// uploaded + the two _shared helpers added for #964).
const MUST_EXIST = [
  "supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql",
  "supabase/functions/event-cover-video-upload-intent/index.ts",
  "supabase/functions/event-cover-video-status/index.ts",
  "supabase/functions/event-cover-video-webhook/index.ts",
  "supabase/functions/event-cover-video-apply/index.ts",
  "supabase/functions/event-cover-video-cancel/index.ts",
  "supabase/functions/event-cover-video-source-uploaded/index.ts",
  "supabase/functions/_shared/eventCoverVideo.ts",
  "supabase/functions/_shared/bunnyStream.ts",
  "mingla-business/src/services/eventCoverVideoProcessingService.ts",
];

// The presign recipe is a template literal in the source; written here as a
// plain double-quoted string so `${...}` and the backticks are literal chars.
const PRESIGN_RECIPE = "`${libraryId}${apiKey}${authorizationExpire}${videoId}`";

/** Remove block + line comments so explanatory prose can neither satisfy nor
 * trip an assertion. The `[^:]` guard before `//` preserves `https://` URLs. */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Pure checker. `sources` maps logical keys → raw source text:
 *   { uploadIntent, shared, bunnyStream, config, publicPage }
 * JS/TS sources are comment-stripped internally; config.toml is scanned raw.
 * Returns an array of violation messages (empty === clean).
 */
export function scan(sources) {
  const failures = [];
  const ui = stripComments(sources.uploadIntent ?? "");
  const sh = stripComments(sources.shared ?? "");
  const bs = stripComments(sources.bunnyStream ?? "");
  const cfg = sources.config ?? "";
  const pp = stripComments(sources.publicPage ?? "");

  // ── upload-intent ──────────────────────────────────────────────────────
  if (!/\bbunnyCreateVideo\s*\(/.test(ui)) {
    failures.push("UI-1: upload-intent no longer invokes `bunnyCreateVideo(` — the Bunny create leg is gone.");
  }
  if (!/\bbunnyPresignTusUpload\s*\(/.test(ui)) {
    failures.push("UI-2: upload-intent no longer invokes `bunnyPresignTusUpload(` — the Bunny presign leg is gone.");
  }
  if (!/protocol:\s*"tus"/.test(ui)) {
    failures.push('UI-3: upload-intent no longer returns `protocol: "tus"` — the transport discriminator the client branches on is gone.');
  }
  for (const field of ["AuthorizationSignature", "AuthorizationExpire", "LibraryId", "VideoId"]) {
    if (!ui.includes(field)) {
      failures.push(`UI-4: upload-intent presign response is missing the \`${field}\` field — the client TUS create auth headers are incomplete.`);
    }
  }
  if (!ui.includes("provider_not_configured")) {
    failures.push("UI-5: upload-intent no longer returns the honest `provider_not_configured` response.");
  }
  if (/\bAccessKey\b/.test(ui)) {
    failures.push("UI-SEC: `AccessKey` appears in upload-intent CODE (comment-stripped). The Bunny library secret must NEVER reach the client — only the presigned AuthorizationSignature does. This is the load-bearing security guard.");
  }
  for (const cld of ["vc_h264", "ac_aac", "f_mp4"]) {
    if (ui.includes(cld)) {
      failures.push(`UI-CLD: dead Cloudinary eager-transform token \`${cld}\` reappeared in upload-intent. Cover video is Bunny-only (#966).`);
    }
  }

  // ── _shared/eventCoverVideo.ts ─────────────────────────────────────────
  if (!sh.includes("coverVideoProvider") || !/return\s+"bunny"/.test(sh)) {
    failures.push('SH-1: `coverVideoProvider` no longer pins `return "bunny"` — the bunny-only provider invariant is gone.');
  }
  if (!sh.includes("assertProcessedDerivative")) {
    failures.push("SH-2: `_shared` no longer exposes `assertProcessedDerivative` — the fail-closed derivative validator is gone.");
  }
  if (!sh.includes('"video/mp4"')) {
    failures.push('SH-3: `_shared` derivative validator no longer requires `"video/mp4"`.');
  }
  if (!sh.includes("FINAL_MAX_BYTES")) {
    failures.push("SH-4: `_shared` no longer defines `FINAL_MAX_BYTES` — the processed size budget is gone.");
  }
  if (!sh.includes("26214400")) {
    failures.push("SH-5: `_shared` FINAL_MAX_BYTES no longer defaults to `26214400` (25 MiB processed budget).");
  }
  if (!sh.includes("MAX_SOURCE_VIDEO_BYTES")) {
    failures.push("SH-6: `_shared` no longer defines `MAX_SOURCE_VIDEO_BYTES` — the source intake cap is gone.");
  }
  if (!sh.includes("104857600")) {
    failures.push("SH-7: `_shared` MAX_SOURCE_VIDEO_BYTES no longer defaults to `104857600` (100 MiB source cap).");
  }
  for (const cld of ["verifyCloudinaryNotificationSignature", "x-cld-timestamp", "rawBody}${input.timestamp}"]) {
    if (sh.includes(cld)) {
      failures.push(`SH-CLD: dead Cloudinary signing token \`${cld}\` reappeared in _shared/eventCoverVideo.ts. Cover video is Bunny-only (#966).`);
    }
  }

  // ── _shared/bunnyStream.ts ─────────────────────────────────────────────
  if (!bs.includes(PRESIGN_RECIPE)) {
    failures.push("BS-1: `_shared/bunnyStream.ts` no longer carries the Bunny TUS presign recipe literal `${libraryId}${apiKey}${authorizationExpire}${videoId}` — the signature recipe changed or was removed.");
  }

  // ── config.toml ────────────────────────────────────────────────────────
  if (!cfg.includes("[functions.event-cover-video-webhook]")) {
    failures.push("CFG-1: supabase/config.toml no longer configures `[functions.event-cover-video-webhook]`.");
  }
  if (!/\[functions\.event-cover-video-webhook\][\s\S]*?verify_jwt\s*=\s*false/.test(cfg)) {
    failures.push("CFG-2: event-cover-video-webhook must keep `verify_jwt = false` for third-party Bunny callbacks.");
  }

  // ── PublicEventPage.tsx ────────────────────────────────────────────────
  if (!pp.includes("isLegacyUnsafeEventCoverVideoUrl")) {
    failures.push("PP-1: PublicEventPage no longer guards legacy unsafe MOV/QuickTime cover URLs (`isLegacyUnsafeEventCoverVideoUrl`).");
  }

  return failures;
}

// ---- Self-test ----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const good = {
    // AccessKey appears ONLY in a comment here — comment-strip must remove it so
    // UI-SEC does not trip on the live shape (mirrors the real upload-intent).
    uploadIntent: [
      'import { bunnyCreateVideo, bunnyPresignTusUpload } from "../_shared/bunnyStream.ts";',
      'if (!deps.providerConfigured()) {',
      '  return jsonResponse({ error: "provider_not_configured", detail: "..." });',
      '}',
      'const create = await deps.bunnyCreateVideo(job.id);',
      'const presign = await deps.bunnyPresignTusUpload(create.guid);',
      'return jsonResponse({',
      '  upload: {',
      '    protocol: "tus",',
      '    // NO AccessKey here — only the presigned AuthorizationSignature.',
      '    fields: {',
      '      AuthorizationSignature: presign.authorizationSignature,',
      '      AuthorizationExpire: String(presign.authorizationExpire),',
      '      LibraryId: presign.libraryId,',
      '      VideoId: presign.videoId,',
      '    },',
      '  },',
      '});',
    ].join("\n"),
    shared: [
      'export function coverVideoProvider() { return "bunny"; }',
      'export function assertProcessedDerivative(input) {',
      '  if (input.mimeType !== "video/mp4") return { ok: false };',
      '}',
      'export const FINAL_MAX_BYTES = Number.parseInt(Deno.env.get("A") ?? "26214400", 10);',
      'export const MAX_SOURCE_VIDEO_BYTES = Number.parseInt(Deno.env.get("B") ?? "104857600", 10);',
    ].join("\n"),
    bunnyStream: "const authorizationSignature = await sha256Hex(`${libraryId}${apiKey}${authorizationExpire}${videoId}`);",
    config: "[functions.event-cover-video-webhook]\nverify_jwt = false\n",
    publicPage: 'import { isLegacyUnsafeEventCoverVideoUrl } from "../lib/coverMedia";',
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

  bad("drop protocol:\"tus\" trips UI-3", (s) => { s.uploadIntent = s.uploadIntent.replace('protocol: "tus",', ""); }, "UI-3:");
  bad("drop bunnyPresignTusUpload trips UI-2", (s) => { s.uploadIntent = s.uploadIntent.replaceAll("bunnyPresignTusUpload", "somethingElse"); }, "UI-2:");
  bad("drop AuthorizationSignature trips UI-4", (s) => { s.uploadIntent = s.uploadIntent.replace(/AuthorizationSignature/g, "Xxx"); }, "UI-4:");
  bad("drop provider_not_configured trips UI-5", (s) => { s.uploadIntent = s.uploadIntent.replace("provider_not_configured", "nope"); }, "UI-5:");
  bad("AccessKey in CODE trips UI-SEC", (s) => { s.uploadIntent = s.uploadIntent.replace("fields: {", 'fields: { AccessKey: apiKey,'); }, "UI-SEC:");
  bad("reintroduce vc_h264 trips UI-CLD", (s) => { s.uploadIntent = s.uploadIntent.replace("upload: {", 'eager: "vc_h264", upload: {'); }, "UI-CLD:");
  bad("drop return \"bunny\" trips SH-1", (s) => { s.shared = s.shared.replace('return "bunny"', 'return "cloudinary"'); }, "SH-1:");
  bad("drop assertProcessedDerivative trips SH-2", (s) => { s.shared = s.shared.replace(/assertProcessedDerivative/g, "xxx"); }, "SH-2:");
  bad("drop 26214400 trips SH-5", (s) => { s.shared = s.shared.replace("26214400", "999"); }, "SH-5:");
  bad("drop 104857600 trips SH-7", (s) => { s.shared = s.shared.replace("104857600", "999"); }, "SH-7:");
  bad("reintroduce verifyCloudinaryNotificationSignature trips SH-CLD", (s) => { s.shared += "\nexport const verifyCloudinaryNotificationSignature = 1;"; }, "SH-CLD:");
  bad("drop presign recipe trips BS-1", (s) => { s.bunnyStream = s.bunnyStream.replace("${apiKey}", ""); }, "BS-1:");
  bad("flip verify_jwt=true trips CFG-2", (s) => { s.config = s.config.replace("verify_jwt = false", "verify_jwt = true"); }, "CFG-2:");
  bad("drop isLegacyUnsafeEventCoverVideoUrl trips PP-1", (s) => { s.publicPage = "import { somethingElse } from \"x\";"; }, "PP-1:");

  // Comment-only AccessKey must NOT trip (comment-strip proof): the GOOD case
  // above already contains an AccessKey comment and passes — assert explicitly.
  const commentOnly = clone(good);
  commentOnly.uploadIntent += "\n// AccessKey is never returned to the client.";
  const co = scan(commentOnly);
  cases.push({ name: "comment-only AccessKey does NOT trip UI-SEC (strip proof)", ok: !co.some((m) => m.startsWith("UI-SEC:")), detail: co });

  let bad_ = 0;
  for (const c of cases) {
    console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}`);
    if (!c.ok) { bad_++; console.log(`        failures: ${JSON.stringify(c.detail)}`); }
  }
  if (bad_) {
    console.error(`\nORCH-0770 self-test FAILED: ${bad_}/${cases.length} cases.`);
    process.exit(1);
  }
  console.log(`\nORCH-0770 gate self-test PASS (${cases.length}/${cases.length}).`);
  process.exit(0);
}

// ---- Live mode ----------------------------------------------------------
const missing = MUST_EXIST.filter((p) => !existsSync(join(REPO_ROOT, p)));
if (missing.length > 0) {
  console.error("[orch-0770] missing required file(s):\n  - " + missing.join("\n  - "));
  process.exit(1);
}

let sources;
try {
  sources = {
    uploadIntent: readFileSync(join(REPO_ROOT, REL.uploadIntent), "utf8"),
    shared: readFileSync(join(REPO_ROOT, REL.shared), "utf8"),
    bunnyStream: readFileSync(join(REPO_ROOT, REL.bunnyStream), "utf8"),
    config: readFileSync(join(REPO_ROOT, REL.config), "utf8"),
    publicPage: readFileSync(join(REPO_ROOT, REL.publicPage), "utf8"),
  };
} catch (err) {
  console.error(`[orch-0770] cannot read a target file: ${err.message}`);
  process.exit(1);
}

const failures = scan(sources);
if (failures.length > 0) {
  console.error(
    "[orch-0770] event-cover video (TUS/Bunny) processing guard FAILED:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nThe LIVE upload path is TUS → Bunny (#966). A dropped Bunny invariant or a " +
      "reintroduced Cloudinary/secret-leak shape trips this gate. See issue #964.",
  );
  process.exit(1);
}
console.log("[orch-0770] event-cover video (TUS/Bunny) processing guard passed");
