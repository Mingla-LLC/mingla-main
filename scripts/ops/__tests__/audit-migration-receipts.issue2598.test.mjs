/**
 * #2598 happy-path — the audit that nobody ran.
 *
 * A CHECK constraint merged on 2026-04-25 never reached production. It stayed
 * invisible because `schema_migrations` had six versions with no receipt and
 * no way to tell a real gap from a clerical one — so the whole set read as
 * bookkeeping noise and the one that mattered hid inside it.
 *
 * FAILS ON REVERT: collapse the classification back into a single "missing"
 * bucket and the separation tests below go red.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditReceipts,
  indexByName,
  readHoldDeclarations,
  readMigrationFiles,
  RECEIPT_VERSION_RE,
  VERSION_RE,
} from "../audit-migration-receipts.mjs";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const f = (v) => ({ version: v, name: "x", file: `${v}_x.sql` });

test("#2598 a real gap is not lumped in with bookkeeping", () => {
  const r = auditReceipts({
    files: [f("20270425002291"), f("20270223001687")],
    receipts: [],
    probed: { "20270425002291": false, "20270223001687": true },
  });
  assert.equal(r.unappliedGap.length, 1, "the real gap must stand alone");
  assert.equal(r.unappliedGap[0].version, "20270425002291");
  assert.equal(r.appliedUnstamped.length, 1);
  assert.equal(r.appliedUnstamped[0].version, "20270223001687");
});

test("#2598 an unprobed version is UNKNOWN, never assumed applied", () => {
  // Assuming applied is how a real gap becomes invisible. The audit must
  // refuse to guess.
  const r = auditReceipts({ files: [f("20270425002291")], receipts: [] });
  assert.equal(r.unknown.length, 1);
  assert.equal(r.unappliedGap.length, 0);
  assert.equal(r.appliedUnstamped.length, 0);
  assert.equal(r.clean, false);
});

test("#2598 a malformed receipt version is caught", () => {
  // Production carried `version='2462.sql', name='2462'` alongside the real
  // 20270522002462 receipt.
  const r = auditReceipts({
    files: [f("20270522002462")],
    receipts: [
      { version: "20270522002462", name: "ok" },
      { version: "2462.sql", name: "2462" },
    ],
  });
  assert.deepEqual(r.malformedReceipts, ["2462.sql"]);
  assert.equal(r.clean, false);
});

test("#2598 a receipt with no file on disk is surfaced", () => {
  const r = auditReceipts({
    files: [f("20270101000001")],
    receipts: [
      // [TEST-MOD-APPROVED #2614] name matches the file helper's "x".
      { version: "20270101000001", name: "x" },
      { version: "20260101000009", name: "deleted" },
    ],
  });
  assert.deepEqual(r.orphanReceipts, ["20260101000009"]);
});

test("#2598 a fully-reconciled ledger reports clean", () => {
  // Vacuity guard: if this cannot pass, every other assertion is meaningless.
  const r = auditReceipts({
    files: [f("20270101000001")],
    // [TEST-MOD-APPROVED #2614] The receipt must carry the FILE'S name. This
    // fixture said name "a" for a file named "x" and still expected clean —
    // it only passed because matching was version-only. Under identity
    // matching that pairing is exactly the masking bug #2614 fixes.
    receipts: [{ version: "20270101000001", name: "x" }],
  });
  assert.equal(r.clean, true);
  assert.equal(r.unknown.length, 0);
});

test("#2598 every migration on disk has a canonical filename", () => {
  // The malformed `2462.sql` receipt had to come from somewhere. A filename
  // that does not carry a 14-digit version is how a bad receipt gets minted.
  const { versions, malformed } = readMigrationFiles(
    path.join(REPO, "supabase", "migrations"),
  );
  assert.deepEqual(malformed, [], `non-canonical migration filenames: ${malformed}`);
  assert.ok(versions.length > 150, `expected the full history, got ${versions.length}`);
});

/**
 * SIX version slots on `main` are each carried by TWO migrations. Only one of
 * each pair can hold the receipt, so six migrations can never be represented in
 * `schema_migrations` at all — which is precisely the blindness that let
 * #2291's constraint go missing unnoticed.
 *
 * Verified against production 2026-08-25: every SHADOWED migration's objects
 * exist, so all twelve are applied. This is a ledger-representation defect, not
 * six more real gaps. Receipt holder in brackets:
 *
 *   20260612000000  orch_426_discover_scale          [tr4_refund_tiers_booking_deadline]
 *   20260615000000  orch_426_discover_cache_gzip     [orch_0877_patch_event_when_rpc]
 *   20261012000000  orch_1148_2_2_engine_anon_grant  [orch_1150_rsvp_maybe]
 *   20261113000000  orch_1172_rsvp_edit_privacy      [orch_1161_golive_marketing_optout]
 *   20261116000000  orch_1186_a_hours_single_owner   [orch_1187_reconcile_stuck_checkouts_cron]
 *   20261117000000  orch_1186b_venue_intelligence    [_orch_1188_orders_event_date_id]
 *
 * NOT renamed to repair. Renaming makes the shadowed half look unapplied, and
 * these are not uniformly idempotent — orch-426's `CREATE INDEX
 * idx_events_discover_feed` carries no IF NOT EXISTS, so a replay errors. The
 * damage is cosmetic; the repair is not. Pinned instead, and any SEVENTH fails.
 */
