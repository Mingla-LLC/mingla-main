#!/usr/bin/env node
/**
 * I-PROPOSED-2211-FULLSCREEN-ROUTE-MUST-SCROLL strict-grep gate.
 *
 * A full-screen route under `mingla-business/app/` that CENTRES growable
 * content in a `flex: 1` root, has an interactive control the user must reach,
 * and provides NO scroll container is a dead end at large Dynamic Type sizes.
 * When centred content outgrows its container it overflows in BOTH directions:
 * the heading clips off the top and the control is pushed past the bottom, out
 * of the accessibility tree, with no gesture that recovers it.
 *
 * #2211 proved this at runtime on `accept-brand-invitation` and
 * `accept-scanner-invitation`: heading measured at y = -77 and y = -103, body
 * copy past the bottom edge, the only Button absent from the accessibility
 * tree, swipe changed nothing. A business user on accessibility text sizes
 * could not accept a team invitation by any means.
 *
 * A route passes when ANY of these is true:
 *   (a) it contains a scroll container — ScrollView / FlatList / SectionList /
 *       KeyboardAware* / SmartScrollView / a shell whose name ends in
 *       `ScreenShell` (the #2211 InviteScreenShell family, whose content
 *       region IS a ScrollView);
 *   (b) it has no centred `flex: 1` root style at all (top-anchored content
 *       keeps its heading and only clips the tail, which scrolling parents or
 *       the user's own scroll position can reach);
 *   (c) it has no interactive control, so there is nothing to be stranded from;
 *   (d) it carries an explicit allowlist comment:
 *       `// orch-strict-grep-allow fullscreen-route-must-scroll — <reason>`
 *
 * WHY IT IS SHAPED THIS WAY. A gate that flagged every non-scrolling route
 * would flag ~60 files, most of them thin wrappers whose delegate scrolls, and
 * would be turned off within a week. The three-way AND (centred root + no
 * scroll + a control) is exactly the shape that strands a user, and it is the
 * shape #2211 measured on a device.
 *
 * `--self-test` drives the pure predicate with in-memory fixtures: the defect
 * shape MUST flag, and each satisfier MUST pass. It proves the gate still has
 * teeth without mutating a real route — the #2113 lesson that a check which
 * cannot fail carries no information.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");
const APP_DIR = join(REPO_ROOT, "mingla-business", "app");

const ALLOWLIST_TAG = "orch-strict-grep-allow fullscreen-route-must-scroll";

/** Anything whose content region can be scrolled by the user. */
const SCROLL_RE =
  /\bScrollView\b|\bFlatList\b|\bSectionList\b|\bKeyboardAware\w*\b|\w+ScreenShell\b/;

/** A control the user must be able to reach for the screen to do its job. */
const CONTROL_RE = /<Button\b|\bTouchableOpacity\b|\bPressable\b|\bTextInput\b/;

/**
 * A style object that both fills the screen and centres its children. Matched
 * on the style BODY between braces, so it works for the multi-line house style
 * and for the single-line objects several routes use. `flex: 1` and
 * `justifyContent: "center"` may appear in either order.
 */
export function hasCentredFullScreenRoot(source) {
  for (const match of source.matchAll(/\{([^{}]*)\}/g)) {
    const body = match[1];
    if (/\bflex:\s*1\b/.test(body) && /justifyContent:\s*["']center["']/.test(body)) {
      return true;
    }
  }
  return false;
}

/**
 * Pure violation check on source text (no I/O), so `--self-test` can drive it
 * with in-memory fixtures instead of mutating a real route.
 */
export function isScrollViolation(source) {
  if (source.includes(ALLOWLIST_TAG)) return false;
  if (SCROLL_RE.test(source)) return false;
  if (!hasCentredFullScreenRoot(source)) return false;
  if (!CONTROL_RE.test(source)) return false;
  return true;
}

/** Same scan set as the sibling SafeArea gate: real native/shared route files. */
export function isScannableRouteFile(entry) {
  return (
    /\.tsx$/.test(entry) &&
    !/\.test\.tsx$/.test(entry) &&
    !/\.web\.tsx$/.test(entry) &&
    entry !== "+html.tsx"
  );
}

function* walkTsx(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walkTsx(full);
    else if (isScannableRouteFile(entry)) yield full;
  }
}

