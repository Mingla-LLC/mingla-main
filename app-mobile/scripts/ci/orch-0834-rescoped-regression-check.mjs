#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0834-rescoped regression check.
 *
 * Asserts the six-part Stripe RN baseline config + free-ticket bottom-sheet
 * migration shipped per SPEC_ORCH-0834-RESCOPED_STRIPE_CONFIG_AND_FREE_TICKET_BOTTOM_SHEET.md:
 *
 *   S0 — package.json Stripe RN bump 0.50.3 → 0.65.1
 *   S1 — StripeNativeProvider merchantIdentifier + urlScheme props
 *   S2 — app/_layout.tsx passes both props
 *   S3 — app.json Expo plugin entry for Stripe with merchantIdentifier + enableGooglePay
 *   S4 — TicketClaimConfirmModal migrated from RN Modal to @gorhom/bottom-sheet
 *   S5 — ExpandedBusinessEventSheet consumer unchanged (sibling fragment intact)
 *
 * 10 contracts (T-A0 through T-A9). Exit 1 on any FAIL.
 *
 * Invariants codified:
 *   I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG  (T-A0..T-A4)
 *   I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM  (T-A5..T-A9)
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

// ─── S0: Stripe RN SDK upgrade landed ─────────────────────────────────────

const pkg = readMaybe(path.join(root, "package.json"));

check(
  "T-A0 package.json declares @stripe/stripe-react-native at ^0.65.x or higher",
  pkg !== null &&
    /"@stripe\/stripe-react-native":\s*"\^0\.(?:6[5-9]|[7-9]\d|\d{3,})\.\d+"/.test(
      pkg,
    ),
  "app-mobile/package.json MUST declare @stripe/stripe-react-native at ^0.65.x or higher. Found a lower version → S0 upgrade did not land.",
);

// ─── S3: Expo plugin entry in app.json ────────────────────────────────────

const appJsonRaw = readMaybe(path.join(root, "app.json"));
let appJson = null;
try {
  appJson = appJsonRaw !== null ? JSON.parse(appJsonRaw) : null;
} catch {
  appJson = null;
}

const plugins = appJson?.expo?.plugins ?? [];
const stripePlugin = plugins.find(
  (p) => Array.isArray(p) && p[0] === "@stripe/stripe-react-native",
);
const stripePluginCfg =
  stripePlugin && typeof stripePlugin[1] === "object" ? stripePlugin[1] : null;

check(
  "T-A1 app.json plugins block includes @stripe/stripe-react-native with merchantIdentifier + enableGooglePay",
  stripePluginCfg !== null &&
    typeof stripePluginCfg.merchantIdentifier === "string" &&
    stripePluginCfg.merchantIdentifier.length > 0 &&
    stripePluginCfg.enableGooglePay === true,
  "app-mobile/app.json `expo.plugins` MUST contain [\"@stripe/stripe-react-native\", {merchantIdentifier, enableGooglePay: true}] entry.",
);

// ─── S1: StripeNativeProvider props ───────────────────────────────────────

const provider = readMaybe(
  path.join(repoRoot, "packages/payments-native/StripeNativeProvider.tsx"),
);

check(
  "T-A2 StripeNativeProvider declares merchantIdentifier + urlScheme props",
  provider !== null &&
    /merchantIdentifier\?:\s*string/.test(provider) &&
    /urlScheme\?:\s*string/.test(provider),
  "packages/payments-native/StripeNativeProvider.tsx props interface MUST declare optional merchantIdentifier + urlScheme.",
);

check(
  "T-A3 StripeNativeProvider passes merchantIdentifier + urlScheme to <StripeProvider>",
  provider !== null &&
    /<StripeProvider[\s\S]{0,400}?merchantIdentifier=\{/.test(provider) &&
    /<StripeProvider[\s\S]{0,400}?urlScheme=\{/.test(provider),
  "The <StripeProvider> JSX inside StripeNativeProvider MUST receive both merchantIdentifier and urlScheme props.",
);

// ─── S2: app/_layout.tsx passes both props (OR env vars are set) ──────────

const layout = readMaybe(path.join(root, "app/_layout.tsx"));

check(
  "T-A4 app/_layout.tsx passes merchantIdentifier + urlScheme to <StripeNativeProvider>",
  layout !== null &&
    /<StripeNativeProvider[\s\S]{0,400}?merchantIdentifier=/.test(layout) &&
    /<StripeNativeProvider[\s\S]{0,400}?urlScheme=/.test(layout),
  "app/_layout.tsx MUST pass merchantIdentifier + urlScheme to <StripeNativeProvider>. (Env-var fallback exists in StripeNativeProvider but explicit props at the mount site are required for static guarantees.)",
);

// ─── S4: TicketClaimConfirmModal migration ────────────────────────────────
//
// [TEST-MOD-APPROVED ORCH-0847] — T-A5 through T-A9 RETIRED 2026-05-15
//
// ORCH-0847 [Consumer ticket purchase parity with public business page]
// Phase C deleted TicketClaimConfirmModal.tsx entirely — it was a
// single-ticket confirmation surface, superseded by the multi-tier
// `TicketCartSheet` from the same Phase C. The replacement contracts are
// enforced by:
//   - .github/scripts/strict-grep/orch-0847-ticket-claim-confirm-modal-removed.mjs
//     (asserts the file is GONE + no imports remain)
//   - .github/scripts/strict-grep/orch-0847-consumer-multi-line-checkout.mjs
//     (asserts <TicketCartSheet> is rendered in ExpandedBusinessEventSheet)
//
// The Stripe-RN-config contracts T-A0 through T-A4 above stay live —
// those are the @stripe/stripe-react-native@0.65.x baseline + app.json
// plugin entry + StripeNativeProvider props + _layout passthrough, all
// of which ORCH-0847 left untouched.
//
// I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM is preserved post-Phase-C:
// TicketCartSheet uses @gorhom/bottom-sheet (not RN Modal). The Phase-C
// design verdict + this checkpoint chain enforce that invariant
// architecturally; a future regression would surface via the new
// orch-0847-consumer-multi-line-checkout gate.

check(
  "T-A5 [RETIRED ORCH-0847] TicketClaimConfirmModal → @gorhom/bottom-sheet import — modal deleted",
  true,
  "Retired per ORCH-0847 Phase C. The new TicketCartSheet uses @gorhom/bottom-sheet directly; see orch-0847-ticket-claim-confirm-modal-removed.mjs.",
);

check(
  "T-A6 [RETIRED ORCH-0847] TicketClaimConfirmModal → no RN Modal — modal deleted",
  true,
  "Retired per ORCH-0847 Phase C. Modal file no longer exists.",
);

check(
  "T-A7 [RETIRED ORCH-0847] TicketClaimConfirmModal → BottomSheetBackdrop pressBehavior=\"close\" — modal deleted",
  true,
  "Retired per ORCH-0847 Phase C. The replacement TicketCartSheet uses the same backdrop pattern.",
);

check(
  "T-A8 [RETIRED ORCH-0847] TicketClaimConfirmModal controlled-component props — modal deleted",
  true,
  "Retired per ORCH-0847 Phase C. TicketCartSheet has its own controlled-component contract (visible / onCancel / onCheckout).",
);

check(
  "T-A9 [RETIRED ORCH-0847] ExpandedBusinessEventSheet renders TicketClaimConfirmModal — superseded by TicketCartSheet",
  true,
  "Retired per ORCH-0847 Phase C. ExpandedBusinessEventSheet now renders <TicketCartSheet>; orch-0847-consumer-multi-line-checkout.mjs enforces.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0834-rescoped regression check\n");
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