const GRANDFATHERED_DUPLICATE_VERSIONS = new Set([
  "20260612000000",
  "20260615000000",
  "20261012000000",
  "20261113000000",
  "20261116000000",
  "20261117000000",
]);

test("#2598 no NEW migration may share a version prefix", () => {
  const { versions } = readMigrationFiles(
    path.join(REPO, "supabase", "migrations"),
  );
  const seen = new Map();
  const duplicates = [];
  for (const v of versions) {
    if (seen.has(v.version)) duplicates.push(v.version);
    seen.set(v.version, v.file);
  }
  const unexpected = duplicates.filter(
    (v) => !GRANDFATHERED_DUPLICATE_VERSIONS.has(v),
  );
  assert.deepEqual(
    unexpected,
    [],
    `new duplicate migration version(s) — a colliding version means one of them can NEVER be stamped: ${unexpected}`,
  );
});

test("#2598 every grandfathered duplicate still exists — vacuity guard", () => {
  // An exemption for a collision that no longer exists is a permanent hole in
  // the check. If someone repairs one properly, this says so rather than
  // letting the exemption quietly widen the blind spot again.
  const { versions } = readMigrationFiles(
    path.join(REPO, "supabase", "migrations"),
  );
  for (const v of GRANDFATHERED_DUPLICATE_VERSIONS) {
    const count = versions.filter((x) => x.version === v).length;
    assert.equal(
      count,
      2,
      `${v} is no longer duplicated — remove it from GRANDFATHERED_DUPLICATE_VERSIONS`,
    );
  }
});

test("#2598 the version patterns agree with each other", () => {
  // The filename regex captures exactly what the receipt regex accepts —
  // otherwise a legal file could mint an illegal receipt.
  const m = VERSION_RE.exec("20270425002291_issue_2291_campaign_payload_shape.sql");
  assert.ok(m !== null);
  assert.ok(RECEIPT_VERSION_RE.test(m[1]));
});

// ---------------------------------------------------------------------------
// #2614 — identity is the NAME; the version is only a key.
// ---------------------------------------------------------------------------

test("#2614 a receipt under a DIFFERENT version still counts as reconciled", () => {
  // 27 production receipts carry an apply-time timestamp instead of the file's
  // version. Version-only matching called 25 of them missing, and the obvious
  // response — stamp them — adds a duplicate instead of fixing anything.
  const r = auditReceipts({
    files: [{ version: "20261204000000", name: "orch_1271_single_admin_gate", file: "a.sql" }],
    receipts: [{ version: "20260703102955", name: "orch_1271_single_admin_gate" }],
  });
  assert.equal(r.unknown.length, 0, "a name-matched receipt is not missing");
  assert.equal(r.unappliedGap.length, 0);
  assert.equal(r.keyMismatch.length, 1, "but the key disagreement is surfaced");
  assert.deepEqual(r.keyMismatch[0].receiptVersions, ["20260703102955"]);
  assert.equal(r.clean, true, "a key mismatch alone is not a dirty ledger");
});

test("#2614 that same receipt is NOT reported as an orphan", () => {
  // The mirror error: version-only matching calls it BOTH a missing file and an
  // orphan receipt — two false findings from one naming inconsistency.
  const r = auditReceipts({
    files: [{ version: "20261204000000", name: "orch_1271_single_admin_gate", file: "a.sql" }],
    receipts: [{ version: "20260703102955", name: "orch_1271_single_admin_gate" }],
  });
  assert.deepEqual(r.orphanReceipts, []);
});

test("#2614 a receipt whose name matches NO file is still an orphan", () => {
  // Vacuity guard for the rule above. Two of the 27 are genuinely orphaned —
  // production state with no migration file that ever existed in git.
  const r = auditReceipts({
    files: [{ version: "20261204000000", name: "kept", file: "a.sql" }],
    receipts: [
      { version: "20261204000000", name: "kept" },
      { version: "20260703164418", name: "orch_1276_identity_admin_write_rpcs" },
    ],
  });
  assert.deepEqual(r.orphanReceipts, ["20260703164418"]);
});

