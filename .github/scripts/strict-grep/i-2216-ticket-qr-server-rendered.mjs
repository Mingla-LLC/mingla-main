#!/usr/bin/env node
/**
 * issue #2216 [ticket QR renders as a blank white square] + issue #2197
 * [blanket @ts-ignore on the QR import] — strict-grep gate.
 *
 * WHAT HAPPENED. A guest's pass showed a blank white square on the
 * confirmation screen. `TicketQrCarousel` draws a plain white <View> whenever
 * `qrImageDataUrl` is missing, and the free-reservation producer
 * (`ticket-checkout-create`, third producer of confirm-screen tickets, added
 * by #2136 after ORCH-0932 wired the other two) never asked for an image. The
 * failure was silent end to end: no error, no log, HTTP 200.
 *
 * Three invariants, each covering one way that silence gets rebuilt:
 *
 *   I-2216-QR-IMAGE-SINGLE-OWNER — EVERY edge function that answers a buyer
 *     with tickets renders the QR through `attachQrImageDataUrls` from
 *     `_shared/ticketQrImage.ts`. Scope: ticket-checkout-create, -confirm,
 *     -status. A producer that maps tickets itself is a producer that can
 *     forget the image, which is exactly what #2216 was.
 *
 *   I-2197-QR-IMPORT-NOT-SUPPRESSED — `_shared/ticketQrImage.ts` carries NO
 *     `@ts-ignore`, and its qrcode import is typed by the local declaration
 *     file with the directive on the line IMMEDIATELY above the import. A
 *     blank line or an intervening comment silently detaches `@ts-types` (the
 *     placement trap proven on #2160), so adjacency is checked, not presence.
 *
 *   I-2216-CAROUSEL-PLACEHOLDER-GUARD-INTACT — the carousel keeps its
 *     `imageDataUrl.length > 0` guard. That guard is HONEST: it is what makes
 *     a missing image visible instead of rendering a broken <Image>. The fix
 *     for a blank pass is correct data, never a deleted guard.
 *
 * Comments are stripped before scanning (except where adjacency is the point),
 * so historical references in headers do not false-positive.
 *
 * Exit codes:
 *   0 — clean
 *   1 — violation
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");

const QR_HELPER = "supabase/functions/_shared/ticketQrImage.ts";
const QR_TYPES = "supabase/functions/_shared/qrcodeModule.d.ts";
const CAROUSEL = "mingla-business/src/components/checkout/TicketQrCarousel.tsx";

/** Every edge function that hands a buyer a ticket it expects to be scanned. */
const TICKET_PRODUCERS = [
  "supabase/functions/ticket-checkout-create/index.ts",
  "supabase/functions/ticket-checkout-confirm/index.ts",
  "supabase/functions/ticket-checkout-status/index.ts",
];

const ALL_FILES = [QR_HELPER, QR_TYPES, CAROUSEL, ...TICKET_PRODUCERS];

