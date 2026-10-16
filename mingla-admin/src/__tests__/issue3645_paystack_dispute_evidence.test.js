// Issue #3645 WS5 [Paystack dispute evidence] — regression pin.
//
// 1. Pure helpers (lib/paystackDisputeEvidence.js): countdown, action gating,
//    filename, serialisation, error copy.
// 2. Source-level wiring (mirrors the ORCH-1274/1278 + #3645 PR9 admin pattern):
//    the service wrappers hit the right RPCs, the Money ledger has a separate
//    Paystack disputes tab, and the UI never writes a table directly.
//
// FAILS-ON-REVERT: dropping the tab, the RPC names, or the review gate fails a case.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVIDENCE_STATES,
  deadlineCountdown,
  canActOnEvidence,
  evidenceFilename,
  serializeDossier,
  evidenceErrorMessage,
} from "../lib/paystackDisputeEvidence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(SRC, p), "utf8");
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("#3645 WS5 — deadlineCountdown", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  it("returns a dash for a missing or invalid deadline", () => {
    assert.deepEqual(deadlineCountdown(null, now), { overdue: false, label: "—" });
    assert.deepEqual(deadlineCountdown("not-a-date", now), { overdue: false, label: "—" });
  });
  it("is overdue at and after the deadline", () => {
    assert.deepEqual(deadlineCountdown("2026-10-01T12:00:00Z", now), { overdue: true, label: "overdue" });
    assert.equal(deadlineCountdown("2026-10-01T11:00:00Z", now).overdue, true);
  });
  it("formats minutes under an hour and hours+minutes above", () => {
    assert.deepEqual(deadlineCountdown("2026-10-01T12:42:00Z", now), { overdue: false, label: "42m" });
    assert.deepEqual(deadlineCountdown("2026-10-01T15:10:00Z", now), { overdue: false, label: "3h 10m" });
  });
});

describe("#3645 WS5 — canActOnEvidence (review gate)", () => {
  const open = { is_resolved: false };
  it("a fresh dispute can be reviewed but not exported or submitted", () => {
    assert.deepEqual(canActOnEvidence(open, {}), { canReview: true, canExport: false, canSubmit: false });
    assert.deepEqual(canActOnEvidence(open, undefined), { canReview: true, canExport: false, canSubmit: false });
  });
  it("a current review unlocks export and submit", () => {
    const st = { evidence_reviewed_at: "2026-10-01T12:00:00Z", review_current: true };
    assert.deepEqual(canActOnEvidence(open, st), { canReview: true, canExport: true, canSubmit: true });
  });
  it("a stale review (dossier changed) locks export and submit again", () => {
    const st = { evidence_reviewed_at: "2026-10-01T12:00:00Z", review_current: false };
    assert.deepEqual(canActOnEvidence(open, st), { canReview: true, canExport: false, canSubmit: false });
  });
  it("a resolved dispute can only export (record keeping), never review or submit", () => {
    const st = { evidence_reviewed_at: "2026-10-01T12:00:00Z", review_current: true };
    assert.deepEqual(canActOnEvidence({ is_resolved: true }, st), { canReview: false, canExport: true, canSubmit: false });
  });
  it("resolved export stays available even when the live dossier hash no longer matches", () => {
    const st = { evidence_reviewed_at: "2026-10-01T12:00:00Z", review_current: false };
    assert.deepEqual(canActOnEvidence({ is_resolved: true }, st), { canReview: false, canExport: true, canSubmit: false });
  });
});

