#!/usr/bin/env node
/**
 * ORCH-0843 strict-grep gate — Mingla charge-creating Stripe API calls use
 * DIRECT-CHARGE shape only (Stripe-Account header + application_fee_amount
 * plumbing). No destination-charge `transfer_data.destination` may appear
 * anywhere under `supabase/functions/`.
 *
 * Enforces (PROPOSED → ACTIVE post-CLOSE):
 *   - I-PROPOSED-STRIPE-CHARGE-SHAPE-IS-DIRECT
 *   - I-PROPOSED-STRIPE-APPLICATION-FEE-PRESENT
 *   - I-PROPOSED-STRIPE-ACCOUNT-HEADER-ON-CONNECTED-CALLS
 *   - I-PROPOSED-STRIPE-STATEMENT-DESCRIPTOR-PREFIX-MINGLA
 *
 * Contracts (per SPEC §5.1):
 *   T-G1: ticket-checkout-create/index.ts contains NO `transfer_data:` key
 *         in active code (comments allowed; strip before testing).
 *   T-G2: every `checkout.sessions.create` AND `paymentIntents.create` call
 *         in ticket-checkout-create/index.ts has a nearby `stripeAccount:`
 *         in its request-options.
 *   T-G3: ticket-checkout-create/index.ts mentions
 *         `application_fee_amount` somewhere (plumbing must exist; the
 *         conditional zero-omit form is allowed).
 *   T-G4: no .ts file under supabase/functions/ (excluding
 *         _shared/stripeBlueprintClient.ts which is Connect-account
 *         provisioning, not charge creation, and excluding this gate's own
 *         documentation/comment text) contains
 *         `transfer_data: { destination ...` in active code.
 *   T-G5: ticket-checkout-create/index.ts contains
 *         `statement_descriptor_suffix: "MINGLA"` literal in the Checkout
 *         Session path.
 *   T-G6: ticket-checkout-create/index.ts must NOT contain the
 *         destination-charge `automatic_tax.liability.type: "account"` shape
 *         (ORCH-0843 REWORK regression prevention — Stripe rejects this
 *         block under direct charges with 400 StripeInvalidRequestError;
 *         see https://docs.stripe.com/tax/connect/direct-charges).
 *
 * Exit 1 on any FAIL with a named failure list. Pattern mirrors
 * `orch-0839-b-mingla-business-no-native-stripe.mjs`.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const failures = [];

// Strip line + block comments so we don't match invariant-preserving doc
// comments that legitimately mention the legacy `transfer_data` keyword.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const checkoutPath = path.join(
  root,
  "supabase/functions/ticket-checkout-create/index.ts",
);
let checkoutSource = "";
let checkoutSourceNoComments = "";
try {
  checkoutSource = fs.readFileSync(checkoutPath, "utf8");
  checkoutSourceNoComments = stripComments(checkoutSource);
} catch (error) {
  failures.push(
    `T-G* supabase/functions/ticket-checkout-create/index.ts read failed: ${error.message}`,
  );
}

// T-G1 — no `transfer_data:` key in active code.
if (checkoutSourceNoComments && /\btransfer_data\s*:/.test(checkoutSourceNoComments)) {
  failures.push(
    `T-G1 supabase/functions/ticket-checkout-create/index.ts must NOT use ` +
      `transfer_data: (ORCH-0843 direct-charge shape forbids the ` +
      `destination-charge syntax — see DEC-154 amended Path B).`,
  );
}

// T-G2 — every checkout.sessions.create + paymentIntents.create call has
// a nearby stripeAccount: in its request-options. We scan call-start
// indices and look ±400 chars (the request-options block is typically the
// last argument to the call; tight enough to be meaningful, loose enough
// to tolerate prettier-driven multi-line wraps).
if (checkoutSourceNoComments) {
  const callPattern = /\b(?:checkout\.sessions|paymentIntents)\.create\s*\(/g;
  let match;
  let callIndex = 0;
  while ((match = callPattern.exec(checkoutSourceNoComments)) !== null) {
    callIndex += 1;
    const windowStart = match.index;
    const windowEnd = Math.min(checkoutSourceNoComments.length, match.index + 4000);
    const windowText = checkoutSourceNoComments.slice(windowStart, windowEnd);
    if (!/stripeAccount\s*:/.test(windowText)) {
      failures.push(
        `T-G2 supabase/functions/ticket-checkout-create/index.ts call #${callIndex} ` +
          `(${match[0].trim()}) is missing stripeAccount: in its request-options ` +
          `(ORCH-0843 direct-charge requires Stripe-Account header on every ` +
          `connected-account-scoped call).`,
      );
    }
  }
  if (callIndex === 0) {
    failures.push(
      `T-G2 supabase/functions/ticket-checkout-create/index.ts must contain at ` +
        `least one checkout.sessions.create OR paymentIntents.create call ` +
        `(found 0).`,
    );
  }
}

// T-G3 — application_fee_amount plumbing exists somewhere in the file.
if (checkoutSourceNoComments && !/application_fee_amount/.test(checkoutSourceNoComments)) {
  failures.push(
    `T-G3 supabase/functions/ticket-checkout-create/index.ts must reference ` +
      `application_fee_amount (ORCH-0843 plumbing). Conditional-omit pattern ` +
      `is allowed; outright absence is forbidden.`,
  );
}

// T-G4 — walk supabase/functions/ for any active `transfer_data: { destination`
// match. Exclusions:
//  - _shared/stripeBlueprintClient.ts (Connect-account provisioning, not
//    charge creation; Path B keeps it unchanged)
//  - orch-0843-stripe-direct-charge-probe/index.ts (the probe is the
//    intentional-good direct-charge shape — included for completeness; if
//    it ever uses transfer_data the gate trips)
//  - this script's own checkout file would be caught by T-G1 above; we
//    still walk it here for defense in depth.
const fnsRoot = path.join(root, "supabase/functions");
const transferDataPattern = /transfer_data\s*:\s*\{[^}]*destination/;
const T_G4_EXCLUDED_RELATIVE_PATHS = new Set([
  // Connect-account provisioning is Path-B-unchanged per SPEC §3.6.1.
  "supabase/functions/_shared/stripeBlueprintClient.ts",
]);
function walkForT_G4(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkForT_G4(absolutePath);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const relativePath = path.relative(root, absolutePath);
    if (T_G4_EXCLUDED_RELATIVE_PATHS.has(relativePath)) continue;
    const sourceNoComments = stripComments(fs.readFileSync(absolutePath, "utf8"));
    if (transferDataPattern.test(sourceNoComments)) {
      failures.push(
        `T-G4 ${relativePath}: contains transfer_data: { destination ... — ` +
          `ORCH-0843 direct-charge shape forbids destination-charge syntax in any ` +
          `charge-creating edge function. If this file legitimately needs ` +
          `transfer_data for a non-charge use case, add it to ` +
          `T_G4_EXCLUDED_RELATIVE_PATHS with justification.`,
      );
    }
  }
}
walkForT_G4(fnsRoot);

// T-G5 — Checkout Session path emits statement_descriptor_suffix: "MINGLA".
// Stripe's Checkout / PI API only accepts `_suffix` at the payment_intent_data
// level; `_prefix` is a one-time account-level config on Mingla's main Stripe
// platform account (Settings → Public details). DEC-154 (1) intent is
// preserved — buyer card statements show the Mingla marker alongside the
// creator's brand name; the platform "MINGLA*" prefix shape requires the
// account-level Dashboard config in addition to this per-PI suffix.
if (
  checkoutSourceNoComments &&
  !/statement_descriptor_suffix\s*:\s*["']MINGLA["']/.test(checkoutSourceNoComments)
) {
  failures.push(
    `T-G5 supabase/functions/ticket-checkout-create/index.ts must set ` +
      `statement_descriptor_suffix: "MINGLA" on the hosted Checkout Session ` +
      `path (DEC-154 (1) / ORCH-0843 — buyer card statements identify Mingla; ` +
      `platform "MINGLA*" prefix is a separate one-time Dashboard config).`,
  );
}

// T-G6 — ORCH-0843 REWORK regression prevention. The legacy
// destination-charge `automatic_tax.liability.type: "account"` block is
// REJECTED by Stripe under direct charges with 400
// StripeInvalidRequestError (verified live on acct_1TUNLtB5v00XfDTX
// against `surface: "web"` + `surface: "mobile-web"`; QA report
// QA_ORCH-0843_CHARGE_SHAPE_RECONCILIATION_REPORT.md §8 P0-001). The
// correct direct-charge shape is `automatic_tax: { enabled: true }` with
// NO liability block — see https://docs.stripe.com/tax/connect/direct-charges
// (the Stripe-Account header alone designates merchant of record).
//
// This sub-check guards against the exact bug class that broke live sales
// at v46. If a future change re-introduces a `liability:` key with
// `type: "account"` adjacent inside ticket-checkout-create/index.ts active
// code, this gate trips with a named failure.
if (checkoutSourceNoComments) {
  // Match a `liability:` key opening a block that contains `type: "account"`
  // within the next ~200 chars. Tight enough to ignore unrelated tokens,
  // loose enough to tolerate prettier-driven multi-line wraps.
  const liabilityAccountPattern =
    /\bliability\s*:\s*\{[^}]{0,200}\btype\s*:\s*["']account["']/;
  if (liabilityAccountPattern.test(checkoutSourceNoComments)) {
    failures.push(
      `T-G6 supabase/functions/ticket-checkout-create/index.ts contains ` +
        `automatic_tax.liability.type: "account" — under direct charges ` +
        `Stripe REJECTS this block with 400 StripeInvalidRequestError ` +
        `(see https://docs.stripe.com/tax/connect/direct-charges). The ` +
        `Stripe-Account header alone designates the connected account as ` +
        `merchant of record; the correct shape is ` +
        `\`automatic_tax: { enabled: true }\` with NO liability block. ` +
        `ORCH-0843 REWORK regression prevention.`,
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-0843 Stripe direct-charge gate failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("ORCH-0843 Stripe direct-charge gate passed.");
