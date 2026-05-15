#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0837 regression check — Stripe PaymentIntent card-only + handleURLCallback wired.
 *
 * Asserts the two-part fix from SPEC_ORCH-0835_0836_0837_BUNDLED_DISCOVER_LOGBOX_STRIPE_CARDONLY.md:
 *
 *   Backend: supabase/functions/ticket-checkout-create/index.ts MUST create
 *   PaymentIntents with `payment_method_types: ["card"]` explicitly, NOT
 *   `automatic_payment_methods: { enabled: true }` (the latter fans out to
 *   every dashboard-enabled method including redirect-flow BNPL methods
 *   that hang without handleURLCallback wiring).
 *
 *   Mobile: app/index.tsx MUST import useStripe from @stripe/stripe-react-native,
 *   call useStripe() inside AppContent, and invoke handleURLCallback inside
 *   the Linking listener BEFORE falling through to handleDeepLink.
 *
 * Invariants codified:
 *   I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES (T-C0, T-C1)
 *   I-PROPOSED-STRIPE-CALLBACK-WIRED            (T-C2, T-C3, T-C4)
 *
 * Exit 1 on any FAIL. 5 contracts (T-C0..T-C4).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");

const readMaybe = (absRel) => {
  try {
    return fs.readFileSync(absRel, "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

// ─── Backend: ticket-checkout-create PI shape ────────────────────────────

const edgeFn = readMaybe(
  path.join(repoRoot, "supabase/functions/ticket-checkout-create/index.ts"),
);

check(
  "T-C0 ticket-checkout-create/index.ts creates PI with payment_method_types: ['card']",
  edgeFn !== null &&
    /payment_method_types:\s*\[\s*["']card["']\s*\]/.test(edgeFn),
  "supabase/functions/ticket-checkout-create/index.ts MUST pass `payment_method_types: ['card']` to stripe.paymentIntents.create. Card-only is the minimum-viable safe shape until handleURLCallback wiring is proven for redirect-flow methods AND Apple Pay merchant cert is verified end-to-end (ORCH-0838).",
);

check(
  "T-C1 ticket-checkout-create/index.ts does NOT use automatic_payment_methods: {enabled: true}",
  edgeFn !== null &&
    !/automatic_payment_methods:\s*\{\s*enabled:\s*true\s*\}/.test(edgeFn),
  "supabase/functions/ticket-checkout-create/index.ts MUST NOT use `automatic_payment_methods: { enabled: true }` — that form exposes every dashboard-enabled method including BNPL redirects (Klarna, Affirm, Cash App, Amazon Pay) which hang the PaymentSheet without handleURLCallback wiring. Operator-verified failed PIs pi_3TX3rBPjlZyAYA401xD9EJ3N and pi_3TX2jzPjlZyAYA401JI3kgky attached six methods including the four redirect-flow ones.",
);

// ─── Mobile: app/index.tsx useStripe import + handleURLCallback usage ────

const appIndex = readMaybe(path.join(root, "app/index.tsx"));

check(
  "T-C2 app/index.tsx imports useStripe from @stripe/stripe-react-native",
  appIndex !== null &&
    /import\s+\{[^}]*\buseStripe\b[^}]*\}\s+from\s+["']@stripe\/stripe-react-native["']/.test(
      appIndex,
    ),
  "app/index.tsx MUST import `useStripe` from @stripe/stripe-react-native to gain access to handleURLCallback for Stripe redirect-flow completion routing.",
);

check(
  "T-C3 app/index.tsx invokes handleURLCallback at least once",
  appIndex !== null && /handleURLCallback\(/.test(appIndex),
  "app/index.tsx MUST call `handleURLCallback(url)` to route Stripe redirect URLs back into the SDK. Without this call, presentPaymentSheet hangs indefinitely after any redirect-method completion (Apple Pay return, 3DS, BNPL).",
);

check(
  "T-C4 app/index.tsx Linking listener invokes handleURLCallback BEFORE falling through to handleDeepLink",
  appIndex !== null &&
    /handleURLCallback\([\s\S]{0,300}?if\s*\(\s*!handledByStripe\s*\)[\s\S]{0,200}?handleDeepLink\(/.test(
      appIndex,
    ),
  "app/index.tsx Linking listener MUST invoke handleURLCallback FIRST, check its return value, and only fall through to handleDeepLink when Stripe did NOT consume the URL. Pattern: `const handledByStripe = await handleURLCallback(url); if (!handledByStripe) handleDeepLink(url);`",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0837 regression check\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
