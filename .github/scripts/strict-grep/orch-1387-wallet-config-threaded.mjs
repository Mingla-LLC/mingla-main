#!/usr/bin/env node
/**
 * ORCH-1387 — I-PROPOSED-1387-WALLET-CONFIG-THREADED strict-grep gate.
 *
 * WHY (INVESTIGATION_ORCH-1387 F-2): the ORCH-1246 Apple-4.9 fix shipped with
 * HELPER-MATH coverage only — `buildApplePayCartItems` unit tests. Deleting
 * the entire `applePay:` block, the `cartItems:` line, or the `googlePay:`
 * block from any callsite failed NO test and NO gate: the 4.9 behavior
 * (Apple Pay sheet shows the PRODUCT title — fallback "Ticket"/"Reservation"
 * — NEVER the company/merchantDisplayName) had zero regression net. That was
 * the real App-Review compliance exposure. This gate is the primary net.
 *
 * Scanned files:
 *   B = mingla-business/src/payments/nativeCheckoutFlow.native.ts
 *   C = app-mobile/src/payments/nativeCheckoutFlow.ts
 *   R = app-mobile/src/hooks/useReserveTable.ts
 *   H = packages/payments-native/useStripePaymentSheet.ts
 *   T = packages/payments-native/types.ts
 *
 * Rules (ALL must hold → exit 0; any violation → exit 1; fs error → exit 2):
 *   W-1/W-2/W-3 — B/C/R each contain exactly ONE `initPaymentSheet(` in
 *                 comment-stripped text (uniqueness companion, COMMS-0106 —
 *                 a second call shape can't smuggle an unguarded config).
 *   W-4/W-5     — B/C: inside the single call's argument span: `applePay`,
 *                 `merchantCountryCode`, `cartItems: buildApplePayCartItems(`.
 *   W-6/W-7     — B/C: same span has a `googlePay` block carrying its own
 *                 `merchantCountryCode`.
 *   W-8         — R: the `walletConfig` declaration body has `applePay`,
 *                 `cartItems: buildApplePayCartItems(`, `googlePay`; AND the
 *                 call span spreads `...walletConfig`.
 *   W-9         — R: no `as Record<string, unknown>` (the F-5 cast must
 *                 never return).
 *   W-10        — H: whole-object forward `initPaymentSheet(input)` present;
 *                 neither `applePay` nor `merchantDisplayName` present (the
 *                 hook must forward, never rebuild or pick).
 *   W-11        — T: `applePay?: PaymentSheet.ApplePayParams` and
 *                 `googlePay?: PaymentSheet.GooglePayParams` declared (guards
 *                 the type-extension revert on raw checkout, independent of
 *                 the scoped typecheck lane).
 *
 * Preprocessing (COMMS-0106 ORPHAN-2 defense — stronger than the 0849 gate):
 * BOTH `//` line comments AND `/* … *​/` block comments are stripped by a
 * string-aware scanner before any match, so a decoy block living only inside
 * a comment can never satisfy a rule.
 *
 * `--self-test` proves every rule fires on its violation shape with
 * in-memory fixtures (no repo dependency).
 *
 * Companions (defense in depth, SPEC_ORCH-1387 §4.5):
 *   - mingla-business/src/payments/__tests__/walletConfigThreading.orch1387.test.mjs
 *   - app-mobile/src/payments/__tests__/wallet_config_threading.orch1387.test.mjs
 *   - packages/payments-native/tsconfig.orch1387.typetest.json (type half)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

export const FILES = {
  B: "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
  C: "app-mobile/src/payments/nativeCheckoutFlow.ts",
  R: "app-mobile/src/hooks/useReserveTable.ts",
  H: "packages/payments-native/useStripePaymentSheet.ts",
  T: "packages/payments-native/types.ts",
};

/**
 * String-aware scanner. Produces:
 *  - stripped: comments replaced by spaces (newlines kept), strings INTACT —
 *    used for token matching (a token inside a comment can never match).
 *  - masked: comments AND string/template CONTENTS replaced by spaces —
 *    used for delimiter (paren/brace) matching so parens inside string
 *    literals can't derail span extraction.
 */
