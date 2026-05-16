#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0847 [Consumer ticket purchase parity with public business page]
 * happy-path regression check (implementor-written, per CLOSE Step 0.5).
 *
 * Mirrors the in-repo CI script pattern (no Jest infra in app-mobile;
 * tests are Node assertions against the on-disk source of truth).
 *
 * Asserts the contracts that make this campaign regression-proof:
 *
 *   Phase A1 (phone-input package extraction):
 *     T-A1 packages/phone-input/ package files exist
 *     T-A2 packages/phone-input exports PhoneInput + PhoneInputTheme type
 *     T-A3 app-mobile thin wrappers preserve original consumer API
 *
 *   Phase A2 (QuantityRow extraction):
 *     T-A4 packages/event-rendering/QuantityRow.tsx exists with QuantityRowTheme
 *     T-A5 mingla-business QuantityRow thin wrapper imports from package
 *
 *   Phase B (public phone field UX):
 *     T-B1 mingla-business/src/utils/phone.ts exports isValidE164 + composeE164
 *     T-B2 mingla-business buyer.tsx imports PhoneInput from @mingla/phone-input
 *     T-B3 buyer.tsx calls isValidE164 for phone validation
 *     T-B4 buyer.tsx has fieldLabelRow + required asterisk styles
 *
 *   Phase C (consumer cart sheet):
 *     T-C1 TicketCartSheet.tsx exists + default export
 *     T-C2 useTicketCart hook exists + uses useReducer (not Zustand)
 *     T-C3 ConsumerCartCard.tsx exists + default export
 *     T-C4 ExpandedBusinessEventSheet imports TicketCartSheet
 *     T-C5 ExpandedBusinessEventSheet has cartSheetVisible + initialTicketTypeId state
 *     T-C6 ExpandedBusinessEventSheet renders <TicketCartSheet>
 *     T-C7 TicketCartSheet defaults marketingOptIn to useState<boolean>(false)
 *     T-C8 TicketCartSheet imports QuantityRow from @mingla/event-rendering
 *     T-C9 TicketCartSheet uses Icon name="add" (not "plus") for the plus glyph
 *     T-C10 TicketCartSheet uses 92% snap point
 *     T-C11 handleBuy accepts TicketCartCheckoutPayload + uses payload.totalCents > 0
 *     T-C12 TicketClaimConfirmModal.tsx DELETED (orphan removed)
 *
 * Invariants codified:
 *   I-PROPOSED-CONSUMER-MULTI-LINE-CHECKOUT (T-C5..T-C8, T-C11)
 *   I-PROPOSED-PUBLIC-PHONE-FIELD-E164-CLIENT-SIDE (T-B1..T-B3)
 *   I-PROPOSED-MARKETING-OPT-IN-DEFAULT-UNCHECKED (T-C7)
 *
 * Adversarial regression tests (different attack angles) are the tester's
 * responsibility per CLOSE Step 0.5 — see Claude `mingla-forensics` TEST
 * mode QA report.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appMobileRoot = path.resolve(__dirname, "../..");
const workspaceRoot = path.resolve(appMobileRoot, "..");

const readMaybe = (absPath) => {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
};

const fromAppMobile = (rel) => readMaybe(path.join(appMobileRoot, rel));
const fromWorkspace = (rel) => readMaybe(path.join(workspaceRoot, rel));
const existsAt = (absPath) => fs.existsSync(absPath);

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

// ─── Phase A1 — phone-input package ───────────────────────────────────────

const phoneInputPkg = fromWorkspace("packages/phone-input/package.json");
const phoneInputIndex = fromWorkspace("packages/phone-input/index.ts");
const phoneInputPhone = fromWorkspace("packages/phone-input/PhoneInput.tsx");
const phoneInputCountries = fromWorkspace("packages/phone-input/countries.ts");

check(
  "T-A1 packages/phone-input/ package files exist",
  phoneInputPkg !== null &&
    phoneInputIndex !== null &&
    phoneInputPhone !== null &&
    phoneInputCountries !== null,
  "packages/phone-input/ MUST contain package.json + index.ts + PhoneInput.tsx + countries.ts.",
);

check(
  "T-A2 packages/phone-input exports PhoneInput + PhoneInputTheme type",
  phoneInputIndex !== null &&
    /export\s*\{\s*PhoneInput\s*\}/.test(phoneInputIndex) &&
    /PhoneInputTheme/.test(phoneInputIndex),
  "packages/phone-input/index.ts MUST export both `PhoneInput` and the `PhoneInputTheme` type.",
);

