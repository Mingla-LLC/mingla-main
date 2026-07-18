#!/usr/bin/env node
/**
 * ORCH-1378 / ORCH-1380 — `.web.*` shim export-parity gate.
 * Invariant: I-PROPOSED-1378-WEB-SHIM-EXPORT-PARITY (DRAFT until CLOSE).
 *
 * THE BUG CLASS THIS EXISTS TO CLOSE — and why nothing else can catch it.
 *
 * TypeScript is STRUCTURALLY BLIND here. `tsc` resolves `import { x } from
 * "./fooService"` to the NATIVE module (`moduleSuffixes` is unset in
 * mingla-business/tsconfig.json), but Metro substitutes `fooService.web.ts` into
 * the WEB bundle. So if the native twin exports a function the web shim does not,
 * the typecheck is GREEN and the shipped web bundle throws
 * `TypeError: x is not a function` at runtime. No typecheck, no lint, and no
 * existing gate compares the pair.
 *
 * It shipped TWICE, both live on production when this gate was written:
 *   - appsFlyerService.web.ts   missing subscribeOneLinkDeepLink (+ resolve…)
 *     -> threw from the ROOT _layout on EVERY business-web load (3/3).
 *   - oneSignalService.web.ts   missing syncPushPermissionTag (+ canRequest…)
 *     -> threw on EVERY tab background->foreground refocus.
 *
 * THE RULE. For every `X.web.ts(x)` with a sibling `X.ts(x)`, the web shim's
 * exported VALUE names MUST be a SUPERSET of the native twin's.
 *  - SUPERSET, not equality: a web-only extra export is legitimate.
 *  - VALUES only: type-only exports are erased at runtime and cannot throw.
 *  - A `.web.*` with NO native twin is skipped (nothing to drift from).
 *
 * NO ALLOWLIST. The class is BOUNDED (verified: 28 pairs, 2 drifting, 4 missing
 * exports — all 4 fixed in this same PR), so the gate is green with zero
 * exceptions. An allowlist here would re-open the exact class the gate closes:
 * "known drift" is precisely what shipped both TypeErrors. If a future shim
 * genuinely cannot implement an export, it must still EXPORT it — as a no-op
 * that throws a NAMED error, so the failure is legible instead of a bare
 * `is not a function`.
 *
 * NOT A TOKEN-PRESENCE CHECK (the §9.0 decorative-guard rule). This gate
 * compares EXPORT SETS — the structure the bundler actually substitutes. It
 * cannot be satisfied by a comment, a string, or a mention of the name.
 *
 * --self-test proves every case fires in BOTH directions (compliant → PASS, each
 * drift shape → FAIL).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

/** Packages swept for `.web.*` shims. */
const SCAN_ROOTS = [
  "mingla-business/src",
  "mingla-business/app",
  "app-mobile/src",
  "app-mobile/app",
  "mingla-admin/src",
  "packages",
];

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Extract exported VALUE names from a module's source.
 *
 * Deliberately EXCLUDES type-only exports (`export type X`, `export interface X`,
 * `export type { … }`) — they are erased by the compiler and can never produce a
 * runtime TypeError, so demanding them would fail the gate on harmless drift.
 *
 * Handles: export function/const/let/var/class/enum, and named export lists
 * (`export { a, b as c }`) including re-export forms.
 */
