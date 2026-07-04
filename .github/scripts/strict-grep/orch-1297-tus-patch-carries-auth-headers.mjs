#!/usr/bin/env node
/**
 * ORCH-1297 [bunny-tus-patch-auth-headers] — strict-grep gate (ORCH-1301
 * close-hardening): the Bunny TUS PATCH request MUST re-send the CREATE-time
 * auth headers, or Bunny rejects the byte upload with 400 "Library ID missing
 * or invalid" and the video cover never processes.
 *
 * WHY: in mingla-business/src/services/eventCoverVideoProcessingService.ts the
 * resumable (TUS) upload is a two-step create → PATCH. Bunny's TUS PATCH is
 * authed with the SAME headers as the CREATE (AuthorizationSignature /
 * AuthorizationExpire / LibraryId / VideoId — the server-supplied opaque
 * `input.upload.fields`). ORCH-1295 built the `patchHeaders` object with only
 * the three explicit TUS headers and DROPPED the auth fields, so the on-device
 * PATCH returned Bunny 400 "Library ID missing or invalid". The fix spreads
 * `...input.upload.fields` into `patchHeaders`. BOTH transports (native
 * expo/fetch + web XHR) consume this ONE object, so the invariant lives here.
 *
 * RULE (structural anti-recurrence) — the `patchHeaders` object literal must
 * carry ALL of the following, else exit non-zero:
 *   A. `...input.upload.fields` — the spread that re-sends the CREATE auth
 *      headers (LibraryId / AuthorizationSignature / …). Its ABSENCE is the
 *      exact ORCH-1295 regression → Bunny 400.
 *   B. an `Upload-Offset` header — a TUS PATCH without it is not a valid
 *      offset write (Bunny 400 / dropped body).
 *   C. `Content-Type: application/offset+octet-stream` — the TUS byte-stream
 *      content type.
 *   D. a `Tus-Resumable` header — the TUS protocol version marker.
 *
 * Comment-stripped before scanning: the fix comment itself names the four auth
 * fields + "Upload-Offset" to explain the bug, so it must not satisfy or trip
 * an assertion. The checks are SCOPED to the `patchHeaders` object body so the
 * unrelated CREATE headers (`Tus-Resumable` / `Upload-Length` / `Upload-Metadata`
 * a few lines above) cannot mask a regression in the PATCH object.
 *
 * Self-test: `node orch-1297-tus-patch-carries-auth-headers.mjs --self-test`
 * proves the gate PASSES on the fixed shape and FAILS on (1) the spread dropped
 * (the ORCH-1295 mistake) and (2) Upload-Offset dropped.
 *
 * Exit: 0 = clean / self-test pass, 1 = violation.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// .github/scripts/strict-grep → up 3 = repo root (cwd-independent).
const REPO_ROOT = join(__dirname, "..", "..", "..");
const TARGET_REL =
  "mingla-business/src/services/eventCoverVideoProcessingService.ts";

/** Remove block comments + line comments (whole-line and trailing) so
 * explanatory prose can neither satisfy nor trip an assertion. The `[^:]`
 * guard before `//` preserves `https://` URLs inside string literals. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Body of the flat `const patchHeaders = { ... }` object literal (no nested
 * braces in it), or null if the object could not be located. */
function patchHeadersBody(src) {
  const m = /const\s+patchHeaders\s*=\s*\{([^}]*)\}/.exec(src);
  return m === null ? null : m[1];
}

