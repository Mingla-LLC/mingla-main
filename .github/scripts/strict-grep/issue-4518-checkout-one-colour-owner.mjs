#!/usr/bin/env node
// MINGLA-INVARIANT: I-CHECKOUT-ONE-COLOUR-OWNER | issue #4518 | Checkout screens, and every shared part drawn inside them, take `color` and `materials` from the surface tokens the checkout palette sets (checkoutTheme / theme/surfaceTokens), never straight from constants/designSystem.
/**
 * issue #4518 — one colour owner inside checkout.
 *
 * WHY. #4466 pointed checkout TEXT at the host's palette while the parts it is
 * built from (cards, fields, buttons, the dock) kept importing Graphite from
 * `constants/designSystem`. On a light host theme that painted dark ink on
 * dark cards and white input text on a light page, for every buyer. Two
 * colour sources on one screen is the defect; this gate removes the second.
 *
 * RULE. A file in scope may not import the VALUE `color` or `materials` from
 * `constants/designSystem` (plain or aliased: `color as graphite` counts).
 * Type-only imports and every other token (space, radius, type, shadow, …)
 * are fine: they do not change with the host's theme.
 *
 * SCOPE, relative to mingla-business/:
 *   S1. every non-test .ts/.tsx under `app/checkout*` and
 *       `src/components/checkout/`;
 *   S2. the shared parts listed in SHARED_PARTS, which are drawn inside a
 *       checkout flow. A part added to checkout later belongs on that list;
 *       the rendered contrast test
 *       (`issue_4518_checkout_surface_contrast.implementor.test.tsx`) is what
 *       catches one that is missing from it.
 *
 * ALLOWLIST: ALLOWED below, one reviewed entry per path with its reason. An
 * entry whose file no longer exists fails the plain run.
 *
 * DOES NOT CATCH, stated rather than implied: a colour record frozen at
 * import (`const X = { ink: color.text1 }` at module scope reads once), a
 * colour passed in as a prop, or a part outside both scopes. The contrast
 * test measures the painted result and covers those.
 *
 * `--self-test` drives the pure core with fixtures.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();
const BUSINESS = "mingla-business";

export const SHARED_PARTS = [
  "src/components/buyer/BuyerConnectionNotice.tsx",
  "src/components/buyer/BuyerConnectionNoticeFull.tsx",
  "src/components/ui/Button.tsx",
  "src/components/ui/EmptyState.tsx",
  "src/components/ui/GlassChrome.tsx",
  "src/components/ui/Icon.tsx",
  "src/components/ui/IconChrome.tsx",
  "src/components/ui/Input.tsx",
  "src/components/ui/Material.tsx",
  "src/components/ui/SheetScrollLayout.tsx",
  "src/components/ui/Spinner.tsx",
  "src/components/ui/Toast.tsx",
  "src/components/ui/WebDateTimeInput.tsx",
  "src/components/trip/InstallmentScheduleDisplay.tsx",
  "src/components/trip/TripPlanV2CheckoutChoice.tsx",
  "src/components/trip/TripPaymentChoice.tsx",
  "src/components/waitlist/JoinWaitlistSheet.tsx",
];

export const ALLOWED_ENTRIES = [
  { path: "src/components/checkout/checkoutTheme.ts", reason: "the palette mapper: Graphite is the base it re-points, and it is the single writer of the surface tokens" },
  { path: "src/components/checkout/CheckoutCoverFallback.tsx", reason: "reads the Graphite accent only on the no-palette branch, and the host palette otherwise (explicit, both branches in one place)" },
  { path: "src/components/checkout/StaticBuyerClaimPage.tsx", reason: "the static claim page (/o/, /rsvp/pass) mounts outside every checkout flow, on Graphite" },
];
export const ALLOWED = ALLOWED_ENTRIES.map((entry) => entry.path);

// ---- pure core ----------------------------------------------------------

/** Remove // and block comments, leaving string and template literals alone. */
export function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const two = src.slice(i, i + 2);
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (two === "//") {
      const end = src.indexOf("\n", i);
      i = end === -1 ? src.length : end;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const isTest = (rel) => /(^|\/)__tests__\//.test(rel) || /\.test\.(ts|tsx)$/.test(rel);

/** Is `rel` (relative to mingla-business/) in scope S1 or S2? */
export function inScope(rel) {
  if (!/\.(ts|tsx)$/.test(rel) || /\.d\.ts$/.test(rel) || isTest(rel)) return false;
  if (/^app\/checkout[^/]*\//.test(rel)) return true;
  if (rel.startsWith("src/components/checkout/")) return true;
  return SHARED_PARTS.includes(rel);
}

const DS_IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*constants\/designSystem["']/g;

/** The banned names a source imports as VALUES from constants/designSystem. */
export function bannedImports(src) {
  const code = stripComments(src);
  const found = [];
  for (const match of code.matchAll(DS_IMPORT)) {
    if (match[1] !== undefined) continue; // `import type { … }`
    for (const raw of match[2].split(",")) {
      const item = raw.trim();
      if (item.length === 0 || item.startsWith("type ")) continue;
      const name = item.split(/\s+as\s+/)[0].trim();
      if (name === "color" || name === "materials") found.push(item);
    }
  }
  return found;
}

/** files: [rel, src][] → offenders: { file, imports }[] */
export function scan(files, allowed = ALLOWED) {
  const offenders = [];
  for (const [rel, src] of files) {
    if (!inScope(rel) || allowed.includes(rel)) continue;
    const imports = bannedImports(src);
    if (imports.length > 0) offenders.push({ file: rel, imports });
  }
  return offenders;
}

// ---- self-test ----------------------------------------------------------

function selfTest() {
  const cases = [];
  const check = (name, ok) => cases.push([name, ok]);
  const DS = '"../../constants/designSystem"';

  check("a plain color import in a checkout component fires",
    scan([["src/components/checkout/X.tsx", `import { radius, color, space } from ${DS};`]]).length === 1);
  check("an aliased color import fires",
    scan([["src/components/checkout/X.tsx", `import { color as graphite } from ${DS};`]])[0]?.imports[0] === "color as graphite");
  check("a materials import in a checkout route fires",
    scan([["app/checkout/[eventId]/buyer.tsx", `import { space, materials } from "../../../src/constants/designSystem";`]]).length === 1);
  check("a trip and an experience checkout route are in scope",
    inScope("app/checkout-trip/[tripEventId]/payment.tsx") && inScope("app/checkout-experience/[experienceEventId]/index.tsx"));
  check("a multi-line import fires",
    scan([["src/components/ui/Input.tsx", `import {\n  color,\n  durations,\n} from ${DS};`]]).length === 1);
  check("a shared part is in scope, an unrelated part is not",
    inScope("src/components/ui/Button.tsx") && !inScope("src/components/ui/BottomNav.tsx"));
  check("other tokens are fine",
    scan([["src/components/checkout/X.tsx", `import { radius, space, type, shadow } from ${DS};`]]).length === 0);
  check("a type-only import is fine",
    scan([["src/components/ui/Material.tsx", `import type { MaterialKind, MaterialRecipe } from ${DS};`]]).length === 0);
  check("an inline type specifier is fine",
    scan([["src/components/checkout/X.tsx", `import { space, type MaterialKind } from ${DS};`]]).length === 0);
  check("the surface-token import is fine",
    scan([["src/components/ui/Button.tsx", `import { color, materials } from "../../theme/surfaceTokens";`]]).length === 0);
  check("a commented-out import is ignored",
    scan([["src/components/checkout/X.tsx", `// import { color } from ${DS};\n/* import { materials } from ${DS}; */`]]).length === 0);
  check("tests are out of scope",
    !inScope("src/components/checkout/__tests__/x.test.tsx") && !inScope("app/checkout/__tests__/y.test.tsx"));
  check("the allowlist passes its entries and nothing else",
    scan([["src/components/checkout/checkoutTheme.ts", `import { color as graphite } from ${DS};`]]).length === 0 &&
    scan([["src/components/checkout/checkoutTheme2.ts", `import { color as graphite } from ${DS};`]]).length === 1);
  check("a file outside both scopes is ignored",
    scan([["src/components/home/HomeCard.tsx", `import { color } from ${DS};`]]).length === 0);

  const failed = cases.filter(([, ok]) => !ok);
  for (const [name, ok] of cases) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
  if (failed.length > 0) {
    console.error(`#4518 checkout-one-colour-owner self-test FAIL: ${failed.length} of ${cases.length}`);
    process.exit(1);
  }
  console.log(`#4518 checkout-one-colour-owner self-test PASS: ${cases.length} cases`);
}

// ---- plain run ----------------------------------------------------------

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  if (process.argv.includes("--self-test")) {
    selfTest();
    process.exit(0);
  }

  const files = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (inScope(childRel)) files.push([childRel, fs.readFileSync(childAbs, "utf8")]);
    }
  };
  for (const dir of ["app", "src"]) {
    const abs = path.join(ROOT, BUSINESS, dir);
    if (fs.existsSync(abs)) walk(abs, dir);
  }
  if (files.length === 0) {
    console.error(`#4518 checkout-one-colour-owner FAIL: no source found under ${BUSINESS}/{app,src} (wrong working directory?)`);
    process.exit(1);
  }

  const missing = [...ALLOWED, ...SHARED_PARTS].filter((rel) => !fs.existsSync(path.join(ROOT, BUSINESS, rel)));
  if (missing.length > 0) {
    console.error(`#4518 checkout-one-colour-owner FAIL: listed files no longer exist: ${missing.join(", ")}`);
    process.exit(1);
  }

  const offenders = scan(files);
  if (offenders.length > 0) {
    console.error(`#4518 checkout-one-colour-owner FAIL: ${offenders.length} file(s) import a fixed colour source inside checkout`);
    for (const { file, imports } of offenders) console.error(`    ${file}: { ${imports.join(", ")} } from constants/designSystem`);
    console.error("  Import `color` / `materials` from components/checkout/checkoutTheme (screens) or theme/surfaceTokens (shared parts).");
    process.exit(1);
  }
  console.log(`#4518 checkout-one-colour-owner PASS: 0 offenders in ${files.length} scanned files`);
}
