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

const confirm = readMaybe(
  path.join(
    root,
    "src/components/expandedCard/TicketClaimConfirmModal.tsx",
  ),
);

check(
  "T-A5 TicketClaimConfirmModal imports BottomSheet from @gorhom/bottom-sheet",
  confirm !== null &&
    /import\s+BottomSheet[\s\S]{0,300}?from\s+["']@gorhom\/bottom-sheet["']/.test(
      confirm,
    ),
  "TicketClaimConfirmModal MUST import BottomSheet from @gorhom/bottom-sheet (migration from RN Modal to inline bottom-sheet).",
);

check(
  "T-A6 TicketClaimConfirmModal does NOT import RN Modal anymore",
  confirm !== null &&
    !/import\s*\{[\s\S]{0,200}?\bModal\b[\s\S]{0,200}?\}\s*from\s*["']react-native["']/.test(
      confirm,
    ),
  "TicketClaimConfirmModal MUST NOT import Modal from react-native (proves migration completion — RN Modal was the prior wrapper, BottomSheet replaces it).",
);

check(
  "T-A7 TicketClaimConfirmModal uses BottomSheetBackdrop with pressBehavior=\"close\"",
  confirm !== null &&
    /BottomSheetBackdrop/.test(confirm) &&
    /pressBehavior=["']close["']/.test(confirm),
  "TicketClaimConfirmModal MUST use BottomSheetBackdrop with pressBehavior=\"close\" so backdrop tap dismisses the sheet (matches the event-detail sheet pattern at ExpandedBusinessEventSheet.tsx).",
);

check(
  "T-A8 TicketClaimConfirmModal preserves controlled-component props (visible / onCancel / onConfirm)",
  confirm !== null &&
    /visible:\s*boolean/.test(confirm) &&
    /onCancel:\s*\(\s*\)\s*=>\s*void/.test(confirm) &&
    /onConfirm:\s*\(\s*\)\s*=>\s*void/.test(confirm),
  "TicketClaimConfirmModal props MUST preserve visible: boolean + onCancel: () => void + onConfirm: () => void so the ExpandedBusinessEventSheet consumer is unchanged.",
);

// ─── S5: ExpandedBusinessEventSheet consumer still renders the modal ─────

const sheet = readMaybe(
  path.join(
    root,
    "src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
  ),
);

check(
  "T-A9 ExpandedBusinessEventSheet still renders <TicketClaimConfirmModal>",
  sheet !== null && /<TicketClaimConfirmModal[\s\S]{0,50}/.test(sheet),
  "ExpandedBusinessEventSheet MUST still render <TicketClaimConfirmModal> (the sibling-fragment pattern from ORCH-0828 should be intact post-migration).",
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