test("#2614 an operator-gated migration is a DECISION, not a gap", () => {
  // 20260922000000 says in its own header: "Apply ONLY after Seth confirms
  // ... on his explicit go". Reporting it as a gap every run is how a finding
  // becomes noise people learn to skip.
  const f = { version: "20260922000000", name: "drop_is_admin", file: "b.sql" };
  const held = auditReceipts({ files: [f], receipts: [], held: [f.version] });
  assert.equal(held.deliberatelyHeld.length, 1);
  assert.equal(held.unknown.length, 0, "must not be double-counted");
  assert.equal(held.clean, true);

  // Without the hold list the SAME input is unknown — proves the flag is doing
  // the work, not something incidental.
  const unheld = auditReceipts({ files: [f], receipts: [] });
  assert.equal(unheld.unknown.length, 1);
  assert.equal(unheld.clean, false);
});

test("#2614 indexByName ignores receipts with no usable name", () => {
  // 35 production receipts have a NULL name; they must not collapse together
  // into one bucket and start matching arbitrary files.
  const idx = indexByName([
    { version: "1", name: null },
    { version: "2", name: "" },
    { version: "3", name: "real" },
  ]);
  assert.equal(idx.size, 1);
  assert.deepEqual(idx.get("real"), ["3"]);
});

// ---------------------------------------------------------------------------
// #2614 — the hold token is OPT-IN. Prose must never trigger it.
// ---------------------------------------------------------------------------

test("#2614 a hold is declared by token, and carries its reason", () => {
  const files = [{ version: "20260922000000", name: "drop_is_admin", file: "a.sql" }];
  const held = readHoldDeclarations("/m", files, () =>
    "-- header\n-- @migration-hold: awaiting Seth's explicit go (#2614)\nBEGIN;");
  assert.equal(held.get("20260922000000"), "awaiting Seth's explicit go (#2614)");
});

test("#2614 'DO NOT APPLY from MCP' prose does NOT create a hold", () => {
  // THE important test. 8 migrations carry this wording; every one of them is
  // applied. It means "the orchestrator applies this, not you" — not "hold".
  // A prose heuristic would suppress all 8 from the audit, turning the tool
  // that catches missing schema into the thing that hides it.
  const prose = [
    "-- DO NOT APPLY from MCP — the orchestrator applies this.",
    "-- Do NOT apply to prod from this worktree.",
    "-- DO NOT APPLY WITH THE FEATURE MIGRATION (20260921000000).",
    "-- OPERATOR-GATED drop of the dead column.",
    "-- Apply ONLY after Seth confirms, on his explicit go.",
  ];
  for (const header of prose) {
    const held = readHoldDeclarations(
      "/m",
      [{ version: "1", name: "n", file: "a.sql" }],
      () => `${header}\nBEGIN;`,
    );
    assert.equal(held.size, 0, `prose must not hold: ${header}`);
  }
});

test("#2614 the real gated migration on disk declares its hold", () => {
  // Guards the wiring end-to-end: if someone edits that header and drops the
  // token, this fails rather than the migration silently becoming a "gap".
  const dir = path.resolve(import.meta.dirname, "../../../supabase/migrations");
  const { versions } = readMigrationFiles(dir);
  const held = readHoldDeclarations(dir, versions, (fp) => fs.readFileSync(fp, "utf8"));
  assert.equal(held.size, 1, "exactly one migration is on hold today");
  assert.ok(held.has("20260922000000"));
  assert.match(held.get("20260922000000"), /explicit go/);
});

// ---------------------------------------------------------------------------
// #2614 — two files, one version. The trap my own name-matching first created.
// ---------------------------------------------------------------------------

test("#2614 a version-collision sibling is NOT masked by its twin's receipt", () => {
  // `schema_migrations` is keyed on version alone. When two files share a
  // prefix, one receipt exists and a version-match check calls BOTH reconciled
  // — while the second file has no receipt and `migration up` skips it as
  // already applied. Six such pairs exist in this repo today.
  const r = auditReceipts({
    files: [
      { version: "20260612000000", name: "tr4_refund_tiers_booking_deadline", file: "a.sql" },
      { version: "20260612000000", name: "orch_426_discover_scale", file: "b.sql" },
    ],
    receipts: [{ version: "20260612000000", name: "tr4_refund_tiers_booking_deadline" }],
  });
  const flagged = [...r.unknown, ...r.unappliedGap, ...r.appliedUnstamped];
  assert.equal(flagged.length, 1, "the sibling with no receipt must be flagged");
  assert.equal(flagged[0].name, "orch_426_discover_scale");
  assert.equal(r.versionCollisions.length, 1);
  assert.deepEqual(r.versionCollisions[0].files, ["a.sql", "b.sql"]);
  assert.equal(r.clean, false, "a collision alone makes the ledger dirty");
});