export function extractValueExports(rawSrc) {
  const src = stripComments(rawSrc);
  const names = new Set();

  // export [async] function NAME / export function* NAME
  for (const m of src.matchAll(
    /^\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(m[1]);
  }
  // export const/let/var NAME
  for (const m of src.matchAll(
    /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(m[1]);
  }
  // export class NAME / export abstract class NAME
  for (const m of src.matchAll(
    /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(m[1]);
  }
  // export enum NAME / export const enum NAME (enums ARE runtime values)
  for (const m of src.matchAll(
    /^\s*export\s+(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(m[1]);
  }
  // export default …
  if (/^\s*export\s+default\s/m.test(src)) names.add("default");

  // export { a, b as c } [from "…"] — but NOT `export type { … }`.
  for (const m of src.matchAll(/^\s*export\s+(type\s+)?\{([^}]*)\}/gm)) {
    if (m[1]) continue; // `export type { … }` — erased, skip the whole clause.
    for (const rawPart of m[2].split(",")) {
      const part = rawPart.trim();
      if (part === "") continue;
      // `type X` / `type X as Y` inside a value export list — erased, skip.
      if (/^type\s/.test(part)) continue;
      // `a as b` exports the name `b`; a bare `a` exports `a`.
      const asMatch = /^(?:[A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(part);
      if (asMatch) {
        names.add(asMatch[1]);
        continue;
      }
      const bare = /^([A-Za-z_$][\w$]*)$/.exec(part);
      if (bare) names.add(bare[1]);
    }
  }

  return names;
}

/** Core checker — pure over a {relPath: content} map so --self-test can inject. */
export function checkShimParity(files, failures) {
  let pairs = 0;

  for (const rel of Object.keys(files)) {
    const webMatch = /^(.*)\.web\.(tsx?)$/.exec(rel);
    if (webMatch === null) continue;

    const stem = webMatch[1];
    // The native twin may use either extension.
    const nativeRel = [`${stem}.ts`, `${stem}.tsx`].find(
      (candidate) => files[candidate] !== undefined,
    );
    // A .web.* with NO native twin has nothing to drift from — skip, don't fail.
    if (nativeRel === undefined) continue;

    pairs += 1;
    const nativeExports = extractValueExports(files[nativeRel]);
    const webExports = extractValueExports(files[rel]);

    const missing = [...nativeExports].filter((name) => !webExports.has(name));
    if (missing.length > 0) {
      failures.push(
        `${rel}: MISSING native value export(s) [${missing.sort().join(", ")}] present in ` +
          `${nativeRel}. TypeScript CANNOT see this (tsc resolves the native module; Metro ` +
          `substitutes the .web.* override) — the web bundle will throw "TypeError: ` +
          `<name> is not a function" at runtime. Add a no-op matching the native signature ` +
          `IN THIS COMMIT.`,
      );
    }
  }

  return pairs;
}

// ---- Self-test (both directions per the ORCH-1373 SPEC §9.0 decorative-guard rule)
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (files) => {
    const f = [];
    checkShimParity(files, f);
    return f;
  };

  const native = `
export type BusinessOneLinkDestination = { kind: "download" } | null;
export function initializeAppsFlyer(): void {}
export function subscribeOneLinkDeepLink(cb: (d: BusinessOneLinkDestination) => void): void {}
export function resolveBusinessOneLinkDestination(d: unknown): BusinessOneLinkDestination { return null; }
export const APPSFLYER_READY = true;
`;
  const web = `
import type { BusinessOneLinkDestination } from "./appsFlyerService";
export type { BusinessOneLinkDestination };
export function initializeAppsFlyer(): void {}
export function subscribeOneLinkDeepLink(_cb: (d: BusinessOneLinkDestination) => void): void {}
export function resolveBusinessOneLinkDestination(_d: unknown): BusinessOneLinkDestination { return null; }
export const APPSFLYER_READY = false;
`;
  const good = {
    "mingla-business/src/services/appsFlyerService.ts": native,
    "mingla-business/src/services/appsFlyerService.web.ts": web,
  };
  if (run(good).length !== 0) {
    selfFailures.push("compliant pair wrongly flagged: " + JSON.stringify(run(good)));
  }

  // 1. THE SHIPPED BUG — delete subscribeOneLinkDeepLink from the shim → FAIL.
  const drop1 = {
    ...good,
    "mingla-business/src/services/appsFlyerService.web.ts": web.replace(
      /export function subscribeOneLinkDeepLink[^\n]*\n/,
      "",
    ),
  };
  if (run(drop1).length === 0) {
    selfFailures.push("deleted subscribeOneLinkDeepLink not flagged (the ORCH-1378 live bug)");
  }

  // 2. THE OTHER SHIPPED BUG — the oneSignal shape → FAIL.
  const osNative = `
export function initializeOneSignal(): void {}
export async function canRequestPushPermission(): Promise<boolean> { return true; }
export async function syncPushPermissionTag(): Promise<void> {}
`;
  const osWebBroken = `
export function initializeOneSignal(): void {}
`;
  const drop2 = {
    "mingla-business/src/services/oneSignalService.ts": osNative,
    "mingla-business/src/services/oneSignalService.web.ts": osWebBroken,
  };
  if (run(drop2).length === 0) {
    selfFailures.push("deleted syncPushPermissionTag not flagged (the ORCH-1380 live bug)");
  }

  // 3. Add a native export with NO web twin → FAIL.
  const newNative = {
    ...good,
    "mingla-business/src/services/appsFlyerService.ts":
      native + "\nexport function brandNewNativeFn(): void {}\n",
  };
  if (run(newNative).length === 0) {
    selfFailures.push("new native export with no web twin not flagged");
  }

  // 4. Web exports a SUPERSET (extra web-only export) → PASS (superset, not equality).
  const superset = {
    ...good,
    "mingla-business/src/services/appsFlyerService.web.ts":
      web + "\nexport function webOnlyHelper(): void {}\n",
  };
  if (run(superset).length !== 0) {
    selfFailures.push("web-only extra export wrongly flagged (must be SUPERSET, not equality): " + JSON.stringify(run(superset)));
  }

  // 5. Type-only native export absent from web → PASS (values only; types are erased).
  const typeOnly = {
    ...good,
    "mingla-business/src/services/appsFlyerService.ts":
      native + "\nexport type SomeTypeOnly = { a: 1 };\nexport interface SomeIface { b: 2 }\n",
  };
  if (run(typeOnly).length !== 0) {
    selfFailures.push("type-only native export wrongly demanded on the shim: " + JSON.stringify(run(typeOnly)));
  }

  // 6. A `.web.*` with NO native twin → skipped, not failed.
  const orphan = { "mingla-business/src/services/webOnlyThing.web.ts": "export function x(): void {}\n" };
  if (run(orphan).length !== 0) {
    selfFailures.push("orphan .web.* (no native twin) wrongly flagged: " + JSON.stringify(run(orphan)));
  }

  // 7. Named export lists are parsed (export { a as b }) → PASS when matched.
  const listNative = { "p/m.ts": "function a(): void {}\nexport { a as publicName };\n" };
  const listPair = {
    ...listNative,
    "p/m.web.ts": "function z(): void {}\nexport { z as publicName };\n",
  };
  if (run(listPair).length !== 0) {
    selfFailures.push("matched `export { x as y }` pair wrongly flagged: " + JSON.stringify(run(listPair)));
  }
  const listBroken = { ...listNative, "p/m.web.ts": "export function other(): void {}\n" };
  if (run(listBroken).length === 0) {
    selfFailures.push("missing `export { x as y }` name not flagged");
  }

  // 8. `export type { … }` on the native side is NOT demanded as a value.
  const typeListPair = {
    "p/t.ts": "type T = 1;\nexport type { T };\nexport function v(): void {}\n",
    "p/t.web.ts": "export function v(): void {}\n",
  };
  if (run(typeListPair).length !== 0) {
    selfFailures.push("`export type { T }` wrongly demanded as a value export: " + JSON.stringify(run(typeListPair)));
  }

  // 9. A name mentioned ONLY in a comment does NOT satisfy the gate (anti-decorative).
  const commentOnly = {
    ...good,
    "mingla-business/src/services/appsFlyerService.web.ts":
      web.replace(/export function subscribeOneLinkDeepLink[^\n]*\n/, "") +
      "\n// TODO: subscribeOneLinkDeepLink is handled elsewhere\n",
  };
  if (run(commentOnly).length === 0) {
    selfFailures.push("a COMMENT mentioning the export wrongly satisfied the gate (decorative!)");
  }

  // 10. export default parity.
  const defPair = {
    "p/d.ts": "export default function d(): void {}\n",
    "p/d.web.ts": "export function other(): void {}\n",
  };
  if (run(defPair).length === 0) selfFailures.push("missing default export not flagged");

  // 11. .tsx native twin resolves too.
  const tsxPair = {
    "p/c.tsx": "export function C(): null { return null; }\nexport function helper(): void {}\n",
    "p/c.web.tsx": "export function C(): null { return null; }\n",
  };
  if (run(tsxPair).length === 0) selfFailures.push("missing export on a .tsx pair not flagged");

  if (selfFailures.length) {
    console.error("I-1378 web-shim-export-parity self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-1378 web-shim-export-parity self-test PASS (11/11 cases, both directions:\n" +
      "  compliant → pass; each drift shape → fire; superset/type-only/orphan → pass).",
  );
  process.exit(0);
}

// ---- Live mode
function walk(dirAbs, out) {
  if (!fs.existsSync(dirAbs)) return;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(abs);
  }
}

const files = {};
for (const scanRoot of SCAN_ROOTS) {
  const absFiles = [];
  walk(path.join(root, scanRoot), absFiles);
  for (const abs of absFiles) {
    files[path.relative(root, abs)] = fs.readFileSync(abs, "utf8");
  }
}

const failures = [];
const pairs = checkShimParity(files, failures);

if (failures.length > 0) {
  console.error(
    "I-PROPOSED-1378-WEB-SHIM-EXPORT-PARITY FAIL — a `.web.*` shim does not export everything\n" +
      "its native twin does. TypeScript CANNOT catch this: tsc resolves the NATIVE module while\n" +
      "Metro substitutes the .web.* override into the web bundle, so the typecheck stays GREEN\n" +
      "while the shipped bundle throws `TypeError: <name> is not a function`. This shipped twice\n" +
      "(ORCH-1378 appsFlyer: every web load; ORCH-1380 oneSignal: every tab refocus).\n" +
      "FIX: add the missing export to the shim as a no-op matching the native signature.\n\n" +
      `Failures:\n  ${failures.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(
  `I-1378 PASS — ${pairs} .web.*/native shim pair(s) checked; every web shim exports a superset\n` +
    "of its native twin's value exports (no allowlist, no exceptions).",
);
