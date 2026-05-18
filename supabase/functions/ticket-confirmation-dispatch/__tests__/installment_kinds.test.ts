// ORCH-0869 [Tr3 Installment Payments] Stage 1b regression test.
//
// Source-assertion test (no test runner with DB/network access): pins the
// dispatcher's kind-routing AST characteristics via regex against the source
// text. The full integration flow (DB → render → Resend) is verified
// downstream by mingla-forensics TEST mode via Stripe test clock + real DB.
//
// Each assertion below corresponds to a Stage 1b acceptance criterion. A
// failed assertion means a subsequent refactor silently removed an installment
// branch, an installment renderer import, or weakened the unknown-kind
// defensive 400. Fails-on-revert verified by `git stash` + re-run: deleting
// any one of the asserted lines drops 1+ tests from PASS.

import {
  assertEquals,
  assertExists,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const DISPATCHER_PATH = new URL("../index.ts", import.meta.url);
const DISPATCHER_SOURCE = await Deno.readTextFile(DISPATCHER_PATH);

Deno.test("ORCH-0869 Stage 1b: dispatcher imports installmentDunningEmail renderer", () => {
  assertMatch(
    DISPATCHER_SOURCE,
    /import\s*\{\s*renderInstallmentDunningEmail\s*\}\s*from\s*"\.\.\/_shared\/email\/installmentDunningEmail\.ts"/,
    "dispatcher must import renderInstallmentDunningEmail from the Stage 1 shared email module",
  );
});

Deno.test("ORCH-0869 Stage 1b: dispatcher imports installmentPlanPaidInFullEmail renderer", () => {
  assertMatch(
    DISPATCHER_SOURCE,
    /import\s*\{\s*renderInstallmentPlanPaidInFullEmail\s*\}\s*from\s*"\.\.\/_shared\/email\/installmentPlanPaidInFullEmail\.ts"/,
    "dispatcher must import renderInstallmentPlanPaidInFullEmail from the Stage 1b shared email module",
  );
});

Deno.test("ORCH-0869 Stage 1b: dispatcher reads body.kind for routing", () => {
  assertMatch(
    DISPATCHER_SOURCE,
    /const\s+kind\s*=\s*typeof\s+body\.kind\s*===\s*"string"\s*\?\s*body\.kind\s*:\s*null/,
    "dispatcher must read body.kind into a local for kind-based routing",
  );
});

Deno.test('ORCH-0869 Stage 1b: dispatcher branches on kind === "installment_dunning"', () => {
  assertMatch(
    DISPATCHER_SOURCE,
    /if\s*\(\s*kind\s*===\s*"installment_dunning"\s*\)/,
    "dispatcher must branch on the installment_dunning kind",
  );
  assertStringIncludes(
    DISPATCHER_SOURCE,
    "handleInstallmentDunning(",
    "the installment_dunning branch must dispatch to handleInstallmentDunning",
  );
});

Deno.test('ORCH-0869 Stage 1b: dispatcher branches on kind === "installment_plan_paid_in_full"', () => {
  assertMatch(
    DISPATCHER_SOURCE,
    /if\s*\(\s*kind\s*===\s*"installment_plan_paid_in_full"\s*\)/,
    "dispatcher must branch on the installment_plan_paid_in_full kind",
  );
  assertStringIncludes(
    DISPATCHER_SOURCE,
    "handleInstallmentPaidInFull(",
    "the paid-in-full branch must dispatch to handleInstallmentPaidInFull",
  );
});

Deno.test("ORCH-0869 Stage 1b: unknown kind returns 400 (defensive)", () => {
  // Defensive: silent fall-through would render a ticket-confirmation email
  // for a webhook that intended something else. The unknown-kind error path
  // is critical so misroutes surface in caller logs.
  assertMatch(
    DISPATCHER_SOURCE,
    /\{\s*error:\s*"unknown_kind"\s*,\s*kind\s*\}\s*,\s*400/,
    "unknown kind must return JSON {error:'unknown_kind', kind} at HTTP 400",
  );
});

Deno.test("ORCH-0869 Stage 1b: dispatcher preserves legacy fall-through when kind is null", () => {
  // Legacy callers (biz_ticket_checkout_finalize → ticket_order_notifications
  // poll) MUST keep working. The kind check is gated on kind !== null; null
  // falls through to the existing ticket-confirmation flow.
  assertMatch(
    DISPATCHER_SOURCE,
    /if\s*\(\s*kind\s*!==\s*null\s*\)\s*\{[\s\S]*?return\s+jsonResponse\(\s*\{\s*error:\s*"unknown_kind"/,
    "unknown-kind gate must be `if (kind !== null)` so null kinds (legacy callers) fall through to the existing notifications-table flow",
  );
});

Deno.test("ORCH-0869 Stage 1b: installment_dunning handler renders via renderInstallmentDunningEmail", () => {
  // Ensure the rename or moving of the renderer call would break this test
  // — protects against silent template swap.
  const dunningSection = extractFunctionBody(
    DISPATCHER_SOURCE,
    "handleInstallmentDunning",
  );
  assertExists(dunningSection, "handleInstallmentDunning function must exist");
  assertStringIncludes(
    dunningSection,
    "renderInstallmentDunningEmail({",
    "handleInstallmentDunning must call renderInstallmentDunningEmail",
  );
});

Deno.test("ORCH-0869 Stage 1b: paid-in-full handler renders via renderInstallmentPlanPaidInFullEmail", () => {
  const paidSection = extractFunctionBody(
    DISPATCHER_SOURCE,
    "handleInstallmentPaidInFull",
  );
  assertExists(paidSection, "handleInstallmentPaidInFull function must exist");
  assertStringIncludes(
    paidSection,
    "renderInstallmentPlanPaidInFullEmail({",
    "handleInstallmentPaidInFull must call renderInstallmentPlanPaidInFullEmail",
  );
});

Deno.test("ORCH-0869 Stage 1b: installment emails send with NO attachments", () => {
  // Dunning + paid-in-full are notification emails, not ticket emails. They
  // MUST NOT carry the buyer's ticket PDF or .ics — the buyer already has
  // those from the original confirmation. Both branches assert empty
  // attachments array.
  const dunningSection = extractFunctionBody(
    DISPATCHER_SOURCE,
    "handleInstallmentDunning",
  ) ?? "";
  const paidSection = extractFunctionBody(
    DISPATCHER_SOURCE,
    "handleInstallmentPaidInFull",
  ) ?? "";
  assertStringIncludes(
    dunningSection,
    "attachments: [],",
    "dunning email must send with no attachments",
  );
  assertStringIncludes(
    paidSection,
    "attachments: [],",
    "paid-in-full email must send with no attachments",
  );
});

Deno.test("ORCH-0869 Stage 1b: dunning handler passes failureReason + installmentId from body", () => {
  const dunningSection = extractFunctionBody(
    DISPATCHER_SOURCE,
    "handleInstallmentDunning",
  ) ?? "";
  // The renderer needs the failureReason for friendly translation. The
  // dispatcher must pull it from the request body, not invent it.
  assertMatch(
    dunningSection,
    /typeof\s+body\.failureReason\s*===\s*"string"/,
    "dunning handler must read failureReason from body",
  );
  assertMatch(
    dunningSection,
    /typeof\s+body\.installmentId\s*===\s*"string"/,
    "dunning handler must read installmentId from body",
  );
});

Deno.test("ORCH-0869 Stage 1b: dispatcher requires service-role auth (preserved from legacy)", () => {
  // Sanity check: the kind-routing block sits AFTER the auth check so the
  // new branches inherit the existing auth gate. A refactor that moved auth
  // below kind routing would let anonymous callers fire dunning emails.
  const authIndex = DISPATCHER_SOURCE.indexOf(
    `if (req.headers.get("authorization") !== \`Bearer \${serviceKey}\`)`,
  );
  const kindIndex = DISPATCHER_SOURCE.indexOf(
    'const kind = typeof body.kind === "string"',
  );
  assertExists(authIndex > -1 ? true : null, "auth check must exist");
  assertExists(kindIndex > -1 ? true : null, "kind routing must exist");
  assertEquals(
    authIndex < kindIndex,
    true,
    "service-role auth check MUST precede kind-based routing (otherwise anonymous callers could fire installment emails)",
  );
});

// Helper: extract a function body by name from the source text. Returns the
// raw body between the opening { and matching closing } (depth-aware).
function extractFunctionBody(src: string, fnName: string): string | null {
  const declRe = new RegExp(
    `(?:async\\s+function|function)\\s+${fnName}\\s*\\([\\s\\S]*?\\)\\s*(?::\\s*[^\\{]*?)?\\{`,
  );
  const m = declRe.exec(src);
  if (m === null) return null;
  const openIdx = m.index + m[0].length - 1;
  let depth = 1;
  for (let i = openIdx + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}
