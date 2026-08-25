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
      { version: "20270101000001", name: "a" },
      { version: "20260101000009", name: "deleted" },
    ],
  });
  assert.deepEqual(r.orphanReceipts, ["20260101000009"]);
});

test("#2598 a fully-reconciled ledger reports clean", () => {
  // Vacuity guard: if this cannot pass, every other assertion is meaningless.
  const r = auditReceipts({
    files: [f("20270101000001")],
    receipts: [{ version: "20270101000001", name: "a" }],
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
