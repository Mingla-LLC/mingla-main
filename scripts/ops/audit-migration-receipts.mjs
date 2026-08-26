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
 * A migration declares its own hold with a STRUCTURED token:
 *
 *   -- @migration-hold: <reason>
 *
 * Deliberately not prose-sniffing. The obvious heuristic — look for "DO NOT
 * APPLY" in the header — matches 8 migrations that say "DO NOT APPLY from MCP"
 * or "from the worktree", which means "the ORCHESTRATOR applies this", not
 * "hold indefinitely". All 8 are applied. A heuristic hold list would have
 * silently suppressed 8 real migrations from the audit — turning the one tool
 * that catches missing schema into the thing that hides it.
 *
 * So a hold is opt-in, machine-readable, and carries a reason. Prose cannot
 * trigger it by accident.
 */
export const HOLD_RE = /^--\s*@migration-hold:\s*(\S.*)$/m;

export function readHoldDeclarations(dir, files, readFile) {
  const held = new Map();
  for (const f of files) {
    const m = HOLD_RE.exec(readFile(path.join(dir, f.file)));
    if (m !== null) held.set(f.version, m[1].trim());
  }
  return held;
}

/**
 * #2614 — receipts are NOT keyed consistently, so version-matching alone lies.
 *
 * 27 receipts in production carry an APPLY-TIME timestamp instead of the file's
 * version prefix — `orch_1271_single_admin_gate` is stamped `20260703102955`
 * while its file is `20261204000000_orch_1271_single_admin_gate.sql`. Comparing
 * versions reported 34 "missing receipts" when 25 of them were already there
 * under a different key.
 *
 * That false signal is not cosmetic. It is the same haystack that hid #2291's
 * constraint for four months, and it very nearly caused a second wrong answer:
 * a version-only audit says MISSING, and the obvious response — stamp it — adds
 * a duplicate rather than fixing anything.
 *
 * So identity is the NAME, and the version is only a key. A file whose name
 * already has a receipt is RECONCILED whatever version that receipt carries.
 */