function isLayoutFile(file) {
  return /[/\\]_layout\.(tsx|ts)$/.test(file);
}

// ---- Self-test ------------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const failures = [];

  // The exact #2211 defect shape, reduced: centred flex:1 root, a Button, no
  // scroll container, no allowlist.
  const defect =
    `import { StyleSheet, Text, View } from "react-native";\n` +
    `import { Button } from "../src/components/ui/Button";\n` +
    `export default function S() {\n` +
    `  return (<View style={styles.host}><Text>You're invited</Text>` +
    `<Button label="Sign in" onPress={() => {}} /></View>);\n` +
    `}\n` +
    `const styles = StyleSheet.create({\n` +
    `  host: { flex: 1, alignItems: "center", justifyContent: "center" },\n` +
    `});\n`;
  if (!isScrollViolation(defect)) {
    failures.push("(a) the #2211 defect shape was NOT flagged — the gate has no teeth");
  }

  // The single-line style form several real routes use must flag too; a
  // multi-line-only matcher would silently exempt them.
  const defectOneLine = defect.replace(
    `  host: { flex: 1, alignItems: "center", justifyContent: "center" },\n`,
    `  host: { justifyContent: "center", padding: 24, flex: 1, gap: 16 },\n`,
  );
  if (!isScrollViolation(defectOneLine)) {
    failures.push("(b) a single-line centred root was NOT flagged — matcher too narrow");
  }

  // Each satisfier must pass.
  const satisfiers = {
    "ScrollView present": defect.replace("<View style={styles.host}>", "<ScrollView style={styles.host}>"),
    "FlatList present": defect.replace("<View style={styles.host}>", "<FlatList style={styles.host} data={[]} />{/*"),
    "a *ScreenShell delegate": defect.replace("<View style={styles.host}>", "<InviteScreenShell>"),
    "no centred root": defect.replace(
      `  host: { flex: 1, alignItems: "center", justifyContent: "center" },\n`,
      `  host: { flex: 1 },\n`,
    ),
    "no interactive control": defect
      .replace(`<Button label="Sign in" onPress={() => {}} />`, "")
      .replace(`import { Button } from "../src/components/ui/Button";\n`, ""),
    "allowlist comment": `// ${ALLOWLIST_TAG} — reason\n` + defect,
  };
  for (const [label, src] of Object.entries(satisfiers)) {
    if (isScrollViolation(src)) failures.push(`(c) a route with ${label} was wrongly flagged`);
  }

  // Scan-set precision, mirroring the sibling SafeArea gate.
  for (const e of ["index.tsx", "[id].tsx", "accept-brand-invitation.tsx", "+not-found.tsx"]) {
    if (!isScannableRouteFile(e)) failures.push(`(d) real route "${e}" wrongly excluded`);
  }
  for (const e of ["helper.ts", "connect.web.tsx", "+html.tsx", "Screen.test.tsx"]) {
    if (isScannableRouteFile(e)) failures.push(`(d) non-route "${e}" wrongly included`);
  }

  if (failures.length) {
    console.error("I-PROPOSED-2211-FULLSCREEN-ROUTE-MUST-SCROLL self-test FAIL:");
    failures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-PROPOSED-2211-FULLSCREEN-ROUTE-MUST-SCROLL self-test PASS (teeth on both style forms + 6 satisfiers + scan-set precision).",
  );
  process.exit(0);
}

// ---- Live mode ------------------------------------------------------------
let violations = 0;
let filesScanned = 0;

for (const file of walkTsx(APP_DIR)) {
  if (isLayoutFile(file)) continue;
  filesScanned += 1;
  const source = readFileSync(file, "utf8");
  if (!isScrollViolation(source)) continue;
  violations += 1;
  console.error(
    `✗ ${relative(REPO_ROOT, file)} — centres growable content in a flex:1 root, has an interactive control, and provides NO scroll container (#2211 dead-end shape)`,
  );
  console.error("    fix options:");
  console.error("      (a) make the content region a ScrollView with contentContainerStyle.flexGrow = 1");
  console.error("      (b) render through a *ScreenShell that already scrolls");
  console.error(`      (c) add allowlist comment: // ${ALLOWLIST_TAG} — <reason>`);
}

console.log(
  `I-PROPOSED-2211-FULLSCREEN-ROUTE-MUST-SCROLL: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
