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
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(checkoutRaw, fnFiles, failures)` is exercised with a GOOD
 * fixture (specificity) and ≥2 DISTINCT BAD fixtures (sensitivity). The
 * disk-reading main path calls the SAME `check(...)`; the refactor is
 * behavior-preserving (identical verdict on the real tree).
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

// Strip line + block comments so we don't match invariant-preserving doc
// comments that legitimately mention the legacy `transfer_data` keyword.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

// Connect-account provisioning is Path-B-unchanged per SPEC §3.6.1.
const T_G4_EXCLUDED_RELATIVE_PATHS = new Set([
  "supabase/functions/_shared/stripeBlueprintClient.ts",
]);

/**
 * Pure verdict. `checkoutRaw` = raw source of ticket-checkout-create/index.ts
 * (or null if unreadable). `fnFiles` = [{ relativePath, content }] for every
 * .ts file under supabase/functions/ (raw content; exclusions applied here so
 * the self-test can prove the exemption still silences the excluded file).
 */
function check(checkoutRaw, fnFiles, failures) {
  const checkoutSourceNoComments = checkoutRaw == null ? "" : stripComments(checkoutRaw);
  if (checkoutRaw == null) {
    failures.push(
      "T-G* supabase/functions/ticket-checkout-create/index.ts read failed.",
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
  // a nearby stripeAccount: in its request-options.
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

  // T-G4 — any active `transfer_data: { destination` match under
  // supabase/functions/, excluding the Path-B provisioning helper.
  const transferDataPattern = /transfer_data\s*:\s*\{[^}]*destination/;
  for (const { relativePath, content } of fnFiles) {
    if (T_G4_EXCLUDED_RELATIVE_PATHS.has(relativePath)) continue;
    const sourceNoComments = stripComments(content);
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

  // T-G5 — Checkout Session path emits statement_descriptor_suffix: "MINGLA".
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

  // T-G6 — ORCH-0843 REWORK regression prevention. The destination-charge
  // `automatic_tax.liability.type: "account"` block is REJECTED by Stripe
  // under direct charges with 400 StripeInvalidRequestError.
  if (checkoutSourceNoComments) {
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
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  const DESC = 'statement_descriptor_suffix: "MINGLA"';
  const FEE = "application_fee_amount: platformFee";

  // GOOD: direct-charge shape — sessions.create with stripeAccount, fee +
  // MINGLA suffix present, no transfer_data, no liability account. The
  // excluded provisioning helper carries transfer_data yet stays silent
  // (proves the T-G4 exemption).
  const goodCheckout = [
    "const session = await stripe.checkout.sessions.create({",
    "  mode: 'payment',",
    `  ${FEE},`,
    "  payment_intent_data: {",
    `    ${DESC},`,
    "  },",
    "}, { stripeAccount: connectedAccountId });",
    "",
    "const pi = await stripe.paymentIntents.create({",
    `  amount, ${FEE},`,
    "}, { stripeAccount: connectedAccountId });",
  ].join("\n");
  const goodFnFiles = [
    { relativePath: "supabase/functions/some-fn/index.ts", content: "const x = 1;\n" },
    {
      // excluded: contains destination-charge syntax but must stay silent.
      relativePath: "supabase/functions/_shared/stripeBlueprintClient.ts",
      content: "const t = { transfer_data: { destination: acct } };\n",
    },
  ];
  let f = [];
  check(goodCheckout, goodFnFiles, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): re-add transfer_data: { destination } to the checkout
  // (destination-charge revert) → T-G1 fires.
  const bad1 = goodCheckout + "\ntransfer_data: { destination: connectedAccountId },\n";
  f = [];
  check(bad1, goodFnFiles, f);
  if (f.length === 0) self.push("BAD1 (transfer_data destination-charge revert) not flagged");

  // BAD2 (regression, different angle): a paymentIntents.create( with NO
  // nearby stripeAccount (charge under platform context) → T-G2 fires. Fee +
  // MINGLA tokens still present so ONLY T-G2 fires.
  const bad2 = `const pi = await stripe.paymentIntents.create({ amount, ${FEE}, ${DESC} });`;
  f = [];
  check(bad2, goodFnFiles, f);
  if (f.length === 0) self.push("BAD2 (paymentIntents.create missing stripeAccount) not flagged");

  if (self.length) {
    console.error("ORCH-0843 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0843 self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const failures = [];

const checkoutPath = path.join(
  root,
  "supabase/functions/ticket-checkout-create/index.ts",
);
let checkoutRaw = null;
try {
  checkoutRaw = fs.readFileSync(checkoutPath, "utf8");
} catch {
  // Left null — check() reports the read failure exactly once.
  checkoutRaw = null;
}

// Walk supabase/functions/ collecting every .ts file (raw content) for T-G4.
const fnsRoot = path.join(root, "supabase/functions");
const fnFiles = [];
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
    fnFiles.push({ relativePath, content: fs.readFileSync(absolutePath, "utf8") });
  }
}
walkForT_G4(fnsRoot);

check(checkoutRaw, fnFiles, failures);

if (failures.length > 0) {
  console.error("ORCH-0843 Stripe direct-charge gate failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("ORCH-0843 Stripe direct-charge gate passed.");