export function indexByName(receipts) {
  const byName = new Map();
  for (const r of receipts) {
    if (typeof r.name !== "string" || r.name.length === 0) continue;
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r.version);
  }
  return byName;
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
export function auditReceipts({ files, receipts, probed = {}, held = [] }) {
  const receiptVersions = new Set(receipts.map((r) => r.version));
  const fileVersions = new Set(files.map((f) => f.version));
  const byName = indexByName(receipts);
  const heldSet = new Set(held);

  // Receipts keyed by version, carrying the names stamped under that version.
  // `schema_migrations` is keyed on VERSION ALONE, so when two files share a
  // 14-digit prefix only ONE of them can ever be stamped — and a version-match
  // check reports the pair as fully reconciled while the second file has no
  // receipt and, worse, would be SKIPPED by `migration up` as already applied.
  // Six such pairs exist today. This is the #2291 bug class exactly.
  const byVersion = new Map();
  for (const r of receipts) {
    if (!byVersion.has(r.version)) byVersion.set(r.version, []);
    byVersion.get(r.version).push(r.name ?? null);
  }

  // A file is reconciled when a receipt bears ITS name (under any version), or
  // when the receipt at its version is unnamed — 35 legacy receipts have a NULL
  // name, and for those the version is the only evidence available.
  const isReconciled = (f) => {
    if (byName.has(f.name)) return true;
    const names = byVersion.get(f.version);
    return names !== undefined && names.some((n) => n === null);
  };

  const malformedReceipts = receipts
    .filter((r) => !RECEIPT_VERSION_RE.test(r.version))
    .map((r) => r.version);

  // A receipt under ANY version counts. Version-keyed matching alone produced
  // 25 false gaps.
  const missing = files.filter((f) => !isReconciled(f));
  // Same name, different version — reconciled, but the keys disagree.
  const keyMismatch = files.filter((f) =>
    !receiptVersions.has(f.version) && byName.has(f.name)
  ).map((f) => ({ ...f, receiptVersions: byName.get(f.name) }));

  // Two files, one version — only one can ever hold a receipt.
  const versionCollisions = [];
  const seenVersion = new Map();
  for (const f of files) {
    if (seenVersion.has(f.version)) {
      versionCollisions.push({
        version: f.version,
        files: [seenVersion.get(f.version).file, f.file],
      });
    } else seenVersion.set(f.version, f);
  }

  const unappliedGap = [];
  const appliedUnstamped = [];
  const unknown = [];
  const deliberatelyHeld = [];
  for (const f of missing) {
    // An OPERATOR-GATED migration is not a gap. 20260922000000 carries
    // "Apply ONLY after Seth confirms ... on his explicit go" in its own header
    // and is CORRECTLY unapplied. Without this it is re-reported forever, and a
    // finding that cries wolf every run is one people learn to skip.
    if (heldSet.has(f.version)) deliberatelyHeld.push(f);
    else if (probed[f.version] === true) appliedUnstamped.push(f);
    else if (probed[f.version] === false) unappliedGap.push(f);
    else unknown.push(f);
  }

  // A receipt is only orphaned if NO file claims its name either. 25 of the 27
  // that a version-only check called orphans are simply apply-time keys for
  // files that are present.
  const fileNames = new Set(files.map((f) => f.name));
  const orphanReceipts = receipts
    .filter((r) =>
      RECEIPT_VERSION_RE.test(r.version) &&
      !fileVersions.has(r.version) &&
      !(typeof r.name === "string" && fileNames.has(r.name))
    )
    .map((r) => r.version);

  return {
    fileCount: files.length,
    receiptCount: receipts.length,
    unappliedGap,
    appliedUnstamped,
    unknown,
    deliberatelyHeld,
    keyMismatch,
    orphanReceipts,
    versionCollisions,
    malformedReceipts,
    // `deliberatelyHeld` and `keyMismatch` do NOT make a ledger dirty: the first
    // is a decision, the second is a naming inconsistency with no missing state.
    clean: unappliedGap.length === 0 && appliedUnstamped.length === 0 &&
      unknown.length === 0 && malformedReceipts.length === 0 &&
      versionCollisions.length === 0,
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
  // #2614 — a file whose NAME already has a receipt is reconciled, whatever
  // version that receipt carries. Version-only matching called 25 of these
  // "missing" and would have had us stamp 25 duplicates.
  const km = auditReceipts({
    files: [{ version: "20261204000000", name: "single_gate", file: "x.sql" }],
    receipts: [{ version: "20260703102955", name: "single_gate" }],
  });
  if (km.unknown.length !== 0) fail("a name-matched receipt was called missing");
  if (km.keyMismatch.length !== 1) fail("key mismatch not surfaced");
  if (km.orphanReceipts.length !== 0) fail("a name-matched receipt was called an orphan");
  if (!km.clean) fail("key mismatch alone must not make a ledger dirty");
  // An operator-gated migration is a DECISION, not a gap.
  const hold = auditReceipts({
    files: [{ version: "20260922000000", name: "drop_is_admin", file: "y.sql" }],
    receipts: [],
    held: ["20260922000000"],
  });
  if (hold.deliberatelyHeld.length !== 1) fail("held migration not classified");
  if (hold.unknown.length !== 0) fail("held migration double-counted as unknown");
  if (!hold.clean) fail("a deliberate hold must not make a ledger dirty");
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
    const holds = readHoldDeclarations(
      dir,
      versions,
      (fp) => fs.readFileSync(fp, "utf8"),
    );
    const result = auditReceipts({
      files: versions,
      receipts,
      held: Array.from(holds.keys()),
    });
    result.holdReasons = Object.fromEntries(holds);
    result.malformedFilenames = malformed;
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`migration files : ${result.fileCount}`);
      console.log(`receipts        : ${result.receiptCount}`);
      console.log(`no receipt      : ${result.unknown.length} (probe each — a real gap and a clerical one look identical here)`);
      for (const f of result.unknown) console.log(`  - ${f.file}`);
      if (result.deliberatelyHeld.length > 0) {
        console.log(`deliberately held : ${result.deliberatelyHeld.length} (declared, not missing)`);
        for (const f of result.deliberatelyHeld) {
          console.log(`  - ${f.file}\n      reason: ${result.holdReasons[f.version]}`);
        }
      }
      if (result.keyMismatch.length > 0) {
        console.log(`key mismatch    : ${result.keyMismatch.length} (applied under an apply-time version, not the file version)`);
        for (const f of result.keyMismatch) {
          console.log(`  - ${f.file} -> receipt ${f.receiptVersions.join(", ")}`);
        }
      }
      if (result.versionCollisions.length > 0) {
        console.log(`version collisions: ${result.versionCollisions.length} (two files, one version — only one can EVER be stamped)`);
        for (const c of result.versionCollisions) {
          console.log(`  - ${c.version}\n      ${c.files.join("\n      ")}`);
        }
      }
      if (result.malformedReceipts.length > 0) {
        console.log(`malformed receipts: ${result.malformedReceipts.join(", ")}`);
      }
      if (result.orphanReceipts.length > 0) {
        console.log(`receipts with no file: ${result.orphanReceipts.join(", ")}`);
      }
    }
    process.exit(result.clean ? 0 : 1);
  }
}
