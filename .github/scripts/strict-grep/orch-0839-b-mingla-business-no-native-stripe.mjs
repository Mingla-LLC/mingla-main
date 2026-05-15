#!/usr/bin/env node
/**
 * ORCH-0839-B strict-grep gate — mingla-business mobile uses ONLY hosted
 * Stripe Checkout. No native @stripe/stripe-react-native imports, no
 * @mingla/payments-native imports, no StripeProvider JSX, no plugin entry.
 *
 * Enforces I-PROPOSED-MINGLA-BUSINESS-HOSTED-CHECKOUT-ONLY.
 *
 * Contracts:
 *   T-G1: no file under mingla-business/{app,src}/ imports
 *         "@stripe/stripe-react-native"
 *   T-G2: no file under mingla-business/{app,src}/ imports
 *         "@mingla/payments-native"
 *   T-G3: mingla-business/app.config.ts plugins array does NOT contain
 *         "@stripe/stripe-react-native"
 *   T-G4: mingla-business/package.json dependencies does NOT include
 *         "@stripe/stripe-react-native" or "@mingla/payments-native"
 *   T-G5: payment.tsx imports expo-web-browser and calls
 *         WebBrowser.openAuthSessionAsync exactly once
 *   T-G6: payment.tsx passes surface="mobile-web" on non-web platforms
 *         (regex on the Platform.OS-driven ternary)
 *   T-G7: app/_layout.tsx does NOT import StripeNativeProvider
 *   T-G8: ticket-checkout-create/index.ts recognises "mobile-web" as a
 *         valid surface value
 *
 * Exit 1 on any FAIL. Pattern follows orch-0778-web-stripe-native-import-gate.mjs.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const failures = [];

const importPatternFactory = (pkg) =>
  new RegExp(
    `(?:import\\s+[^;]*?["']${pkg}["']|from\\s+["']${pkg}["']|require\\(\\s*["']${pkg}["']\\s*\\)|import\\(\\s*["']${pkg}["']\\s*\\))`,
  );

const stripeReactNativePattern = importPatternFactory(
  "@stripe/stripe-react-native",
);
const paymentsNativePattern = importPatternFactory("@mingla/payments-native");

const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const relativePath = path.relative(root, absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    if (stripeReactNativePattern.test(source)) {
      failures.push(
        `T-G1 ${relativePath}: @stripe/stripe-react-native import is forbidden ` +
          `in mingla-business (ORCH-0839-B / I-PROPOSED-MINGLA-BUSINESS-` +
          `HOSTED-CHECKOUT-ONLY).`,
      );
    }
    if (paymentsNativePattern.test(source)) {
      failures.push(
        `T-G2 ${relativePath}: @mingla/payments-native import is forbidden ` +
          `in mingla-business (ORCH-0839-B). app-mobile retains the package; ` +
          `mingla-business no longer consumes it.`,
      );
    }
  }
};

const checkedRoots = ["mingla-business/app", "mingla-business/src"];
for (const checkedRoot of checkedRoots) {
  const absRoot = path.join(root, checkedRoot);
  if (fs.existsSync(absRoot)) {
    walk(absRoot);
  }
}

// T-G3 — app.config.ts plugin entry absent
const appConfigPath = path.join(root, "mingla-business/app.config.ts");
try {
  const appConfigSource = fs.readFileSync(appConfigPath, "utf8");
  // Look for the plugin entry as a string literal inside the plugins array.
  // Comments mentioning @stripe/stripe-react-native are allowed (retirement
  // notes). The actual plugin entry would appear as either:
  //   "@stripe/stripe-react-native"   (in a tuple-form plugin entry)
  // and live OUTSIDE a single-line // comment and OUTSIDE a block /* */
  // comment. Strategy: strip comments before testing.
  const withoutComments = appConfigSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
  if (/["']@stripe\/stripe-react-native["']/.test(withoutComments)) {
    failures.push(
      `T-G3 mingla-business/app.config.ts: @stripe/stripe-react-native plugin ` +
        `entry must be removed (ORCH-0839-B).`,
    );
  }
} catch (error) {
  failures.push(`T-G3 mingla-business/app.config.ts read failed: ${error.message}`);
}