test("#2614 a NULL-named receipt still reconciles by version", () => {
  // 35 legacy receipts carry no name. Requiring a name match outright would
  // turn every one of them into a false gap.
  const r = auditReceipts({
    files: [{ version: "20261003000000", name: "whatever", file: "a.sql" }],
    receipts: [{ version: "20261003000000", name: null }],
  });
  assert.equal(r.unknown.length, 0);
  assert.equal(r.clean, true);
});

test("#2614 a same-version receipt under a DIFFERENT name does not reconcile", () => {
  // Vacuity guard for the rule above: a *named* receipt that names a different
  // migration is evidence about that migration, not about this one.
  const r = auditReceipts({
    files: [{ version: "20260612000000", name: "mine", file: "a.sql" }],
    receipts: [{ version: "20260612000000", name: "someone_elses" }],
  });
  assert.equal(r.unknown.length, 1);
});

// ---------------------------------------------------------------------------
// #2614 — the repo-level guard. A SEVENTH collision must not be possible.
// ---------------------------------------------------------------------------

/**
 * The six pairs that already exist. Every one is grandfathered by NAME, not by
 * count, so this list cannot absorb a new collision on an old version. Five are
 * harmless (both halves reached production anyway); the sixth swallowed
 * `response_gzip_base64` for two months and is superseded by
 * 20270530002614_issue_2614_discover_cache_gzip_column.sql.
 */
const KNOWN_COLLISIONS = {
  "20260612000000": ["orch_426_discover_scale", "tr4_refund_tiers_booking_deadline"],
  "20260615000000": ["orch_0877_patch_event_when_rpc", "orch_426_discover_cache_gzip"],
  "20261012000000": ["orch_1148_2_2_engine_anon_grant", "orch_1150_rsvp_maybe"],
  "20261113000000": ["orch_1161_golive_marketing_optout", "orch_1172_rsvp_edit_privacy_settings"],
  "20261116000000": ["orch_1186_a_hours_single_owner_seed", "orch_1187_reconcile_stuck_checkouts_cron"],
  "20261117000000": ["orch_1186b_venue_intelligence_overview", "orch_1188_orders_event_date_id"],
};

test("#2614 no NEW migration shares a version prefix with another", () => {
  // `schema_migrations` is keyed on version alone: a colliding pair can only
  // ever hold ONE receipt, `migration up` skips the loser as already applied,
  // and the ledger reads clean the whole time. That is how the discover cache
  // stayed dark for two months.
  const { versions } = readMigrationFiles(
    path.join(REPO, "supabase", "migrations"),
  );
  const byVersion = new Map();
  for (const v of versions) {
    if (!byVersion.has(v.version)) byVersion.set(v.version, []);
    byVersion.get(v.version).push(v.name);
  }
  for (const [version, names] of byVersion) {
    if (names.length === 1) continue;
    const known = KNOWN_COLLISIONS[version];
    assert.ok(known, `NEW version collision on ${version}: ${names.join(", ")}`);
    assert.deepEqual(
      [...names].sort(),
      [...known].sort(),
      `collision on ${version} changed — a new file joined a grandfathered pair`,
    );
  }
});

test("#2614 the grandfather list cannot silently outlive its collisions", () => {
  // Vacuity guard. If a pair is ever de-collided, its entry must go too —
  // otherwise the list rots into permission to re-collide that version.
  const { versions } = readMigrationFiles(
    path.join(REPO, "supabase", "migrations"),
  );
  const counts = new Map();
  for (const v of versions) counts.set(v.version, (counts.get(v.version) ?? 0) + 1);
  for (const version of Object.keys(KNOWN_COLLISIONS)) {
    assert.ok(
      (counts.get(version) ?? 0) > 1,
      `${version} no longer collides — drop it from KNOWN_COLLISIONS`,
    );
  }
});

test("#2614 the swallowed gzip column has a superseding migration", () => {
  // The one collision that cost real schema. If someone deletes the supersede
  // without restoring the column, this goes red.
  const { versions } = readMigrationFiles(
    path.join(REPO, "supabase", "migrations"),
  );
  const supersede = versions.find((v) =>
    v.name === "issue_2614_discover_cache_gzip_column"
  );
  assert.ok(supersede, "the supersede migration is missing");
  const sql = fs.readFileSync(
    path.join(REPO, "supabase", "migrations", supersede.file),
    "utf8",
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS response_gzip_base64 text/);
});
