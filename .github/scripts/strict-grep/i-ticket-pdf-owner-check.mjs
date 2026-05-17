#!/usr/bin/env node
// ORCH-0842 — I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER.
//
// `supabase/functions/ticket-pdf-fetch/index.ts` MUST verify the caller's
// JWT user-id and compare it against `orders.buyer_user_id` BEFORE any
// storage operation. This gate verifies both a userIdFromAuthHeader call
// AND a buyer_user_id comparison are present in the source.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REL = "supabase/functions/ticket-pdf-fetch/index.ts";
const full = path.join(ROOT, REL);

if (!fs.existsSync(full)) {
  console.error(
    `I-PROPOSED-AK gate failed: ${REL} does not exist. The ticket-pdf-fetch edge function is required by ORCH-0842.`,
  );
  process.exit(1);
}

const text = fs.readFileSync(full, "utf8");

const failures = [];

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

if (failures.length > 0) {
  console.error("I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER gate failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  "I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER: ticket-pdf-fetch owner check present.",
);