const consumerThinPhone = fromAppMobile(
  "src/components/onboarding/PhoneInput.tsx",
);
check(
  "T-A3 app-mobile consumer thin wrapper imports from @mingla/phone-input",
  consumerThinPhone !== null &&
    /from\s+["']@mingla\/phone-input["']/.test(consumerThinPhone) &&
    /export\s+const\s+PhoneInput/.test(consumerThinPhone),
  "app-mobile/src/components/onboarding/PhoneInput.tsx MUST be a thin wrapper around the shared package preserving the original consumer API.",
);

// ─── Phase A2 — QuantityRow extraction ───────────────────────────────────

const quantityRowPkg = fromWorkspace(
  "packages/event-rendering/QuantityRow.tsx",
);
check(
  "T-A4 packages/event-rendering/QuantityRow.tsx exists with QuantityRowTheme",
  quantityRowPkg !== null &&
    /export\s+const\s+QuantityRow/.test(quantityRowPkg) &&
    /QuantityRowTheme/.test(quantityRowPkg),
  "packages/event-rendering/QuantityRow.tsx MUST exist and define QuantityRowTheme.",
);

const businessQrWrapper = fromWorkspace(
  "mingla-business/src/components/checkout/QuantityRow.tsx",
);
check(
  "T-A5 mingla-business QuantityRow thin wrapper imports from package",
  businessQrWrapper !== null &&
    /from\s+["']@mingla\/event-rendering["']/.test(businessQrWrapper),
  "mingla-business/src/components/checkout/QuantityRow.tsx MUST be a thin wrapper importing QuantityRow from @mingla/event-rendering.",
);

// ─── Phase B — public phone field UX ──────────────────────────────────────

const phoneUtil = fromWorkspace("mingla-business/src/utils/phone.ts");
check(
  "T-B1 mingla-business/src/utils/phone.ts exports isValidE164 + composeE164",
  phoneUtil !== null &&
    /export\s+const\s+isValidE164\s*=/.test(phoneUtil) &&
    /export\s+const\s+composeE164\s*=/.test(phoneUtil),
  "mingla-business/src/utils/phone.ts MUST export both `isValidE164` and `composeE164`.",
);

const businessBuyer = fromWorkspace(
  "mingla-business/app/checkout/[eventId]/buyer.tsx",
);
check(
  "T-B2 mingla-business buyer.tsx imports PhoneInput from @mingla/phone-input",
  businessBuyer !== null &&
    /import\s*\{[^}]*\bPhoneInput\b[^}]*\}\s*from\s*["']@mingla\/phone-input["']/.test(
      businessBuyer,
    ),
  "mingla-business buyer.tsx MUST import PhoneInput from @mingla/phone-input.",
);

