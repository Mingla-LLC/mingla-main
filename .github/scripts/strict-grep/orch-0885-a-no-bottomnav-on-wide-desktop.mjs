#!/usr/bin/env node
/**
 * ORCH-0885-A strict-grep gate — No BottomNav outside (tabs)/_layout.tsx;
 * desktop gate is hook-only.
 *
 * Enforces TWO invariants codified by SPEC_ORCH-0885-A §10:
 *
 *   I-NO-BOTTOMNAV-OUTSIDE-LAYOUT
 *     BottomNav is imported only by mingla-business/app/(tabs)/_layout.tsx.
 *     Adding another importer requires a new ORCH amending this invariant.
 *     Allow-list contains the import target files themselves (the canonical
 *     mobile capsule + the web rail variant) and the single sanctioned
 *     importer.
 *
 *   I-DESKTOP-GATE-VIA-HOOK
 *     Every desktop-only branch reads from `useResponsiveLayout()`. Inlining
 *     `Platform.OS === 'web' && width >= 1024` is forbidden anywhere in
 *     mingla-business/src/ or mingla-business/app/ (excluding the
 *     allow-listed hook source file itself + this gate's own self-test
 *     fixtures).
 *
 * Pattern compliance: one script + one job + one README row + one package.json
 * scripts entry (per `feedback_strict_grep_registry_pattern.md`). Self-test
 * inside this script validates every wiring point is present.
 *
 * Exit codes (per .github/scripts/strict-grep/README.md):
 *   0 — clean
 *   1 — violation (one or more invariant breaches)
 *   2 — script error
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const checkedRoots = ["mingla-business/app", "mingla-business/src"];

// Files allowed to break either assertion. Adding a new entry requires a
// new ORCH amending I-DESKTOP-GATE-VIA-HOOK / I-NO-BOTTOMNAV-OUTSIDE-LAYOUT.
const ALLOWLIST = new Set([
  // Single source of truth for the desktop boolean — inline form lives here once.
  "mingla-business/src/hooks/useResponsiveLayout.ts",
  // Canonical mobile capsule — the import target itself, not an importer.
  "mingla-business/src/components/ui/BottomNav.tsx",
  // Web variant — re-exports MobileBottomNav internally, but is itself the
  // Metro-resolved target on web.
  "mingla-business/src/components/ui/BottomNav.web.tsx",
  // The one sanctioned production BottomNav importer.
  "mingla-business/app/(tabs)/_layout.tsx",
  // Hidden dev-only styleguide route (`/__styleguide`). Pre-existing
  // importer that renders every kit primitive for QA. Production builds
  // redirect away before any JSX mounts (see file header). Not a runtime
  // chrome mount — the BottomNav appears here only as a visual catalog
  // entry alongside every other primitive. Permitted by ORCH-0885-A at
  // INTAKE time as a known prior consumer; if this file ever ships in
  // production navigation, file a new ORCH amending the allow-list.
  "mingla-business/app/__styleguide.tsx",
  // Type-only consumers — import the `BottomNavTab` TYPE (not the BottomNav
  // component) for the desktop tab-visibility gate. No runtime chrome mount.
  // (ORCH-1060 CI green-up; type imports are erased at build, never render.)
  "mingla-business/src/utils/navTabGate.ts",
  "mingla-business/src/utils/__tests__/navTabGate.test.ts",
]);

const failures = [];

// Assertion 1 — only the allow-list imports BottomNav (matches both bare
// `./BottomNav` and `./BottomNav.web` specifiers, plus any deeper path).
const BOTTOMNAV_IMPORT_PATTERN =
  /from\s+["'][^"']*\/BottomNav(?:\.web)?["']/;

// Assertion 2 — no file inlines the desktop gate (Platform.OS === 'web'
// AND width >= 1024 in the same expression, within ~80 chars).
const INLINE_DESKTOP_GATE_PATTERN =
  /Platform\.OS\s*===\s*['"]web['"]\s*&&\s*[^;]{0,80}width\s*>=\s*1024/;

const walk = (directory) => {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    // Directory missing (e.g. checked-out subset) — skip silently. The
    // workflow checkout always has the full tree, so this only fires in
    // local subset development.
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const relativePath = path.relative(root, absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    const lines = source.split(/\r?\n/);

    // Assertion 1 — BottomNav import outside allow-list.
    if (!ALLOWLIST.has(relativePath)) {
      lines.forEach((line, idx) => {
        if (BOTTOMNAV_IMPORT_PATTERN.test(line)) {
          failures.push(
            `${relativePath}:${idx + 1} — BottomNav imported outside allow-list — suggested fix: mount BottomNav only in mingla-business/app/(tabs)/_layout.tsx; if a new mount point is genuinely required, file a new ORCH amending I-NO-BOTTOMNAV-OUTSIDE-LAYOUT and update the ALLOWLIST in this gate — cross-ref: SPEC_ORCH-0885-A_TIER_1_DESKTOP_CONTAINER_RAIL.md §10 + Mingla_Artifacts/INVARIANT_REGISTRY.md I-NO-BOTTOMNAV-OUTSIDE-LAYOUT`,
          );
        }
      });
    }

    // Assertion 2 — inline desktop gate outside allow-list.
    if (!ALLOWLIST.has(relativePath)) {
      lines.forEach((line, idx) => {
        if (INLINE_DESKTOP_GATE_PATTERN.test(line)) {
          failures.push(
            `${relativePath}:${idx + 1} — desktop gate inlined; must route through useResponsiveLayout() — suggested fix: replace 'Platform.OS === "web" && width >= 1024' with 'const { isWideDesktop } = useResponsiveLayout();' from src/hooks/useResponsiveLayout.ts — cross-ref: SPEC_ORCH-0885-A_TIER_1_DESKTOP_CONTAINER_RAIL.md §2 + §10 + Mingla_Artifacts/INVARIANT_REGISTRY.md I-DESKTOP-GATE-VIA-HOOK`,
          );
        }
      });
    }
  }
};

// Self-test 1 — package.json scripts["test:orch-0885-a"] wired.
const checkNpmWiring = () => {
  const packageJsonPath = path.join(root, "mingla-business/package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    failures.push(
      `ORCH-0885-A wiring: mingla-business/package.json parse failed: ${error.message}`,
    );
    return;
  }
  const script = packageJson.scripts?.["test:orch-0885-a"];
  if (
    typeof script !== "string" ||
    !script.includes("orch-0885-a-no-bottomnav-on-wide-desktop.mjs")
  ) {
    failures.push(
      `ORCH-0885-A wiring: mingla-business/package.json missing scripts["test:orch-0885-a"] entry pointing at orch-0885-a-no-bottomnav-on-wide-desktop.mjs (npm wiring)`,
    );
  }
};

// Self-test 2 — workflow contains the job + push trigger for [main, Seth].
const getTopLevelBlock = (source, key) => {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return "";
  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[^\s#][^:]*:\s*$/.test(line)) break;
    if (/^[^\s#][^:]*:\s+/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
};

const getIndentedChildBlock = (source, key, indent = 2) => {
  const lines = source.split(/\r?\n/);
  const childPattern = new RegExp(`^\\s{${indent}}${key}:\\s*$`);
  const siblingPattern = new RegExp(`^\\s{${indent}}\\S[^:]*:\\s*`);
  const start = lines.findIndex((line) => childPattern.test(line));
  if (start === -1) return "";
  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (siblingPattern.test(line)) break;
    if (/^[^\s#]/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
};

const branchBlockHas = (pushBlock, branchName) => {
  const inlineBranches = pushBlock.match(
    /^\s{4}branches:\s*\[(?<branches>[^\]]*)\]\s*$/m,
  );
  if (inlineBranches?.groups?.branches) {
    return inlineBranches.groups.branches
      .split(",")
      .map((branch) => branch.trim())
      .includes(branchName);
  }
  const lines = pushBlock.split(/\r?\n/);
  const branchesIndex = lines.findIndex((line) =>
    /^\s{4}branches:\s*$/.test(line),
  );
  if (branchesIndex === -1) return false;
  for (let index = branchesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s{4}\S/.test(line)) break;
    if (new RegExp(`^\\s{6}-\\s*${branchName}\\s*$`).test(line)) return true;
  }
  return false;
};

const checkWorkflowWiring = () => {
  const workflowPath = path.join(
    root,
    ".github/workflows/strict-grep-mingla-business.yml",
  );
  let workflowSource;
  try {
    workflowSource = fs.readFileSync(workflowPath, "utf8");
  } catch (error) {
    failures.push(
      `ORCH-0885-A wiring: .github/workflows/strict-grep-mingla-business.yml read failed: ${error.message} (CI wiring)`,
    );
    return;
  }

  if (
    !/^\s{2}orch-0885-a-no-bottomnav-on-wide-desktop:\s*$/m.test(workflowSource)
  ) {
    failures.push(
      `ORCH-0885-A wiring: .github/workflows/strict-grep-mingla-business.yml missing job orch-0885-a-no-bottomnav-on-wide-desktop (CI wiring)`,
    );
  }

  const onBlock = getTopLevelBlock(workflowSource, "on");
  const pushBlock = getIndentedChildBlock(onBlock, "push", 2);
  if (
    !pushBlock ||
    !branchBlockHas(pushBlock, "main") ||
    !branchBlockHas(pushBlock, "Seth")
  ) {
    failures.push(
      `ORCH-0885-A wiring: .github/workflows/strict-grep-mingla-business.yml on: block missing push trigger for [main, Seth] (push wiring)`,
    );
  }
};

// Self-test 3 — README registry row present.
const checkReadmeWiring = () => {
  const readmePath = path.join(
    root,
    ".github/scripts/strict-grep/README.md",
  );
  let readmeSource;
  try {
    readmeSource = fs.readFileSync(readmePath, "utf8");
  } catch (error) {
    failures.push(
      `ORCH-0885-A wiring: .github/scripts/strict-grep/README.md read failed: ${error.message} (README wiring)`,
    );
    return;
  }
  if (!readmeSource.includes("orch-0885-a-no-bottomnav-on-wide-desktop.mjs")) {
    failures.push(
      `ORCH-0885-A wiring: .github/scripts/strict-grep/README.md missing registry row for orch-0885-a-no-bottomnav-on-wide-desktop.mjs (README wiring)`,
    );
  }
};

for (const checkedRoot of checkedRoots) {
  walk(path.join(root, checkedRoot));
}

checkNpmWiring();
checkWorkflowWiring();
checkReadmeWiring();

if (failures.length > 0) {
  console.error(
    "ORCH-0885-A gate failed — no BottomNav outside (tabs)/_layout.tsx; desktop gate via useResponsiveLayout() only.",
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "ORCH-0885-A gate passed — BottomNav allow-list intact + desktop gate hook-only.",
);