// T-G4 — package.json deps clean
const packageJsonPath = path.join(root, "mingla-business/package.json");
try {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const deps = packageJson.dependencies ?? {};
  if (Object.prototype.hasOwnProperty.call(deps, "@stripe/stripe-react-native")) {
    failures.push(
      `T-G4 mingla-business/package.json: @stripe/stripe-react-native must be ` +
        `removed from dependencies (ORCH-0839-B).`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(deps, "@mingla/payments-native")) {
    failures.push(
      `T-G4 mingla-business/package.json: @mingla/payments-native must be ` +
        `removed from dependencies (ORCH-0839-B). app-mobile retains it.`,
    );
  }
} catch (error) {
  failures.push(`T-G4 mingla-business/package.json parse failed: ${error.message}`);
}

// T-G5 — payment.tsx uses expo-web-browser.openAuthSessionAsync
const paymentPath = path.join(
  root,
  "mingla-business/app/checkout/[eventId]/payment.tsx",
);
let paymentSource = "";
try {
  paymentSource = fs.readFileSync(paymentPath, "utf8");
  if (!/from\s+["']expo-web-browser["']/.test(paymentSource)) {
    failures.push(
      `T-G5 mingla-business/app/checkout/[eventId]/payment.tsx must import ` +
        `expo-web-browser (ORCH-0839-B hosted checkout).`,
    );
  }
  const openAuthMatches =
    paymentSource.match(/WebBrowser\.openAuthSessionAsync\s*\(/g) ?? [];
  if (openAuthMatches.length !== 1) {
    failures.push(
      `T-G5 mingla-business/app/checkout/[eventId]/payment.tsx must call ` +
        `WebBrowser.openAuthSessionAsync exactly once ` +
        `(found ${openAuthMatches.length}).`,
    );
  }
} catch (error) {
  failures.push(`T-G5 payment.tsx read failed: ${error.message}`);
}

// T-G6 — payment.tsx surface discriminator
if (paymentSource) {
  const surfacePattern =
    /Platform\.OS\s*===\s*["']web["']\s*\?\s*["']web["']\s*:\s*["']mobile-web["']/;
  if (!surfacePattern.test(paymentSource)) {
    failures.push(
      `T-G6 mingla-business/app/checkout/[eventId]/payment.tsx must derive ` +
        `surface via Platform.OS === "web" ? "web" : "mobile-web" ` +
        `(ORCH-0839-B SPEC §2.6).`,
    );
  }
}

// T-G7 — app/_layout.tsx does NOT import StripeNativeProvider
const layoutPath = path.join(root, "mingla-business/app/_layout.tsx");
try {
  const layoutSource = fs.readFileSync(layoutPath, "utf8");
  const withoutComments = layoutSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
  if (/import\s+\{\s*StripeNativeProvider\s*\}/.test(withoutComments)) {
    failures.push(
      `T-G7 mingla-business/app/_layout.tsx must not import ` +
        `StripeNativeProvider (ORCH-0839-B).`,
    );
  }
  if (/<StripeNativeProvider[\s>]/.test(withoutComments)) {
    failures.push(
      `T-G7 mingla-business/app/_layout.tsx must not render ` +
        `<StripeNativeProvider> (ORCH-0839-B).`,
    );
  }
} catch (error) {
  failures.push(`T-G7 app/_layout.tsx read failed: ${error.message}`);
}

// T-G8 — ticket-checkout-create/index.ts recognises "mobile-web"
const edgePath = path.join(
  root,
  "supabase/functions/ticket-checkout-create/index.ts",
);
try {
  const edgeSource = fs.readFileSync(edgePath, "utf8");
  if (!/"mobile-web"/.test(edgeSource)) {
    failures.push(
      `T-G8 supabase/functions/ticket-checkout-create/index.ts must accept ` +
        `surface "mobile-web" (ORCH-0839-B SPEC §2.2).`,
    );
  }
  // Also check the success_url emits the custom-scheme deep link.
  if (!/mingla-business:\/\/checkout\/return/.test(edgeSource)) {
    failures.push(
      `T-G8 supabase/functions/ticket-checkout-create/index.ts must emit ` +
        `mingla-business://checkout/return for the mobile-web surface ` +
        `(I-PROPOSED-MOBILE-WEB-SURFACE-RETURNS-CUSTOM-SCHEME).`,
    );
  }
} catch (error) {
  failures.push(`T-G8 ticket-checkout-create/index.ts read failed: ${error.message}`);
}

if (failures.length > 0) {
  console.error("ORCH-0839-B mingla-business no-native-stripe gate failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("ORCH-0839-B mingla-business no-native-stripe gate passed.");