const QRCODE_IMPORT = /^\s*import\s+QRCode\s+from\s+["']https:\/\/esm\.sh\/qrcode@/;
const TS_TYPES_DIRECTIVE = /^\s*\/\/\s*@ts-types\s*=\s*["']\.\/qrcodeModule\.d\.ts["']\s*$/;
/**
 * A `@ts-ignore` DIRECTIVE — a line-comment that starts with it. Deliberately
 * NOT a bare substring search: the file's own header explains why the
 * suppression was removed, and a gate that cannot tell an explanation from a
 * directive would force the explanation out of the code.
 */
const TS_IGNORE_DIRECTIVE = /^[ \t]*\/\/[ \t]*@ts-ignore\b/m;

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Pure verdict. `files` maps each scoped path to its raw content, or null if
 * absent. Pushes { file, msg } into `violations`. Never touches disk.
 */
export function check(files, violations) {
  for (const rel of ALL_FILES) {
    if (files[rel] == null) {
      violations.push({
        file: rel,
        msg: "Scoped file missing — issue #2216 expects this file present.",
      });
    }
  }

  // ── I-2216-QR-IMAGE-SINGLE-OWNER
  for (const rel of TICKET_PRODUCERS) {
    const raw = files[rel];
    if (raw == null) continue;
    const stripped = stripComments(raw);
    if (!/\battachQrImageDataUrls\b/.test(stripped)) {
      violations.push({
        file: rel,
        msg:
          "Does not render its tickets through `attachQrImageDataUrls` (_shared/ticketQrImage.ts) — a producer that maps tickets itself is a producer that can ship a pass with no QR image (issue #2216). I-2216-QR-IMAGE-SINGLE-OWNER.",
      });
    }
  }

  // ── I-2197-QR-IMPORT-NOT-SUPPRESSED
  const helper = files[QR_HELPER];
  if (helper != null) {
    if (TS_IGNORE_DIRECTIVE.test(helper)) {
      violations.push({
        file: QR_HELPER,
        msg:
          "`@ts-ignore` present. It disables EVERY type error on the next line, not the one it was added for — a moved export, a version bump or a typo then reaches production as a runtime failure. Use `// @ts-types=\"./qrcodeModule.d.ts\"` instead. I-2197-QR-IMPORT-NOT-SUPPRESSED.",
      });
    }
    // Adjacency is the whole point here, so scan the RAW lines.
    const lines = helper.split("\n");
    const importIdx = lines.findIndex((l) => QRCODE_IMPORT.test(l));
    if (importIdx === -1) {
      violations.push({
        file: QR_HELPER,
        msg:
          "No `import QRCode from \"https://esm.sh/qrcode@…\"` found — this gate can no longer see the import it exists to protect. I-2197-QR-IMPORT-NOT-SUPPRESSED.",
      });
    } else if (
      importIdx === 0 || !TS_TYPES_DIRECTIVE.test(lines[importIdx - 1])
    ) {
      violations.push({
        file: QR_HELPER,
        msg:
          "`// @ts-types=\"./qrcodeModule.d.ts\"` must sit on the line IMMEDIATELY above the qrcode import. A blank line or an intervening comment silently detaches it (proven on #2160) and the upstream CommonJS `export =` types come back. I-2197-QR-IMPORT-NOT-SUPPRESSED.",
      });
    }
  }

  // ── I-2216-CAROUSEL-PLACEHOLDER-GUARD-INTACT
  const carousel = files[CAROUSEL];
  if (carousel != null) {
    const stripped = stripComments(carousel);
    if (!/imageDataUrl\.length\s*>\s*0/.test(stripped)) {
      violations.push({
        file: CAROUSEL,
        msg:
          "The `imageDataUrl.length > 0` placeholder guard is gone. That guard is honest — it makes a missing pass VISIBLE instead of rendering a broken <Image>. Fix the data, never the guard. I-2216-CAROUSEL-PLACEHOLDER-GUARD-INTACT.",
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const run = (map) => {
    const v = [];
    check(map, v);
    return v;
  };

  const GOOD = {
    [QR_HELPER]: [
      "/** header mentioning @ts-ignore historically is fine */",
      '// @ts-types="./qrcodeModule.d.ts"',
      'import QRCode from "https://esm.sh/qrcode@1.5.4?bundle";',
      "export async function qrPayloadToDataUrl() {}",
      "export async function attachQrImageDataUrls() {}",
    ].join("\n"),
    [QR_TYPES]: "declare const QRCode: object;\nexport default QRCode;",
    [CAROUSEL]:
      "const ok = p.imageDataUrl !== undefined && p.imageDataUrl.length > 0;",
    ...Object.fromEntries(
      TICKET_PRODUCERS.map((p) => [
        p,
        'import { attachQrImageDataUrls } from "../_shared/ticketQrImage.ts";\nconst t = await attachQrImageDataUrls(rows);',
      ]),
    ),
  };

  if (run(GOOD).length) {
    self.push(`GOOD (single owner + adjacent @ts-types + guard) wrongly flagged: ${JSON.stringify(run(GOOD))}`);
  }

  // GOOD2 — the file EXPLAINS the removed suppression in its header. Prose in a
  // block comment is documentation, not a directive, and must not be flagged.
  const good2 = {
    ...GOOD,
    [QR_HELPER]: [
      "/**",
      " * issue #2197 — the blanket `@ts-ignore` that used to sit here is gone;",
      " * see qrcodeModule.d.ts. Do not reintroduce @ts-ignore on this import.",
      " */",
      '// @ts-types="./qrcodeModule.d.ts"',
      'import QRCode from "https://esm.sh/qrcode@1.5.4?bundle";',
      "export async function attachQrImageDataUrls() {}",
    ].join("\n"),
  };
  if (run(good2).length) {
    self.push(`GOOD2 (header PROSE mentioning @ts-ignore) wrongly flagged: ${JSON.stringify(run(good2))}`);
  }

  // BAD1 (the #2216 revert) — a producer stops using the single owner.
  const bad1 = {
    ...GOOD,
    "supabase/functions/ticket-checkout-create/index.ts":
      "const t = rows.map((r) => ({ ...r, qrPayload: r.qr_code }));",
  };
  if (run(bad1).length === 0) {
    self.push("BAD1 (create no longer calls attachQrImageDataUrls) not flagged");
  }

  // BAD2 (the #2197 revert) — the blanket suppression comes back.
  const bad2 = {
    ...GOOD,
    [QR_HELPER]: [
      "// @ts-ignore -- Deno ESM import.",
      'import QRCode from "https://esm.sh/qrcode@1.5.4?bundle";',
    ].join("\n"),
  };
  if (run(bad2).length === 0) self.push("BAD2 (@ts-ignore reintroduced) not flagged");

  // BAD3 (the #2160 placement trap) — @ts-types detached by a blank line.
  const bad3 = {
    ...GOOD,
    [QR_HELPER]: [
      '// @ts-types="./qrcodeModule.d.ts"',
      "",
      'import QRCode from "https://esm.sh/qrcode@1.5.4?bundle";',
      "export async function attachQrImageDataUrls() {}",
    ].join("\n"),
  };
  if (run(bad3).length === 0) {
    self.push("BAD3 (@ts-types detached from the import by a blank line) not flagged");
  }

  // BAD4 (the tempting shortcut) — delete the guard so pixels always "appear".
  const bad4 = {
    ...GOOD,
    [CAROUSEL]: "<Image source={{ uri: p.imageDataUrl }} />",
  };
  if (run(bad4).length === 0) {
    self.push("BAD4 (placeholder guard deleted) not flagged");
  }

  // BAD5 — the declaration file the directive points at is deleted.
  const bad5 = { ...GOOD, [QR_TYPES]: null };
  if (run(bad5).length === 0) self.push("BAD5 (qrcodeModule.d.ts missing) not flagged");

  if (self.length) {
    console.error("I-2216-TICKET-QR-SERVER-RENDERED self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-2216-TICKET-QR-SERVER-RENDERED self-test PASS (7/7 cases: 2 GOOD + 5 BAD).",
  );
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const files = {};
for (const rel of ALL_FILES) {
  const abs = join(ROOT, rel);
  files[rel] = existsSync(abs) ? readFileSync(abs, "utf8") : null;
}

const violations = [];
check(files, violations);

if (violations.length > 0) {
  console.error("\n[issue #2216 — i-2216-ticket-qr-server-rendered] VIOLATIONS:\n");
  for (const v of violations) {
    console.error(`  • ${v.file}\n    ${v.msg}\n`);
  }
  console.error(
    "A pass that will not display cannot get a guest through the door. Fix the data path, not the guard.",
  );
  process.exit(1);
}

console.log(
  "[issue #2216 — i-2216-ticket-qr-server-rendered] PASS — every buyer-facing ticket producer renders its QR through the single owner; the import is typed, not suppressed; the carousel's placeholder guard is intact.",
);
process.exit(0);
