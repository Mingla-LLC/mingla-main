#!/usr/bin/env node
/**
 * ORCH-1325 [CI TypeScript pin] — regression guard.
 * Invariant: I-PROPOSED-1325-CI-TYPESCRIPT-PINNED.
 *
 * THE BUG: a CI job installed the transpile dep with an UNPINNED
 * `npm install --no-save typescript`. On 2026-07-09 the npm dist-tag `latest`
 * moved to TypeScript 7.0 (the native rewrite), whose package dropped the
 * classic `ts.ModuleKind` / `ts.transpileModule` JS API. The ORCH-1058 gate
 * transpiles TS source with exactly that API, so the unpinned install pulled
 * 7.0.2 and crashed the gate — repo-wide, on every PR, unrelated to any diff.
 *
 * THIS GUARD makes an unpinned `typescript` install in CI impossible to ship:
 * every `npm install|i|add` of the `typescript` package under
 * `.github/workflows/**` MUST pin a version (`typescript@<range>`). A bare
 * `typescript` token (no `@version`) fires. Scoped/other packages that merely
 * CONTAIN the substring (`@typescript-eslint/*`, `typescript-eslint`) are NOT
 * the `typescript` package and are ignored (exact-token match).
 *
 * fails-on-revert: revert the ORCH-1325 pin (`typescript@~5.9.2` → `typescript`)
 * and this guard fires on that line.
 *
 * --self-test injects fixtures (pinned → pass; each unpinned form → fire).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const WORKFLOWS_DIR = path.join(root, ".github", "workflows");

// An npm install command line (best-effort; workflows write installs on one line).
const INSTALL_RE = /\bnpm\s+(?:install|i|add)\b/;

/**
 * Return the list of violation reasons for a single command line: an UNPINNED
 * bare `typescript` package token inside an npm install command.
 */
function violationsInLine(line) {
  if (!INSTALL_RE.test(line)) return [];
  // Tokenize on whitespace; strip surrounding quotes.
  const tokens = line
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^['"]|['"]$/g, ""));
  const bad = [];
  for (const tok of tokens) {
    // Exact `typescript` package, no `@version` pin → unpinned.
    if (tok === "typescript") {
      bad.push(`unpinned install token \`typescript\` (pin it, e.g. typescript@~5.9.2)`);
    }
  }
  return bad;
}

function checkContent(src, rel, failures) {
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    for (const why of violationsInLine(line)) {
      failures.push(`${rel}:${i + 1} — ${why}`);
    }
  });
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const cases = [
    { src: "        run: npm install --no-save typescript@~5.9.2", bad: false, name: "pinned ~5.9.2" },
    { src: "        run: npm install --no-save typescript@5", bad: false, name: "pinned @5" },
    { src: "        run: npm i -D typescript@5.9.2", bad: false, name: "pinned exact" },
    { src: "        run: npm install --no-save @typescript-eslint/parser typescript@5", bad: false, name: "scoped eslint + pinned ts" },
    { src: "        run: npm install typescript-eslint@8", bad: false, name: "typescript-eslint (different pkg)" },
    { src: "        run: npm ci", bad: false, name: "npm ci, no typescript" },
    { src: "        run: npm install --no-save typescript", bad: true, name: "UNPINNED install --no-save" },
    { src: "        run: npm i typescript", bad: true, name: "UNPINNED npm i" },
    { src: "        run: npm add typescript --no-save", bad: true, name: "UNPINNED npm add" },
    { src: "        run: npm install --no-save @typescript-eslint/parser typescript", bad: true, name: "scoped ok BUT bare typescript unpinned" },
  ];
  let pass = 0;
  const problems = [];
  for (const c of cases) {
    const failures = [];
    checkContent(c.src, "fixture.yml", failures);
    const fired = failures.length > 0;
    if (fired === c.bad) pass++;
    else problems.push(`case "${c.name}": expected ${c.bad ? "FIRE" : "pass"}, got ${fired ? "FIRE" : "pass"}`);
  }
  if (problems.length) {
    console.error(`ORCH-1325 ci-typescript-pinned self-test FAIL:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`ORCH-1325 ci-typescript-pinned self-test PASS (${pass}/${cases.length} cases).`);
  process.exit(0);
}

// ---- Live mode
if (!fs.existsSync(WORKFLOWS_DIR)) {
  console.error(`ORCH-1325 FAIL — workflows dir not found: ${WORKFLOWS_DIR} (path out of sync).`);
  process.exit(1);
}
const files = fs
  .readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => path.join(WORKFLOWS_DIR, f));

const failures = [];
for (const f of files) {
  checkContent(fs.readFileSync(f, "utf8"), path.relative(root, f), failures);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1325 FAIL — an UNPINNED `typescript` install exists in a CI workflow.\n" +
      "The npm `latest` dist-tag is TypeScript 7.0 (native rewrite) with no classic\n" +
      "`ts.ModuleKind`/`transpileModule` API → an unpinned install crashes transpile\n" +
      "gates repo-wide. Pin it (e.g. `typescript@~5.9.2`, matching app-mobile).\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  `ORCH-1325 PASS — scanned ${files.length} workflow files; every \`typescript\` ` +
    `install is version-pinned.`,
);
