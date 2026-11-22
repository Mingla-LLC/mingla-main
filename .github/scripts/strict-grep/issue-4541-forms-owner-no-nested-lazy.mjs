#!/usr/bin/env node
// MINGLA-INVARIANT: I-4541-FORMS-ONE-LAZY-HOP | issue #4541 | the Host forms code loads through exactly two owners (formsOwner for host management, formRenderingPrimitives for guest rendering) with one lazy hop each: no module in either owner graph uses React.lazy or import(), and no forms or checkout-intake module is reachable from both graphs beyond the set shared at c681c23684.
/**
 * issue #4541 §6.3 (T-41) — one lazy hop per forms owner.
 *
 * WHY. A nested React.lazy inside one Host web feature hoists the modules it
 * shares into the __common chunk (+49 KB on #4514, CheckoutQuestionsStep.tsx:7-8).
 * The Host forms code therefore loads through two owners, each entered by one
 * lazy import, and the two graphs stay apart.
 *
 * RULE, relative to mingla-business/:
 *   R1. Starting at each owner, follow static relative imports (`import … from`,
 *       `export … from`, side-effect `import "…"`) of .ts/.tsx under src/. A
 *       forms or checkout-intake module reached may load nothing lazily except
 *       an owner itself (the one hop): every dynamic `import(` it holds must be
 *       a literal relative path to one of OWNERS. (Services outside those folders
 *       keep their own lazy client loads; they are not forms code.)
 *   R2. A module under src/components/forms/ or src/components/checkout/intake/
 *       reachable from both owners must be in BASELINE_SHARED (shared at
 *       c681c23684). Shared pure helpers belong in packages/form-rendering or a
 *       leaf outside those folders.
 *
 * DOES NOT CATCH, stated rather than implied: imports through path aliases or
 * package names (only relative specifiers are followed; packages/* are leaves),
 * or a lazy hop added at an entry point outside the owners (the bundle movement
 * check measures __common growth and covers that).
 *
 * `--self-test` drives the pure core with fixtures.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();
const BUSINESS = "mingla-business";

export const OWNERS = [
  "src/components/forms/formsOwner.ts",
  "src/components/checkout/intake/formRenderingPrimitives.tsx",
];

/** Forms and checkout-intake modules both owners already reached at c681c23684. */
export const BASELINE_SHARED = [];

/** Reviewed lazy loads inside the owner graphs (present at c681c23684), one entry each with its reason. */
export const ALLOWED_LAZY = [
  {
    file: "src/components/forms/BrandFormBuilderScreen.tsx",
    spec: "../trip/IntakeSchemaBuilder",
    reason: "the question builder: the same module the trip intake loads with this import(), so it stays one async chunk (#4514)",
  },
];

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

