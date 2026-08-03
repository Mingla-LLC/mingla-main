#!/usr/bin/env node
/**
 * #966 [Cloudinary residue removal] —
 * I-PROPOSED-966-COVER-VIDEO-PROVIDER-BUNNY-ONLY.
 *
 * WHY: cover-video is Bunny-only in production. The Cloudinary upload / webhook /
 * signature / config path was removed as dead residue post-META-1270. This gate
 * asserts none of the REMOVED upload/webhook/signature symbols reappear in
 * non-test production source — a SYMBOL-TARGETED absence check, deliberately NOT
 * a blanket /cloudinary/i grep (that would trip the intentionally-retained render
 * transforms — deriveCoverPosterUrl/isVideoUrl/posterFor use `/video/upload/` —
 * the legal/terms copy, and the adCreative example-host hint string, none of
 * which this gate touches).
 *
 * Banned identifiers (unique to the removed code; scanned in non-test source
 * under supabase/functions/** and mingla-business/src/**):
 *   - cloudinarySignature
 *   - cloudinaryDestroy
 *   - verifyCloudinaryNotificationSignature
 *   - cloudinaryConfigured
 *   - cloudinaryUploadFailureDetail
 *   - uploadEventCoverVideoSourceWithXhr
 *   - uploadEventCoverVideoSourceInChunks
 *   - a `"cloudinary"` member reintroduced onto EventCoverVideoUploadProtocol
 *
 * `--self-test` injects fixtures (a planted forbidden symbol → MUST fire; a clean
 * fixture → MUST pass). Exit 0 clean / 1 violation / 2 script error.
 *
 * Model: i-proposed-1216-no-service-key-client.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const SCAN_ROOTS = ["supabase/functions", "mingla-business/src"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIR = new Set(["node_modules", ".next", "dist", "build", "out", ".turbo", "__tests__"]);
// Intentional-exception escape hatch (standard registry convention).
const ALLOW_MARKER = "orch-strict-grep-allow cover-video-bunny-only";

const BANNED = [
  { name: "cloudinarySignature", re: /\bcloudinarySignature\b/ },
  { name: "cloudinaryDestroy", re: /\bcloudinaryDestroy\b/ },
  { name: "verifyCloudinaryNotificationSignature", re: /\bverifyCloudinaryNotificationSignature\b/ },
  { name: "cloudinaryConfigured", re: /\bcloudinaryConfigured\b/ },
  { name: "cloudinaryUploadFailureDetail", re: /\bcloudinaryUploadFailureDetail\b/ },
  { name: "uploadEventCoverVideoSourceWithXhr", re: /\buploadEventCoverVideoSourceWithXhr\b/ },
  { name: "uploadEventCoverVideoSourceInChunks", re: /\buploadEventCoverVideoSourceInChunks\b/ },
  // The retired "cloudinary" member reintroduced onto the transport type union.
  { name: 'EventCoverVideoUploadProtocol "cloudinary" member', re: /EventCoverVideoUploadProtocol\b[^\n]*"cloudinary"/ },
];

const isTestFile = (rel) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.includes("/__tests__/");

// Neutralize `//` and `/* */` comments to spaces (preserving newlines / line
// numbers) so the gate asserts absence of CODE usage, not narrative mentions.
// This is what keeps a retained comment like `// Replaces cloudinaryDestroy.` in
// the DO-NOT-TOUCH bunnyStream.ts from being a false positive. String literals
// are preserved so the `EventCoverVideoUploadProtocol = "cloudinary"` check still
// sees its string. Model: meta-1383-manifest-parity.mjs stripComments.
function stripComments(src) {
  let out = "";
  let state = "code"; // code | line | block | s | d | t
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; out += "  "; i++; continue; }
      if (c === "/" && c2 === "*") { state = "block"; out += "  "; i++; continue; }
      if (c === "'") { state = "s"; out += c; continue; }
      if (c === '"') { state = "d"; out += c; continue; }
      if (c === "`") { state = "t"; out += c; continue; }
      out += c;
    } else if (state === "line") {
      if (c === "\n") { state = "code"; out += c; } else out += " ";
    } else if (state === "block") {
      if (c === "*" && c2 === "/") { state = "code"; out += "  "; i++; }
      else out += c === "\n" ? c : " ";
    } else {
      // string literal — preserve content, honor escapes, watch the closer
      out += c;
      if (c === "\\") { out += c2 ?? ""; i++; continue; }
      const closer = state === "s" ? "'" : state === "d" ? '"' : "`";
      if (c === closer) state = "code";
    }
  }
  return out;
}

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(path.join(dir, e.name), files);
    } else if (SCAN_EXT.has(path.extname(e.name))) {
      files.push(path.join(dir, e.name));
    }
  }
}