export function scan(source) {
  const n = source.length;
  const stripped = source.split("");
  const masked = source.split("");
  let state = "code"; // code | line | block | squote | dquote | template
  let templateDepth = 0; // ${ … } nesting inside a template literal
  for (let i = 0; i < n; i++) {
    const ch = source[i];
    const next = i + 1 < n ? source[i + 1] : "";
    const blank = (arr) => {
      if (arr[i] !== "\n") arr[i] = " ";
    };
    switch (state) {
      case "code":
        if (ch === "/" && next === "/") {
          state = "line";
          blank(stripped);
          blank(masked);
        } else if (ch === "/" && next === "*") {
          state = "block";
          blank(stripped);
          blank(masked);
        } else if (ch === "'") {
          state = "squote";
        } else if (ch === '"') {
          state = "dquote";
        } else if (ch === "`") {
          state = "template";
        } else if (ch === "}" && templateDepth > 0) {
          // closing a ${ … } interpolation → back into the template literal
          templateDepth--;
          state = "template";
        }
        break;
      case "line":
        if (ch === "\n") {
          state = "code";
        } else {
          blank(stripped);
          blank(masked);
        }
        break;
      case "block":
        if (ch === "*" && next === "/") {
          blank(stripped);
          blank(masked);
          if (i + 1 < n && source[i + 1] !== "\n") masked[i + 1] = " ";
          if (i + 1 < n && stripped[i + 1] !== "\n") stripped[i + 1] = " ";
          i++; // consume the '/'
          state = "code";
        } else {
          blank(stripped);
          blank(masked);
        }
        break;
      case "squote":
        if (ch === "\\") {
          blank(masked);
          if (i + 1 < n && source[i + 1] !== "\n") masked[i + 1] = " ";
          i++;
        } else if (ch === "'") {
          state = "code";
        } else {
          blank(masked);
        }
        break;
      case "dquote":
        if (ch === "\\") {
          blank(masked);
          if (i + 1 < n && source[i + 1] !== "\n") masked[i + 1] = " ";
          i++;
        } else if (ch === '"') {
          state = "code";
        } else {
          blank(masked);
        }
        break;
      case "template":
        if (ch === "\\") {
          blank(masked);
          if (i + 1 < n && source[i + 1] !== "\n") masked[i + 1] = " ";
          i++;
        } else if (ch === "$" && next === "{") {
          templateDepth++;
          state = "code";
          i++; // consume '{' as part of the interpolation opener
        } else if (ch === "`") {
          state = "code";
        } else {
          blank(masked);
        }
        break;
      default:
        throw new Error(`unreachable scanner state ${state}`);
    }
  }
  return { stripped: stripped.join(""), masked: masked.join("") };
}

/** Count occurrences of a literal token in text. */
function countToken(text, token) {
  let count = 0;
  let idx = 0;
  for (;;) {
    idx = text.indexOf(token, idx);
    if (idx === -1) return count;
    count++;
    idx += token.length;
  }
}

/**
 * Extract the argument span of the SINGLE `initPaymentSheet(` call:
 * from the opening paren to its matched closing paren (delimiter-matched on
 * the masked text so string contents can't derail it). Returns the STRIPPED
 * slice, or null when absent/unbalanced.
 */