/** Static relative specifiers a module imports or re-exports. */
export function staticImports(src) {
  const code = stripComments(src);
  const out = [];
  for (const m of code.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?(["'])(\.{1,2}\/[^"']+)\1/g)) {
    if (/^\s*(?:import|export)\s+type\s/.test(m[0].replace(/^[\s;]/, ""))) continue; // type-only: erased
    out.push(m[2]);
  }
  return out;
}

/** The dynamic imports a module holds: literal specifiers, or null for a computed one. */
export function dynamicImports(src) {
  const code = stripComments(src);
  return [...code.matchAll(/(^|[^.\w])import\s*\(\s*(?:(["'`])([^"'`]+)\2)?/g)].map((m) => m[3] ?? null);
}

/** The lazy loads of a module that are not a hop into an owner. */
export function lazyUse(rel, src, files, owners = OWNERS, allowed = ALLOWED_LAZY) {
  return dynamicImports(src)
    .filter((spec) => spec === null || !owners.includes(resolve(rel, spec, files) ?? ""))
    .filter((spec) => !allowed.some((a) => a.file === rel && a.spec === spec))
    .map((spec) => `import(${spec ?? "<computed>"})`);
}

/** Resolve a relative specifier against a module path; files: Map(rel → src). */
export function resolve(from, spec, files) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (files.has(cand)) return cand;
  }
  return null;
}

/** The modules an owner reaches (including itself). */
export function graph(owner, files) {
  const seen = new Set();
  const stack = [owner];
  while (stack.length > 0) {
    const rel = stack.pop();
    if (seen.has(rel) || !files.has(rel)) continue;
    seen.add(rel);
    for (const spec of staticImports(files.get(rel))) {
      const r = resolve(rel, spec, files);
      if (r !== null && r.startsWith("src/")) stack.push(r);
    }
  }
  return seen;
}

const guarded = (rel) => rel.startsWith("src/components/forms/") || rel.startsWith("src/components/checkout/intake/");

/** files: Map(rel → src) → { lazy: [{file, uses}], shared: [file] } */
export function scan(files, owners = OWNERS, baseline = BASELINE_SHARED) {
  const graphs = owners.map((o) => graph(o, files));
  const lazy = [];
  for (const g of graphs) {
    for (const rel of g) {
      if (!guarded(rel)) continue;
      const uses = lazyUse(rel, files.get(rel), files, owners);
      if (uses.length > 0 && !lazy.some((x) => x.file === rel)) lazy.push({ file: rel, uses });
    }
  }
  const shared = [...graphs[0]].filter((rel) => graphs.slice(1).every((g) => g.has(rel)) && guarded(rel) && !baseline.includes(rel));
  return { lazy, shared };
}

// ---- self-test ----------------------------------------------------------

function selfTest() {
  const cases = [];
  const check = (name, ok) => cases.push([name, ok]);
  const F = (o) => new Map(Object.entries(o));
  const A = "src/components/forms/formsOwner.ts";
  const B = "src/components/checkout/intake/formRenderingPrimitives.tsx";
  const base = {
    [A]: `export { X } from "./X";\nimport type { T } from "./Types";`,
    "src/components/forms/X.tsx": `import { Leaf } from "../../utils/leaf";\nexport const X = 1;`,
    [B]: `export * from "./Q";`,
    "src/components/checkout/intake/Q.tsx": `import { Leaf } from "../../../utils/leaf";`,
    "src/utils/leaf.ts": `export const Leaf = 1;`,
    "src/components/forms/Types.ts": `export type T = string;`,
  };
  check("a clean pair passes", (() => { const r = scan(F(base)); return r.lazy.length === 0 && r.shared.length === 0; })());
  check("React.lazy of a non-owner module inside an owner graph fires",
    scan(F({ ...base, "src/components/forms/X.tsx": `const Y = React.lazy(() => import("./Y"));`, "src/components/forms/Y.tsx": "" })).lazy.length === 1);
  check("a dynamic import inside an owner graph fires",
    scan(F({ ...base, "src/components/checkout/intake/Q.tsx": `const m = () => import("./Z");` })).lazy[0]?.uses[0] === "import(./Z)");
  check("a computed dynamic import fires",
    scan(F({ ...base, "src/components/forms/X.tsx": "const m = (p) => import(p);" })).lazy[0]?.uses[0] === "import(<computed>)");
  check("the one hop into the other owner is allowed",
    scan(F({ ...base, "src/components/forms/X.tsx": `const P = React.lazy(() => import("../checkout/intake/formRenderingPrimitives"));` })).lazy.length === 0);
  check("a reviewed lazy load is allowed only in its own file",
    scan(F({ ...base, "src/components/forms/X.tsx": `const B = () => import("../trip/IntakeSchemaBuilder");` })).lazy.length === 1);
  check("a service outside the forms folders keeps its own lazy load",
    scan(F({ ...base, "src/utils/leaf.ts": `export const c = () => import("./client");` })).lazy.length === 0);
  check("a commented lazy is ignored",
    scan(F({ ...base, "src/components/forms/X.tsx": `// const Y = React.lazy(() => import("./Y"));` })).lazy.length === 0);
  check("a forms module reachable from both owners fires",
    scan(F({ ...base, "src/components/checkout/intake/Q.tsx": `import { X } from "../../forms/X";` })).shared[0] === "src/components/forms/X.tsx");
  check("a shared leaf outside the guarded folders is fine", scan(F(base)).shared.length === 0);
  check("the baseline allows what was shared before",
    scan(F({ ...base, "src/components/checkout/intake/Q.tsx": `import { X } from "../../forms/X";` }), OWNERS, ["src/components/forms/X.tsx"]).shared.length === 0);
  check("a type-only import is not followed",
    scan(F({ ...base, [B]: `import type { T } from "../../forms/Types";\nexport * from "./Q";`,
      "src/components/forms/formsOwner.ts": `export { X } from "./X";\nexport { T2 } from "./Types";` })).shared.length === 0);
  check("a module outside the owner graphs is ignored",
    scan(F({ ...base, "src/components/forms/Other.tsx": `const Y = React.lazy(() => import("./Y"));` })).lazy.length === 0);

  const failed = cases.filter(([, ok]) => !ok);
  for (const [name, ok] of cases) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
  if (failed.length > 0) {
    console.error(`#4541 forms-owner-no-nested-lazy self-test FAIL: ${failed.length} of ${cases.length}`);
    process.exit(1);
  }
  console.log(`#4541 forms-owner-no-nested-lazy self-test PASS: ${cases.length} cases`);
}

// ---- plain run ----------------------------------------------------------

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  if (process.argv.includes("--self-test")) {
    selfTest();
    process.exit(0);
  }
  const files = new Map();
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) files.set(childRel, fs.readFileSync(childAbs, "utf8"));
    }
  };
  const src = path.join(ROOT, BUSINESS, "src");
  if (!fs.existsSync(src)) {
    console.error(`#4541 forms-owner-no-nested-lazy FAIL: ${BUSINESS}/src not found (wrong working directory?)`);
    process.exit(1);
  }
  walk(src, "src");
  const missing = [...OWNERS, ...BASELINE_SHARED, ...ALLOWED_LAZY.map((a) => a.file)].filter((rel) => !files.has(rel));
  if (missing.length > 0) {
    console.error(`#4541 forms-owner-no-nested-lazy FAIL: listed files no longer exist: ${missing.join(", ")}`);
    process.exit(1);
  }
  const { lazy, shared } = scan(files);
  if (lazy.length > 0 || shared.length > 0) {
    console.error("#4541 forms-owner-no-nested-lazy FAIL");
    for (const { file, uses } of lazy) console.error(`    ${file}: ${uses.join(", ")} inside a forms owner graph`);
    for (const file of shared) console.error(`    ${file}: reachable from both forms owners`);
    console.error("  Keep one lazy hop per owner; move shared pure helpers to packages/form-rendering or a leaf.");
    process.exit(1);
  }
  const sizes = OWNERS.map((o) => graph(o, files).size);
  console.log(`#4541 forms-owner-no-nested-lazy PASS: owner graphs ${sizes.join(" and ")} modules, no lazy hop inside, no new shared module`);
}