/** Scan a source string. Returns an array of violation messages. */
function scan(src) {
  const failures = [];
  const s = stripComments(src);

  const body = patchHeadersBody(s);
  if (body === null) {
    failures.push(
      "could not locate the `const patchHeaders = { ... }` object in " +
        "uploadEventCoverVideoSourceViaTus — the TUS PATCH header site moved or " +
        "was removed. The PATCH auth headers can no longer be verified.",
    );
    return failures;
  }

  // A — the spread that re-sends the CREATE auth headers.
  if (!/\.\.\.input\.upload\.fields\b/.test(body)) {
    failures.push(
      "A: `patchHeaders` no longer spreads `...input.upload.fields`. Bunny's " +
        "TUS PATCH is authed with the SAME headers as the CREATE " +
        "(AuthorizationSignature / AuthorizationExpire / LibraryId / VideoId). " +
        "Without the spread the PATCH returns 400 \"Library ID missing or " +
        "invalid\" and the video cover never uploads (the exact ORCH-1295 " +
        "regression). Restore `...input.upload.fields` in patchHeaders (ORCH-1297).",
    );
  }

  // B — the TUS offset header.
  if (!/["']Upload-Offset["']/.test(body)) {
    failures.push(
      "B: `patchHeaders` is missing the `Upload-Offset` header. A TUS PATCH " +
        "without an offset is not a valid byte write → Bunny 400 / dropped body " +
        "(ORCH-1297).",
    );
  }

  // C — the TUS byte-stream content type.
  if (
    !/["']Content-Type["']\s*:\s*["']application\/offset\+octet-stream["']/.test(
      body,
    )
  ) {
    failures.push(
      "C: `patchHeaders` is missing `Content-Type: application/offset+octet-stream`. " +
        "TUS requires this content type on the PATCH byte stream (ORCH-1297).",
    );
  }

  // D — the TUS protocol marker.
  if (!/["']Tus-Resumable["']/.test(body)) {
    failures.push(
      "D: `patchHeaders` is missing the `Tus-Resumable` header — the TUS " +
        "protocol version marker (ORCH-1297).",
    );
  }

  return failures;
}

// ---- npm wiring check: the gate must be wired into package.json so CI runs it.
function npmWiringFailures() {
  const failures = [];
  const pkgPath = join(REPO_ROOT, "mingla-business", "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (error) {
    failures.push(
      `ORCH-1297 wiring: cannot parse mingla-business/package.json: ${error.message}`,
    );
    return failures;
  }
  const script = pkg.scripts?.["test:orch-1297"];
  if (
    typeof script !== "string" ||
    !script.includes("orch-1297-tus-patch-carries-auth-headers.mjs")
  ) {
    failures.push(
      "ORCH-1297 wiring: mingla-business/package.json scripts[\"test:orch-1297\"] " +
        "must run `orch-1297-tus-patch-carries-auth-headers.mjs` (the gate) so CI " +
        "exercises this invariant.",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const HEADER_COMMENT =
    "// ORCH-1297 — Bunny's TUS PATCH requires the SAME auth headers as the " +
    "CREATE (AuthorizationSignature / AuthorizationExpire / LibraryId / VideoId), " +
    "including Upload-Offset. Without them the PATCH returns 400.";
  const FIXTURE = (bodyLines) =>
    `export const uploadEventCoverVideoSourceViaTus = async (input) => {\n` +
    `  const patchUrl = resolveTusLocation(input.upload.url, location);\n` +
    `  ${HEADER_COMMENT}\n` +
    `  const patchHeaders = {\n${bodyLines}\n  };\n` +
    `  return null;\n};\n`;

  const OK_BODY =
    `    ...input.upload.fields,\n` +
    `    "Content-Type": "application/offset+octet-stream",\n` +
    `    "Tus-Resumable": "1.0.0",\n` +
    `    "Upload-Offset": "0",`;

  // GOOD — spread + all TUS headers present: PASS.
  let f = scan(FIXTURE(OK_BODY));
  if (f.length !== 0) {
    console.error(
      "ORCH-1297 self-test FAIL: the fixed shape (spread + all TUS headers) " +
        "reported failures:\n" + f.join("\n"),
    );
    process.exit(1);
  }

  // BAD 1 — the spread dropped (the ORCH-1295 mistake): FAIL on A.
  const noSpread =
    `    "Content-Type": "application/offset+octet-stream",\n` +
    `    "Tus-Resumable": "1.0.0",\n` +
    `    "Upload-Offset": "0",`;
  f = scan(FIXTURE(noSpread));
  if (!f.some((m) => m.startsWith("A:"))) {
    console.error(
      "ORCH-1297 self-test FAIL: dropping `...input.upload.fields` did NOT trip " +
        "check A:\n" + f.join("\n"),
    );
    process.exit(1);
  }

  // BAD 2 — Upload-Offset dropped: FAIL on B.
  const noOffset =
    `    ...input.upload.fields,\n` +
    `    "Content-Type": "application/offset+octet-stream",\n` +
    `    "Tus-Resumable": "1.0.0",`;
  f = scan(FIXTURE(noOffset));
  if (!f.some((m) => m.startsWith("B:"))) {
    console.error(
      "ORCH-1297 self-test FAIL: dropping `Upload-Offset` did NOT trip check B:\n" +
        f.join("\n"),
    );
    process.exit(1);
  }

  // BAD 3 — the comment alone (which names the auth fields + Upload-Offset) must
  // NOT satisfy the checks once the object body is emptied: FAIL on A + B.
  const empty = `    "Tus-Resumable": "1.0.0",`;
  f = scan(FIXTURE(empty));
  if (!f.some((m) => m.startsWith("A:")) || !f.some((m) => m.startsWith("B:"))) {
    console.error(
      "ORCH-1297 self-test FAIL: the explanatory comment masked a missing spread/" +
        "offset (comment-stripping is broken):\n" + f.join("\n"),
    );
    process.exit(1);
  }

  console.log(
    "ORCH-1297 gate self-test PASS (4/4: fixed shape passes; dropped spread, " +
      "dropped Upload-Offset, and comment-only each fail).",
  );
  process.exit(0);
}

// ---- Live mode
let src;
try {
  src = readFileSync(join(REPO_ROOT, TARGET_REL), "utf8");
} catch (err) {
  console.error(
    `ORCH-1297 gate FAIL — cannot read ${TARGET_REL}: ${err.message}`,
  );
  process.exit(1);
}

const failures = [...scan(src), ...npmWiringFailures()];
if (failures.length > 0) {
  console.error(
    `ORCH-1297 gate FAIL — the Bunny TUS PATCH no longer re-sends its auth ` +
      `headers in ${TARGET_REL}:\n\n  - ` +
      failures.join("\n  - ") +
      "\n\nThe TUS PATCH is authed with the SAME headers as the CREATE. Dropping " +
      "`...input.upload.fields` (or Upload-Offset / Content-Type / Tus-Resumable) " +
      "makes Bunny reject the byte upload with 400 \"Library ID missing or " +
      "invalid\" and the video cover never processes. See ORCH-1295 / ORCH-1297.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1297 gate PASS — patchHeaders spreads `...input.upload.fields` and " +
    "carries Upload-Offset / Content-Type: application/offset+octet-stream / " +
    "Tus-Resumable; the TUS PATCH re-sends its Bunny auth headers.",
);