describe("#3645 WS5 — filename / serialisation / errors", () => {
  it("builds a sha-tied, filesystem-safe filename", () => {
    assert.equal(
      evidenceFilename("dsp/../1", "abcdef0123456789abcdef"),
      "paystack-dispute-dsp____1-abcdef012345.json",
    );
    assert.equal(evidenceFilename(null, null), "paystack-dispute-dispute-.json");
  });
  it("serialises the dossier verbatim and tolerates null", () => {
    assert.equal(serializeDossier({ a: 1 }), '{\n  "a": 1\n}');
    assert.equal(serializeDossier(null), "{}");
  });
  it("maps every server error code to operator copy", () => {
    const cases = {
      not_authorized: /Admin access/,
      reason_required: /reason is required/,
      dispute_not_found: /no longer exists/,
      dispute_resolved: /already resolved/,
      past_provider_deadline: /deadline has passed/,
      review_required: /Review the evidence/,
      dossier_changed_since_review: /Review it again/,
      dossier_sha_mismatch: /Reload and review/,
      expected_dossier_sha_required: /Reload and review/,
    };
    for (const [code, re] of Object.entries(cases)) {
      assert.match(evidenceErrorMessage({ message: `ERROR: ${code}` }), re, code);
    }
    assert.equal(evidenceErrorMessage({ message: "boom" }), "boom");
    assert.match(evidenceErrorMessage(null), /Something went wrong/);
  });
  it("lists the five evidence states the list RPC emits", () => {
    assert.deepEqual(EVIDENCE_STATES, ["needs_review", "reviewed", "exported", "submitted_stub", "resolved"]);
  });
});

describe("#3645 WS5 — service + UI wiring", () => {
  const READ = stripJs(read("services/adminMoneyService.js"));
  const ACT = stripJs(read("services/adminMoneyActService.js"));
  const LEDGER = stripJs(read("pages/BusinessMoneyLedgerPage.jsx"));
  const DETAIL = stripJs(read("components/money/PaystackDisputeDetail.jsx"));

  it("read service calls the Paystack list + get RPCs (not the Stripe ones)", () => {
    assert.match(READ, /supabase\.rpc\("admin_list_paystack_disputes"/);
    assert.match(READ, /supabase\.rpc\("admin_get_paystack_dispute"/);
  });
  it("act service routes review + export/submit through callAdminWriteRpc", () => {
    assert.match(ACT, /callAdminWriteRpc\("admin_review_paystack_dispute_evidence"/);
    assert.match(ACT, /p_expected_dossier_sha256:\s*expected_dossier_sha256/);
    assert.match(ACT, /callAdminWriteRpc\("admin_record_paystack_dispute_evidence_action"/);
  });
  it("Money ledger has a Paystack disputes tab distinct from Stripe disputes", () => {
    assert.match(LEDGER, /id: "paystack_disputes", label: "Paystack disputes"/);
    assert.match(LEDGER, /id: "disputes", label: "Disputes"/);
    assert.match(LEDGER, /fetchPage=\{listPaystackDisputes\}/);
    assert.match(LEDGER, /paystackDisputeId=/);
    assert.match(LEDGER, /<PaystackDisputeDetail/);
  });
  it("detail view drives review -> export -> submit_stub via the act service", () => {
    assert.match(DETAIL, /reviewPaystackDisputeEvidence\(/);
    assert.match(DETAIL, /expected_dossier_sha256:\s*bundle\.dossier_sha256/);
    assert.match(DETAIL, /action: "export"/);
    assert.match(DETAIL, /action: "submit_stub"/);
    assert.match(DETAIL, /canActOnEvidence\(/);
    assert.match(DETAIL, /evidenceFilename\(/);
    assert.match(DETAIL, /NOTHING is sent to Paystack/);
    assert.match(DETAIL, /does not answer Paystack/);
  });
  it("neither the page nor the detail view writes a table directly", () => {
    const DIRECT_WRITE_RE = /\.(update|insert|delete)\s*\(/;
    assert.ok(!DIRECT_WRITE_RE.test(DETAIL));
    assert.ok(!DIRECT_WRITE_RE.test(LEDGER));
    assert.ok(!/\.from\(\s*["']paystack_dispute/.test(READ + ACT + DETAIL + LEDGER));
  });
});
