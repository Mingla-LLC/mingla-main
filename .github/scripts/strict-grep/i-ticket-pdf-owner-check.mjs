#!/usr/bin/env node
// ORCH-0842 — I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER.
//
// `supabase/functions/ticket-pdf-fetch/index.ts` MUST verify the caller's
// JWT user-id and compare it against `orders.buyer_user_id` BEFORE any
// storage operation. This gate verifies both a userIdFromAuthHeader call
// AND a buyer_user_id comparison are present in the source.
//
// `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
// the pure `check(text, failures)` is exercised with a GOOD fixture
// (specificity) and ≥2 DISTINCT BAD fixtures (sensitivity). The disk-reading
// main path calls the SAME `check(...)`; behavior-preserving refactor.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REL = "supabase/functions/ticket-pdf-fetch/index.ts";
const full = path.join(ROOT, REL);

/**
 * Pure verdict. `text` = raw source of ticket-pdf-fetch/index.ts. Pushes a
 * human-readable string per missing check into `failures`. Behavior-preserving
 * extraction of the original three assertions.
 */
function check(text, failures) {
  // 1) Must extract caller user id from JWT.
  if (
    !/userIdFromAuthHeader\s*\(/.test(text) &&
    !/auth\.getUser\s*\(/.test(text)
  ) {
    failures.push(
      `${REL}: missing caller-JWT extraction (expected userIdFromAuthHeader(req) or auth.getUser(token)). Owner check cannot run without a caller identity.`,
    );
  }

  // 2) Must compare against buyer_user_id explicitly.
  if (!/buyer_user_id/.test(text)) {
    failures.push(
      `${REL}: missing reference to buyer_user_id. Owner enforcement requires an explicit comparison.`,
    );
  }

  // 3) The comparison should appear as inequality (forbidden access) or
  // equality check — we accept either `!==` or `===` against the caller id.
  const hasComparison =
    /buyer_user_id\s*!==\s*\w+/.test(text) ||
    /\w+\s*!==\s*order\.buyer_user_id/.test(text) ||
    /buyer_user_id\s*===\s*\w+/.test(text) ||
    /\w+\s*===\s*order\.buyer_user_id/.test(text);
  if (!hasComparison) {
    failures.push(
      `${REL}: buyer_user_id is referenced but no explicit equality/inequality comparison against the caller id was found. Owner check must be a discrete branch.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: JWT extraction + buyer_user_id owner comparison present → silent.
  const good =
    "const callerUserId = await userIdFromAuthHeader(req);\n" +
    'const { data: order } = await sb.from("orders").select("buyer_user_id, ticket_pdf_path").single();\n' +
    "if (order.buyer_user_id !== callerUserId) {\n" +
    '  return new Response("forbidden", { status: 403 });\n' +
    "}\n";
  let f = [];
  check(good, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): the owner comparison is removed — the fetch runs with
  // only a caller id, no buyer_user_id gate → fires.
  const bad1 =
    "const callerUserId = await userIdFromAuthHeader(req);\n" +
    'const { data: order } = await sb.from("orders").select("ticket_pdf_path").single();\n' +
    "return streamPdf(order.ticket_pdf_path);\n";
  f = [];
  check(bad1, f);
  if (f.length === 0) self.push("BAD1 (owner comparison removed) not flagged");

  // BAD2 (regression, different angle): JWT extraction dropped — the code
  // compares buyer_user_id against a client-supplied id instead → fires.
  const bad2 =
    "const clientId = body.userId;\n" +
    'const { data: order } = await sb.from("orders").select("buyer_user_id").single();\n' +
    "if (order.buyer_user_id !== clientId) {\n" +
    '  return new Response("forbidden", { status: 403 });\n' +
    "}\n";
  f = [];
  check(bad2, f);
  if (f.length === 0) self.push("BAD2 (JWT extraction replaced by client-supplied id) not flagged");

  if (self.length) {
    console.error("I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
if (!fs.existsSync(full)) {
  console.error(
    `I-PROPOSED-AK gate failed: ${REL} does not exist. The ticket-pdf-fetch edge function is required by ORCH-0842.`,
  );
  process.exit(1);
}

const text = fs.readFileSync(full, "utf8");

const failures = [];
check(text, failures);

if (failures.length > 0) {
  console.error("I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER gate failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  "I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER: ticket-pdf-fetch owner check present.",
);