check(
  "T-B3 buyer.tsx calls isValidE164 for phone validation",
  businessBuyer !== null && /\bisValidE164\s*\(/.test(businessBuyer),
  "buyer.tsx MUST call isValidE164(...) — NOT the deprecated isRequiredPhoneValid alias.",
);

check(
  "T-B4 buyer.tsx has required-asterisk indicator styles",
  businessBuyer !== null &&
    /styles\.fieldLabelRow/.test(businessBuyer) &&
    /styles\.required/.test(businessBuyer),
  "buyer.tsx MUST render required-asterisk indicators (styles.fieldLabelRow + styles.required) per SPEC Q2.",
);

// ─── Phase C — consumer cart sheet ────────────────────────────────────────

const cartSheet = fromAppMobile(
  "src/components/expandedCard/TicketCartSheet.tsx",
);
const cartHook = fromAppMobile("src/hooks/useTicketCart.ts");
const cartCard = fromAppMobile(
  "src/components/expandedCard/ConsumerCartCard.tsx",
);
const expanded = fromAppMobile(
  "src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
);

check(
  "T-C1 TicketCartSheet.tsx exists with default export",
  cartSheet !== null && /export\s+default\s+TicketCartSheet/.test(cartSheet),
  "app-mobile/src/components/expandedCard/TicketCartSheet.tsx MUST exist with a default export.",
);

check(
  "T-C2 useTicketCart hook exists + uses useReducer (not Zustand)",
  cartHook !== null &&
    /export\s+const\s+useTicketCart\s*=/.test(cartHook) &&
    /useReducer/.test(cartHook) &&
    !/from\s+["']zustand["']/.test(cartHook),
  "useTicketCart MUST use useReducer; MUST NOT import from zustand (per feedback_zustand_persist_no_server_snapshots).",
);

check(
  "T-C3 ConsumerCartCard.tsx exists with default export",
  cartCard !== null &&
    /export\s+const\s+ConsumerCartCard/.test(cartCard) &&
    /export\s+default\s+ConsumerCartCard/.test(cartCard),
  "ConsumerCartCard.tsx MUST exist with both named and default exports.",
);

check(
  "T-C4 ExpandedBusinessEventSheet imports TicketCartSheet",
  expanded !== null &&
    /import\s+TicketCartSheet[\s\S]{0,200}?from\s+["']\.\/TicketCartSheet["']/.test(
      expanded,
    ),
  "ExpandedBusinessEventSheet MUST import TicketCartSheet from `./TicketCartSheet`.",
);

check(
  "T-C5 ExpandedBusinessEventSheet has cartSheetVisible + initialTicketTypeId state",
  expanded !== null &&
    /const\s+\[\s*cartSheetVisible\s*,\s*setCartSheetVisible\s*\]\s*=\s*useState/.test(
      expanded,
    ) &&
    /const\s+\[\s*initialTicketTypeId\s*,\s*setInitialTicketTypeId\s*\]\s*=\s*useState/.test(
      expanded,
    ),
  "ExpandedBusinessEventSheet MUST hold `[cartSheetVisible, setCartSheetVisible]` + `[initialTicketTypeId, setInitialTicketTypeId]` state.",
);

check(
  "T-C6 ExpandedBusinessEventSheet renders <TicketCartSheet />",
  expanded !== null && /<TicketCartSheet[\s\S]{0,1500}?\/>/.test(expanded),
  "ExpandedBusinessEventSheet MUST render <TicketCartSheet ... /> in its JSX.",
);

check(
  "T-C7 TicketCartSheet defaults marketingOptIn to useState<boolean>(false)",
  cartSheet !== null &&
    /const\s*\[\s*marketingOptIn\s*,\s*setMarketingOptIn\s*\]\s*=\s*useState<\s*boolean\s*>\s*\(\s*false\s*\)/.test(
      cartSheet,
    ),
  "TicketCartSheet MUST initialise marketingOptIn with `useState<boolean>(false)` — pre-checked opt-in is a GDPR / CAN-SPAM violation.",
);

check(
  "T-C8 TicketCartSheet imports QuantityRow from @mingla/event-rendering",
  cartSheet !== null &&
    /import\s*\{[^}]*\bQuantityRow\b[^}]*\}\s*from\s*["']@mingla\/event-rendering["']/.test(
      cartSheet,
    ),
  "TicketCartSheet MUST import QuantityRow from @mingla/event-rendering (the Phase A2 shared component).",
);

check(
  "T-C9 TicketCartSheet uses Icon name=\"add\" for the plus glyph",
  cartSheet !== null &&
    /name=["']add["']/.test(cartSheet),
  "TicketCartSheet MUST pass `name=\"add\"` to the app-mobile Icon component (not `\"plus\"` which doesn't exist in the consumer Icon set).",
);

check(
  "T-C10 TicketCartSheet snap point is \"92%\"",
  cartSheet !== null && /\["92%"\]/.test(cartSheet),
  "TicketCartSheet MUST snap to 92% so the sheet rises just above the consumer app bottom nav per operator directive 2026-05-15.",
);

check(
  "T-C11 handleBuy accepts TicketCartCheckoutPayload + uses payload.totalCents > 0",
  expanded !== null &&
    /TicketCartCheckoutPayload/.test(expanded) &&
    /payload\.totalCents\s*>\s*0/.test(expanded),
  "ExpandedBusinessEventSheet handleBuy MUST take a TicketCartCheckoutPayload and gate the paid-vs-free polling on `payload.totalCents > 0` (not the prior `!isFreeTicket` literal).",
);

check(
  "T-C12 TicketClaimConfirmModal.tsx DELETED",
  !existsAt(
    path.join(
      appMobileRoot,
      "src/components/expandedCard/TicketClaimConfirmModal.tsx",
    ),
  ),
  "app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx MUST NOT exist after Phase C — superseded by TicketCartSheet.",
);

// ─── Report ─────────────────────────────────────────────────────────────────

console.log("\nORCH-0847 regression check\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    failed += 1;
    console.log(`    ↳ ${c.detail}`);
  }
}

const total = checks.length;
const passed = total - failed;
console.log(`\nSummary: ${passed}/${total} PASS${failed > 0 ? `, ${failed} FAIL` : ""}\n`);

process.exit(failed > 0 ? 1 : 0);