export function callSpan(scanned) {
  const start = scanned.stripped.indexOf("initPaymentSheet(");
  if (start === -1) return null;
  const openIdx = start + "initPaymentSheet".length;
  let depth = 0;
  for (let i = openIdx; i < scanned.masked.length; i++) {
    const ch = scanned.masked[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return scanned.stripped.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * Extract a `{ … }` block that starts at the first `{` at/after fromIdx.
 * Brace-matched on masked text; returns the stripped slice or null.
 */
function braceBlock(scanned, fromIdx) {
  const open = scanned.masked.indexOf("{", fromIdx);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < scanned.masked.length; i++) {
    const ch = scanned.masked[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return scanned.stripped.slice(open, i + 1);
    }
  }
  return null;
}

/** The googlePay block inside a span (stripped text of the span). */
function googlePayBlock(spanScanned) {
  const idx = spanScanned.stripped.indexOf("googlePay");
  if (idx === -1) return null;
  return braceBlock(spanScanned, idx);
}

/** The walletConfig declaration body in R (stripped). */
export function walletConfigBody(scanned) {
  const decl = scanned.stripped.indexOf("const walletConfig");
  if (decl === -1) return null;
  const eq = scanned.masked.indexOf("=", decl);
  if (eq === -1) return null;
  return braceBlock(scanned, eq);
}

const CART_TOKEN = "cartItems: buildApplePayCartItems(";

/** Flow-file rules (B → W-1/W-4/W-6; C → W-2/W-5/W-7). */
export function checkFlowFile(source, label, ids) {
  const failures = [];
  const scanned = scan(source);
  const calls = countToken(scanned.stripped, "initPaymentSheet(");
  if (calls !== 1) {
    failures.push(
      `${ids.unique}: ${label} must contain exactly ONE initPaymentSheet( call (found ${calls}) — uniqueness companion.`,
    );
    return failures; // span rules are meaningless without the single call
  }
  const span = callSpan(scanned);
  if (span === null) {
    failures.push(`${ids.unique}: ${label} initPaymentSheet( call span could not be delimiter-matched.`);
    return failures;
  }
  if (!span.includes("applePay")) {
    failures.push(`${ids.apple}: ${label} call span is missing the applePay config block (Apple Pay dark + 4.9 net gone).`);
  }
  if (!span.includes("merchantCountryCode")) {
    failures.push(`${ids.apple}: ${label} call span is missing merchantCountryCode.`);
  }
  if (!span.includes(CART_TOKEN)) {
    failures.push(
      `${ids.apple}: ${label} call span is missing \`${CART_TOKEN}…)\` — the Apple-4.9 product line (label = product title, fallback "Ticket"/"Reservation", NEVER the company).`,
    );
  }
  const spanScanned = { stripped: span, masked: scan(span).masked };
  const gp = googlePayBlock(spanScanned);
  if (gp === null) {
    failures.push(`${ids.google}: ${label} call span is missing the googlePay config block (Android analog).`);
  } else if (!gp.includes("merchantCountryCode")) {
    failures.push(`${ids.google}: ${label} googlePay block is missing its merchantCountryCode.`);
  }
  return failures;
}

/** Reserve-hook rules (R → W-3/W-8/W-9). */
export function checkReserveFile(source, label) {
  const failures = [];
  const scanned = scan(source);
  const calls = countToken(scanned.stripped, "initPaymentSheet(");
  if (calls !== 1) {
    failures.push(
      `W-3: ${label} must contain exactly ONE initPaymentSheet( call (found ${calls}) — uniqueness companion.`,
    );
  }
  const body = walletConfigBody(scanned);
  if (body === null) {
    failures.push(`W-8: ${label} is missing the walletConfig declaration body.`);
  } else {
    if (!body.includes("applePay")) {
      failures.push(`W-8: ${label} walletConfig body is missing applePay.`);
    }
    if (!body.includes(CART_TOKEN)) {
      failures.push(`W-8: ${label} walletConfig body is missing \`${CART_TOKEN}…)\` — the Apple-4.9 product line.`);
    }
    if (!body.includes("googlePay")) {
      failures.push(`W-8: ${label} walletConfig body is missing googlePay.`);
    }
  }
  if (calls === 1) {
    const span = callSpan(scanned);
    if (span === null || !span.includes("...walletConfig")) {
      failures.push(
        `W-8: ${label} initPaymentSheet call span is missing the \`...walletConfig\` spread (config declared but never passed).`,
      );
    }
  }
  if (scanned.stripped.includes("as Record<string, unknown>")) {
    failures.push(
      `W-9: ${label} contains \`as Record<string, unknown>\` — the F-5 cast suppresses all type checking of the wallet payload and must never return.`,
    );
  }
  return failures;
}

/** Hook rules (H → W-10). */
export function checkHookFile(source, label) {
  const failures = [];
  const { stripped } = scan(source);
  if (!stripped.includes("initPaymentSheet(input)")) {
    failures.push(
      `W-10: ${label} must forward the WHOLE input object — \`initPaymentSheet(input)\` not found (no destructure/pick/rebuild).`,
    );
  }
  if (stripped.includes("applePay")) {
    failures.push(`W-10: ${label} must not mention applePay — the hook forwards, it never rebuilds the wallet config.`);
  }
  if (stripped.includes("merchantDisplayName")) {
    failures.push(`W-10: ${label} must not mention merchantDisplayName — the hook forwards, it never rebuilds the sheet config.`);
  }
  return failures;
}

/** Type-contract rules (T → W-11). */
export function checkTypesFile(source, label) {
  const failures = [];
  const { stripped } = scan(source);
  if (!/applePay\?\s*:\s*PaymentSheet\.ApplePayParams/.test(stripped)) {
    failures.push(
      `W-11: ${label} must declare \`applePay?: PaymentSheet.ApplePayParams\` (vendor-typed first-class wallet key, ORCH-1387).`,
    );
  }
  if (!/googlePay\?\s*:\s*PaymentSheet\.GooglePayParams/.test(stripped)) {
    failures.push(
      `W-11: ${label} must declare \`googlePay?: PaymentSheet.GooglePayParams\` (vendor-typed first-class wallet key, ORCH-1387).`,
    );
  }
  return failures;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const problems = [];
  const expectClean = (name, failures) => {
    if (failures.length > 0) problems.push(`${name} wrongly flagged: ${failures.join(" | ")}`);
  };
  const expectFail = (name, failures, mustMention) => {
    if (failures.length === 0) {
      problems.push(`${name} was NOT flagged`);
    } else if (mustMention && !failures.some((f) => f.includes(mustMention))) {
      problems.push(`${name} flagged, but not by ${mustMention}: ${failures.join(" | ")}`);
    }
  };

  const goodFlow = `
    const initResult = await initPaymentSheet({
      merchantDisplayName: MERCHANT_DISPLAY_NAME,
      paymentIntentClientSecret: data.clientSecret,
      returnURL: \`\${BUSINESS_URL_SCHEME}://stripe-redirect\`,
      applePay: {
        merchantCountryCode: "US",
        cartItems: buildApplePayCartItems(input.displayTitle, data.totalCents, "Ticket"),
      },
      googlePay: {
        merchantCountryCode: "US",
        testEnv: isStripeGooglePayTestEnv(),
        currencyCode: "usd",
      },
    });
    const msg = "Couldn't open payment sheet.";
  `;
  const ids = { unique: "W-1", apple: "W-4", google: "W-6" };
  expectClean("good flow file", checkFlowFile(goodFlow, "fixture-B", ids));

  // W-4: applePay block deleted entirely
  const noApplePay = goodFlow.replace(/applePay: \{[\s\S]*?\},\n/, "");
  expectFail("flow w/o applePay block", checkFlowFile(noApplePay, "fixture-B", ids), "W-4");

  // W-4: cartItems line deleted, applePay shell kept
  const noCartItems = goodFlow.replace(/cartItems: buildApplePayCartItems\([^)]*\),\n/, "");
  expectFail("flow w/o cartItems line", checkFlowFile(noCartItems, "fixture-B", ids), "W-4");

  // W-6: googlePay block deleted
  const noGooglePay = goodFlow.replace(/googlePay: \{[\s\S]*?\},\n/, "");
  expectFail("flow w/o googlePay block", checkFlowFile(noGooglePay, "fixture-B", ids), "W-6");

  // W-6: googlePay block missing its merchantCountryCode
  const gpNoCountry = goodFlow.replace(
    /googlePay: \{\n\s*merchantCountryCode: "US",/,
    "googlePay: {",
  );
  expectFail("googlePay w/o merchantCountryCode", checkFlowFile(gpNoCountry, "fixture-B", ids), "W-6");

  // ORPHAN-2 (T-12): real applePay deleted, decoy lives ONLY in a block comment
  const blockCommentDecoy = `
    /* applePay: {
         merchantCountryCode: "US",
         cartItems: buildApplePayCartItems(input.displayTitle, data.totalCents, "Ticket"),
       }, */
    const initResult = await initPaymentSheet({
      merchantDisplayName: MERCHANT_DISPLAY_NAME,
      paymentIntentClientSecret: data.clientSecret,
      googlePay: {
        merchantCountryCode: "US",
        testEnv: true,
      },
    });
  `;
  expectFail("applePay only inside a block comment", checkFlowFile(blockCommentDecoy, "fixture-B", ids), "W-4");

  // ORPHAN-2 variant: decoy block comment INSIDE the call span
  const inSpanDecoy = `
    const initResult = await initPaymentSheet({
      merchantDisplayName: MERCHANT_DISPLAY_NAME,
      paymentIntentClientSecret: data.clientSecret,
      /* applePay: {
           merchantCountryCode: "US",
           cartItems: buildApplePayCartItems(input.displayTitle, data.totalCents, "Ticket"),
         }, */
      googlePay: {
        merchantCountryCode: "US",
        testEnv: true,
      },
    });
  `;
  expectFail("in-span block-comment decoy applePay", checkFlowFile(inSpanDecoy, "fixture-B", ids), "W-4");

  // Line-comment decoy
  const lineCommentDecoy = goodFlow
    .replace("applePay: {", "// applePay: {")
    .replace('merchantCountryCode: "US",\n        cartItems', '// merchantCountryCode: "US",\n        // cartItems')
    .replace("cartItems: buildApplePayCartItems(input.displayTitle, data.totalCents, \"Ticket\"),\n      },", "cartItems2: null,\n      //},");
  expectFail("line-comment decoy applePay", checkFlowFile(lineCommentDecoy, "fixture-B", ids), "W-4");

  // T-13: duplicate initPaymentSheet( call → W-1 uniqueness fires
  const duplicated = goodFlow + "\n await initPaymentSheet({ merchantDisplayName: 'X' });\n";
  expectFail("duplicate initPaymentSheet call", checkFlowFile(duplicated, "fixture-B", ids), "W-1");

  // Good reserve fixture (post-ORCH-1387 shape)
  const goodReserve = `
    const { initPaymentSheet, presentPaymentSheet } = useStripePaymentSheet();
    const walletConfig: Pick<PaymentSheetInitInput, "applePay" | "googlePay"> = {
      applePay: {
        merchantCountryCode: "US",
        cartItems: buildApplePayCartItems(displayTitle, created.totalCents, "Reservation"),
      },
      googlePay: {
        merchantCountryCode: "US",
        testEnv: isStripeGooglePayTestEnv(),
        currencyCode: created.currency.toLowerCase(),
      },
    };
    const initResult = await initPaymentSheet({
      merchantDisplayName: MERCHANT_DISPLAY_NAME,
      paymentIntentClientSecret: created.clientSecret,
      returnURL: "com.mingla.app.v2://stripe-redirect",
      ...walletConfig,
    });
  `;
  expectClean("good reserve file", checkReserveFile(goodReserve, "fixture-R"));

  // W-8: applePay deleted from walletConfig
  const reserveNoApple = goodReserve.replace(/applePay: \{[\s\S]*?\},\n/, "");
  expectFail("reserve w/o applePay in walletConfig", checkReserveFile(reserveNoApple, "fixture-R"), "W-8");

  // W-8 spread half: ...walletConfig deleted, declaration kept
  const reserveNoSpread = goodReserve.replace("      ...walletConfig,\n", "");
  expectFail("reserve w/o ...walletConfig spread", checkReserveFile(reserveNoSpread, "fixture-R"), "W-8");

  // W-9: the F-5 cast re-introduced
  const reserveCast = goodReserve.replace("...walletConfig,", "...(walletConfig as Record<string, unknown>),");
  expectFail("reserve with as Record<string, unknown> cast", checkReserveFile(reserveCast, "fixture-R"), "W-9");

  // W-9 must NOT fire on a comment mention
  const reserveCastComment = goodReserve.replace(
    "const initResult",
    "// historical: ...(walletConfig as Record<string, unknown>) was the F-5 cast\n    const initResult",
  );
  expectClean("reserve with cast mentioned only in a comment", checkReserveFile(reserveCastComment, "fixture-R"));

  // W-3: duplicate call in reserve file
  const reserveDup = goodReserve + "\n await initPaymentSheet({ merchantDisplayName: 'X' });\n";
  expectFail("reserve duplicate initPaymentSheet call", checkReserveFile(reserveDup, "fixture-R"), "W-3");

  // Good hook fixture
  const goodHook = `
    const p = (async () => {
      const result = normalizePaymentSheetResult(
        await initPaymentSheet(input),
      );
      return result;
    })();
  `;
  expectClean("good hook file", checkHookFile(goodHook, "fixture-H"));

  // W-10: hook rebuilds instead of forwarding
  const hookRebuild = goodHook.replace(
    "await initPaymentSheet(input),",
    "await initPaymentSheet({ merchantDisplayName: input.merchantDisplayName, applePay: input.applePay }),",
  );
  expectFail("hook picks/rebuilds the config", checkHookFile(hookRebuild, "fixture-H"), "W-10");

  // W-10: forward removed entirely
  const hookNoForward = goodHook.replace("await initPaymentSheet(input),", "await initPaymentSheet({}),");
  expectFail("hook drops the whole-object forward", checkHookFile(hookNoForward, "fixture-H"), "W-10");

  // Good types fixture
  const goodTypes = `
    import type { PaymentSheet } from "@stripe/stripe-react-native";
    export interface PaymentSheetInitInput {
      merchantDisplayName: string;
      paymentIntentClientSecret: string;
      applePay?: PaymentSheet.ApplePayParams;
      googlePay?: PaymentSheet.GooglePayParams;
    }
  `;
  expectClean("good types file", checkTypesFile(goodTypes, "fixture-T"));

  // W-11: wallet keys removed
  const typesReverted = goodTypes
    .replace("applePay?: PaymentSheet.ApplePayParams;\n", "")
    .replace("googlePay?: PaymentSheet.GooglePayParams;\n", "");
  expectFail("types w/o wallet keys", checkTypesFile(typesReverted, "fixture-T"), "W-11");

  // W-11: declarations present only inside a block comment
  const typesCommented = typesReverted.replace(
    "export interface PaymentSheetInitInput {",
    "/* applePay?: PaymentSheet.ApplePayParams;\n googlePay?: PaymentSheet.GooglePayParams; */\n export interface PaymentSheetInitInput {",
  );
  expectFail("types wallet keys only in a block comment", checkTypesFile(typesCommented, "fixture-T"), "W-11");

  if (problems.length > 0) {
    console.error("[orch-1387-wallet-config-threaded] SELF-TEST FAIL:");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log(
    "[orch-1387-wallet-config-threaded] SELF-TEST PASS — every W-rule fires on its violation shape (incl. ORPHAN-2 block-comment decoys, duplicate-call uniqueness, spread-deleted-declaration-kept, cast re-introduction, hook rebuild, type revert).",
  );
  process.exit(0);
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  if (process.argv.includes("--self-test")) selfTest();

  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(repoRoot, rel), "utf8");
    } catch (err) {
      console.error(`[orch-1387-wallet-config-threaded] FS ERROR — could not read ${rel}: ${err.message}`);
      process.exit(2);
    }
  };

  const failures = [
    ...checkFlowFile(read(FILES.B), FILES.B, { unique: "W-1", apple: "W-4", google: "W-6" }),
    ...checkFlowFile(read(FILES.C), FILES.C, { unique: "W-2", apple: "W-5", google: "W-7" }),
    ...checkReserveFile(read(FILES.R), FILES.R),
    ...checkHookFile(read(FILES.H), FILES.H),
    ...checkTypesFile(read(FILES.T), FILES.T),
  ];

  if (failures.length > 0) {
    console.error(
      "[orch-1387-wallet-config-threaded] FAIL — I-PROPOSED-1387-WALLET-CONFIG-THREADED violated (Apple-4.9 wallet threading net):",
    );
    for (const f of failures) console.error("  - " + f);
    console.error("");
    console.error(
      "See Mingla_Artifacts/specs/SPEC_ORCH-1387_WALLET_TYPE_CONTRACT_AND_49_NET.md §4.5.1 + INVESTIGATION_ORCH-1387 F-2.",
    );
    process.exit(1);
  }

  console.log(
    "[orch-1387-wallet-config-threaded] PASS — W-1..W-11 hold: all three callsites thread applePay (cartItems via buildApplePayCartItems) + googlePay inside their single initPaymentSheet call, the hook forwards the whole object, the F-5 cast is gone, and the wallet keys are first-class vendor-typed members of PaymentSheetInitInput.",
  );
  process.exit(0);
}

// Run only when executed directly (the exported checkers stay import-safe).
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
