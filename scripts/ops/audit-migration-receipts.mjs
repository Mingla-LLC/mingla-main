#!/usr/bin/env node
/**
 * #2598 — migration receipt audit.
 *
 * `supabase_migrations.schema_migrations` is supposed to answer "what is
 * applied to production". On 2026-08-25 it could not: six migrations on `main`
 * had no receipt. Three were applied-but-unstamped, two were Ari's, and one —
 * `20270425002291`, the campaign-payload CHECK — had genuinely never reached
 * the database, so production still accepted the exact malformed payload that
 * constraint was written to reject. A ledger nobody can trust is what made all
 * three classes invisible.
 *
 * The audit itself was always one query. Nothing ran it. This is that query,
 * runnable, with the classification the eyeball version left implicit.
 *
 * Read-only. It never applies, stamps, or repairs anything — the whole point is
 * that each of those is a reviewed, deliberate act. `supabase db push` is
 * explicitly unsafe on this project while drift exists.
 *
 * Usage:
 *   node scripts/ops/audit-migration-receipts.mjs            # human summary
 *   node scripts/ops/audit-migration-receipts.mjs --json     # machine-readable
 *   node scripts/ops/audit-migration-receipts.mjs --self-test
 *
 * Receipts are read from stdin as JSON (`[{version,name},…]`) so this needs no
 * production credentials of its own — the caller supplies them. Deliberate: a
 * script that can reach production unattended is a liability, and this one is
 * meant to be run by a human holding the connection.
 */

import fs from "node:fs";
import path from "node:path";

export const VERSION_RE = /^(\d{14})_([a-z0-9_]+)\.sql$/;

/** A version that a receipt row may legally carry. */
export const RECEIPT_VERSION_RE = /^\d{14}$/;

/**
 * Read migration versions off disk.
 * Files that do not match the canonical shape are returned separately rather
 * than skipped — a malformed filename is how the receipt `version='2462.sql'`
 * got into production in the first place.
 */
export function readMigrationFiles(dir) {
  const versions = [];
  const malformed = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith(".sql")) continue;
    const m = VERSION_RE.exec(entry);
    if (m === null) malformed.push(entry);
    else versions.push({ version: m[1], name: m[2], file: entry });
  }
  return { versions, malformed };
}

/**
 * Classify every difference between the files on disk and the receipts.
 *
 * `probed` maps version -> boolean "its objects exist in production", supplied
 * by the caller. Without it a missing receipt is AMBIGUOUS: it could be an
 * unapplied migration (a real gap) or an applied-but-unstamped one
 * (bookkeeping). Collapsing those two into one bucket is exactly the mistake
 * that let a real gap hide among clerical ones.
 */
export function auditReceipts({ files, receipts, probed = {} }) {
  const receiptVersions = new Set(receipts.map((r) => r.version));
  const fileVersions = new Set(files.map((f) => f.version));

  const malformedReceipts = receipts
    .filter((r) => !RECEIPT_VERSION_RE.test(r.version))
    .map((r) => r.version);

  const missing = files.filter((f) => !receiptVersions.has(f.version));
  const unappliedGap = [];
  const appliedUnstamped = [];
  const unknown = [];
  for (const f of missing) {
    if (probed[f.version] === true) appliedUnstamped.push(f);
    else if (probed[f.version] === false) unappliedGap.push(f);
    else unknown.push(f);
  }

  const orphanReceipts = receipts
    .filter((r) =>
      RECEIPT_VERSION_RE.test(r.version) && !fileVersions.has(r.version)
    )
    .map((r) => r.version);

  return {
    fileCount: files.length,
    receiptCount: receipts.length,
    unappliedGap,
    appliedUnstamped,
    unknown,
    orphanReceipts,
    malformedReceipts,
    clean: unappliedGap.length === 0 && appliedUnstamped.length === 0 &&
      unknown.length === 0 && malformedReceipts.length === 0,
  };
}

function selfTest() {
  const files = [
    { version: "20270101000001", name: "a", file: "20270101000001_a.sql" },
    { version: "20270101000002", name: "b", file: "20270101000002_b.sql" },
    { version: "20270101000003", name: "c", file: "20270101000003_c.sql" },
  ];
  const receipts = [
    { version: "20270101000001", name: "a" },
    { version: "2462.sql", name: "2462" },
    { version: "20260101000009", name: "gone" },
  ];
  const r = auditReceipts({
    files,
    receipts,
    probed: { "20270101000002": true, "20270101000003": false },
  });
  const fail = (m) => {
    console.error(`SELF-TEST FAIL: ${m}`);
    process.exit(1);
  };
  if (r.appliedUnstamped.length !== 1) fail("applied-unstamped not classified");
  if (r.unappliedGap.length !== 1) fail("real gap not classified");
  if (r.malformedReceipts.length !== 1) fail("malformed receipt not caught");
  if (r.orphanReceipts.length !== 1) fail("orphan receipt not caught");
  if (r.clean) fail("a dirty ledger reported clean");
  // A clean ledger must report clean, or the check carries no information.
  const ok = auditReceipts({
    files: [files[0]],
    receipts: [receipts[0]],
    probed: {},
  });
  if (!ok.clean) fail("a clean ledger reported dirty");
  console.log("SELF-TEST PASSED");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const dir = path.resolve("supabase/migrations");
    const { versions, malformed } = readMigrationFiles(dir);
    const stdin = fs.readFileSync(0, "utf8").trim();
    const receipts = stdin.length > 0 ? JSON.parse(stdin) : [];
    const result = auditReceipts({ files: versions, receipts });
    result.malformedFilenames = malformed;
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`migration files : ${result.fileCount}`);
      console.log(`receipts        : ${result.receiptCount}`);
      console.log(`no receipt      : ${result.unknown.length} (probe each — a real gap and a clerical one look identical here)`);
      for (const f of result.unknown) console.log(`  - ${f.file}`);
      if (result.malformedReceipts.length > 0) {
        console.log(`malformed receipts: ${result.malformedReceipts.join(", ")}`);
      }
      if (result.orphanReceipts.length > 0) {
        console.log(`receipts with no file: ${result.orphanReceipts.join(", ")}`);
      }
    }
    process.exit(result.unknown.length === 0 && result.malformedReceipts.length === 0 ? 0 : 1);
  }
}