function checkSource(src, relPath, failures) {
  const rawLines = src.split("\n");
  const codeLines = stripComments(src).split("\n");
  for (let i = 0; i < codeLines.length; i++) {
    // Marker is checked on the RAW line (it lives in a comment); matches run on
    // the comment-stripped CODE line.
    if ((rawLines[i] ?? "").includes(ALLOW_MARKER)) continue;
    const line = codeLines[i];
    for (const { name, re } of BANNED) {
      if (re.test(line)) {
        failures.push(
          `${relPath}:${i + 1}: reintroduced retired cover-video symbol "${name}" — ` +
            `cover-video is Bunny-only (I-PROPOSED-966-COVER-VIDEO-PROVIDER-BUNNY-ONLY). ` +
            `The Cloudinary upload/webhook/signature path was removed as dead residue.`,
        );
      }
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (src) => {
    const f = [];
    checkSource(src, "fixture.ts", f);
    return f;
  };

  // (a) Clean fixture (retained render + kept provider field) → MUST pass.
  const good =
    `const posterUrl = url.replace("/video/upload/", "/video/upload/so_0/");\n` +
    `type UploadIntentResponse = { provider?: "cloudinary" | "bunny" };\n` +
    `export type EventCoverVideoUploadProtocol = "tus";\n`;
  if (run(good).length !== 0) {
    selfFailures.push("clean render/provider fixture wrongly flagged");
  }

  // (b) A removed upload/webhook/signature symbol → MUST fire.
  for (const planted of [
    `const s = await cloudinarySignature(params);`,
    `await cloudinaryDestroy(publicId);`,
    `verifyCloudinaryNotificationSignature(input);`,
    `if (cloudinaryConfigured()) {}`,
    `const d = cloudinaryUploadFailureDetail(body, status);`,
    `return uploadEventCoverVideoSourceWithXhr(input);`,
    `return uploadEventCoverVideoSourceInChunks(input);`,
    `export type EventCoverVideoUploadProtocol = "cloudinary" | "tus";`,
  ]) {
    if (run(planted).length === 0) {
      selfFailures.push(`planted forbidden line not flagged: ${planted}`);
    }
  }

  // (c) The allowlist marker suppresses a match (intentional-exception path).
  const allowed = `const s = await cloudinarySignature(params); // ${ALLOW_MARKER} — legacy shim`;
  if (run(allowed).length !== 0) {
    selfFailures.push("allowlist marker did not suppress the match");
  }

  if (selfFailures.length) {
    console.error("#966 I-PROPOSED-966-COVER-VIDEO-PROVIDER-BUNNY-ONLY self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "#966 I-PROPOSED-966-COVER-VIDEO-PROVIDER-BUNNY-ONLY self-test PASS (10/10 cases).",
  );
  process.exit(0);
}

// ---- Live mode
const files = [];
for (const root of SCAN_ROOTS) {
  const abs = path.join(repoRoot, root);
  if (!fs.existsSync(abs)) {
    console.error(
      `#966 gate FAIL — scan root not found at ${abs} (gate path out of sync).`,
    );
    process.exit(2);
  }
  walk(abs, files);
}
// P-vacuous: a scan that matched zero source files is a failure, never a pass.
if (files.length === 0) {
  console.error(
    "#966 gate FAIL — discovered ZERO source files under " +
      SCAN_ROOTS.join(", ") +
      ". A gate that matches nothing must fail, not pass.",
  );
  process.exit(2);
}

const failures = [];
for (const f of files) {
  const rel = path.relative(repoRoot, f);
  if (isTestFile(rel)) continue;
  checkSource(fs.readFileSync(f, "utf8"), rel, failures);
}

if (failures.length > 0) {
  console.error(
    "#966 I-PROPOSED-966-COVER-VIDEO-PROVIDER-BUNNY-ONLY FAIL — a retired Cloudinary\n" +
      "cover-video upload/webhook/signature symbol reappeared in non-test production\n" +
      "source. Cover-video is Bunny-only.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  `#966 I-PROPOSED-966-COVER-VIDEO-PROVIDER-BUNNY-ONLY PASS — scanned ${files.length} ` +
    `source files under ${SCAN_ROOTS.join(", ")}; no retired cover-video symbol present.`,
);
