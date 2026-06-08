#!/usr/bin/env node
/**
 * ORCH-1105 [Business-web parity strict-grep gates] — I-NO-ROUTE-STUB-GATES.
 *
 * WHY: ORCH-1092/1093 shipped a "firewall" of signed-out route stubs that
 * rendered dead-end landings ("Sign in to open {route}", "staying protected")
 * instead of the real screens. ORCH-1100 + ORCH-1102 DELETED that firewall and
 * restored real cold-load hydration + dead-end-free auth routing. This gate
 * locks the deletion in: the stub identifiers + dead-end copy must NEVER
 * reappear in shipped business source.
 *
 * RULE: zero matches for any of the firewall-era identifiers/strings in shipped
 * `mingla-business` source (the `src` + `app` trees), case-sensitive:
 *   - `Orch1092SignedOutRecovery`        (deleted recovery component)
 *   - `Orch1093MobileRouteRecovery`      (deleted recovery component)
 *   - `ORCH_1092_SIGNED_OUT_ROUTES`      (deleted route-allowlist constant)
 *   - `ORCH_1100_BLOCKED_MOBILE_WEB_ROUTES` (deleted firewall constant)
 *   - `staying protected`                (dead-end stub copy)
 *   - `Sign in to open `                 (dead-end stub copy, trailing space)
 *
 * SCOPE: shipped source ONLY — `mingla-business/src` + `mingla-business/app`,
 * extensions .ts/.tsx/.js/.jsx. `__tests__` dirs and `*.test.*` files are
 * EXCLUDED: the ORCH-1100/1102 regression tests legitimately assert the strings
 * are ABSENT (`expect(layout).not.toContain("ORCH_1092_SIGNED_OUT_ROUTES")`),
 * so they contain the needles as data. Docs under `Mingla_Artifacts/` are out
 * of scope by construction (not in the scan roots).
 *
 * Self-test (`--self-test`) proves the gate FIRES on a synthetic violation and
 * stays SILENT on a clean tree (incl. an excluded test file that mentions a
 * needle).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

// Forbidden firewall-era identifiers + dead-end stub copy. Case-sensitive.
const FORBIDDEN = [
  "Orch1092SignedOutRecovery",
  "Orch1093MobileRouteRecovery",
  "ORCH_1092_SIGNED_OUT_ROUTES",
  "ORCH_1100_BLOCKED_MOBILE_WEB_ROUTES",
  "staying protected",
  "Sign in to open ",
];

const SCAN_ROOTS = ["mingla-business/src", "mingla-business/app"];

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".vercel",
  "__tests__",
]);

const SELF_FILE_BASENAME = "orch-1105-no-route-stub-gates.mjs";

// Test files legitimately reference the dead strings as "must-not-contain"
// assertions — exclude them so the regression tests don't trip this gate.
const isTestFile = (relPath) =>
  /\.test\.[tj]sx?$/.test(relPath) || relPath.includes("/__tests__/");

function isExcluded(relPath) {
  if (path.basename(relPath) === SELF_FILE_BASENAME) return true;
  if (isTestFile(relPath)) return true;
  return false;
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (IGNORE_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(full);
    } else if (ent.isFile()) {
      if (EXTENSIONS.has(path.extname(ent.name))) yield full;
    }
  }
}

function scanFile(absPath, relPath, failures) {
  if (isExcluded(relPath)) return;
  let text;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return;
  }
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    for (const needle of FORBIDDEN) {
      if (line.includes(needle)) {
        failures.push(`${relPath}:${idx + 1}: [${needle}] ${line.trim()}`);
      }
    }
  });
}

function runGate(rootDir) {
  const failures = [];
  for (const rel of SCAN_ROOTS) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const relPath = path.relative(rootDir, file);
      scanFile(file, relPath, failures);
    }
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const tmp = path.join("/tmp", "orch1105-route-stub-selftest");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, "mingla-business/app"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "mingla-business/src/__tests__"), {
    recursive: true,
  });

  // Clean shipped file — should pass.
  fs.writeFileSync(
    path.join(tmp, "mingla-business/app/_layout.tsx"),
    `import { Redirect } from "expo-router";\nexport default function Layout() { return <Redirect href="/" />; }\n`,
  );
  // Excluded test file that mentions the needles as assertions — should pass.
  fs.writeFileSync(
    path.join(tmp, "mingla-business/src/__tests__/firewall.test.ts"),
    `expect(layout).not.toContain("ORCH_1092_SIGNED_OUT_ROUTES");\nexpect(layout).not.toContain("Orch1092SignedOutRecovery");\n`,
  );

  let failures = runGate(tmp);
  if (failures.length !== 0) {
    console.error(
      "ORCH-1105 I-NO-ROUTE-STUB-GATES self-test FAIL: clean tree reported failures:\n" +
        failures.join("\n"),
    );
    process.exit(1);
  }

  // Inject a violating shipped file (one per needle) — should fail each time.
  const probes = [
    `import { Orch1092SignedOutRecovery } from "./recovery";\n`,
    `import { Orch1093MobileRouteRecovery } from "./recovery";\n`,
    `const ROUTES = ORCH_1092_SIGNED_OUT_ROUTES;\n`,
    `const BLOCKED = ORCH_1100_BLOCKED_MOBILE_WEB_ROUTES;\n`,
    `const copy = "You are staying protected.";\n`,
    `const title = \`Sign in to open \${route}\`;\n`,
  ];
  for (const violation of probes) {
    fs.writeFileSync(
      path.join(tmp, "mingla-business/app/_layout.tsx"),
      violation,
    );
    failures = runGate(tmp);
    if (failures.length === 0) {
      console.error(
        `ORCH-1105 I-NO-ROUTE-STUB-GATES self-test FAIL: violation did NOT trigger the gate:\n  ${violation.trim()}`,
      );
      process.exit(1);
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(
    `ORCH-1105 I-NO-ROUTE-STUB-GATES self-test PASS (${probes.length + 1}/${probes.length + 1} cases).`,
  );
  process.exit(0);
}

// ---- Live mode
const failures = runGate(root);
if (failures.length > 0) {
  console.error(
    `ORCH-1105 I-NO-ROUTE-STUB-GATES FAIL — ${failures.length} match(es) for deleted firewall-era route stubs in shipped business source.\n` +
      `ORCH-1100/1102 DELETED the signed-out route firewall (real cold-load hydration + dead-end-free auth routing replaced it).\n` +
      `These identifiers/strings must never come back. Remove them or, if this is a genuine new feature, register a new ORCH.\n\nMatches:\n${failures.join("\n")}`,
  );
  process.exit(1);
}

console.log(
  "ORCH-1105 I-NO-ROUTE-STUB-GATES PASS — no firewall-era route stubs in shipped business source.",
);
