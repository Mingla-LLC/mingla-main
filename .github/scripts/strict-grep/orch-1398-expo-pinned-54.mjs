#!/usr/bin/env node
/**
 * ORCH-1398 — EXPO IS PINNED TO SDK 54, DELIBERATELY. DO NOT BUMP TO 57.
 * I-PROPOSED-1398-EXPO-PINNED-54.
 *
 * WHY THIS GATE EXISTS (read before "fixing" a red here by bumping expo):
 *   Expo 57 was TRIED and INTENTIONALLY REVERTED by ORCH-1386 (`3fbd41765`,
 *   "expo-57 revert — native builds restored") because the Expo-57 / react-native
 *   pairing BROKE the native builds of both apps. Expo 54 (~54.0.34) is the
 *   supported, shipping line.
 *
 *   The revert kept getting UNDONE: a stale Dependabot PR (a postcss minor bump,
 *   `12b59e425`) carried an expo ~54→~57 change on its stale base and, when
 *   merged, silently re-pinned expo to 57 in package.json WITHOUT regenerating
 *   the lockfile — leaving `expo@57.0.7` next to `@expo/metro-runtime@6.1.2`
 *   (an Expo-54 artifact). That desync made `npm ci` fail REPO-WIDE
 *   ("Missing: @expo/metro-runtime@57.0.6 from lock file"), blocking EVERY PR's
 *   merge (ORCH-1398). `.github/dependabot.yml` already ignores expo majors, but
 *   an already-open stale PR bypassed that ignore — so an ENFORCED CI gate (this
 *   file) is the durable stop that the ignore-rule cannot provide.
 *
 * THE RULE: `expo` in mingla-business/package.json AND app-mobile/package.json
 *   MUST stay on the 54 major (`~54.x` / `^54.x`). A bump to 55+ is a MAJOR
 *   framework migration that needs full native-build QA on real devices —
 *   NEVER a Dependabot batch rider, NEVER a reflexive "npm install to fix the
 *   red". If you genuinely intend to migrate Expo, delete/replace this gate in
 *   the SAME PR that does the migration, with device-verified native builds.
 *
 * Fails-on-revert: re-pinning either app's expo to ~57.x makes this exit 1.
 * `--self-test` proves both directions.
 */
import { readFileSync } from "node:fs";

const APPS = ["mingla-business/package.json", "app-mobile/package.json"];
const ALLOWED_MAJOR = 54;

function expoMajorOf(pkgJsonText) {
  const pkg = JSON.parse(pkgJsonText);
  const spec =
    (pkg.dependencies && pkg.dependencies.expo) ||
    (pkg.devDependencies && pkg.devDependencies.expo);
  if (!spec) return { spec: null, major: null };
  const m = /(\d+)\./.exec(String(spec).replace(/^[~^><=\s]+/, ""));
  return { spec: String(spec), major: m ? Number(m[1]) : null };
}

function check(readFile) {
  const violations = [];
  for (const app of APPS) {
    let text;
    try {
      text = readFile(app);
    } catch {
      violations.push(`${app}: NOT FOUND (expected a package.json declaring expo)`);
      continue;
    }
    const { spec, major } = expoMajorOf(text);
    if (spec === null) {
      violations.push(`${app}: no \`expo\` dependency declared`);
    } else if (major !== ALLOWED_MAJOR) {
      violations.push(
        `${app}: expo is "${spec}" (major ${major}) — MUST be ~${ALLOWED_MAJOR}.x. ` +
          `Expo 57 was reverted by ORCH-1386 (broke native builds). Do NOT re-bump.`,
      );
    }
  }
  return violations;
}

function main() {
  if (process.argv.includes("--self-test")) {
    const good = JSON.stringify({ dependencies: { expo: "~54.0.34" } });
    const bad = JSON.stringify({ dependencies: { expo: "~57.0.7" } });
    const passViol = check((f) => good);
    const failViol = check((f) => bad);
    if (passViol.length !== 0) {
      console.error("SELF-TEST FAIL: a ~54 pin should PASS but flagged:", passViol);
      process.exit(1);
    }
    if (failViol.length === 0) {
      console.error("SELF-TEST FAIL: a ~57 pin should FAIL but passed (gate is decorative)");
      process.exit(1);
    }
    console.log("orch-1398-expo-pinned-54 self-test OK (54 passes, 57 fails — both directions).");
    process.exit(0);
  }

  const violations = check((f) => readFileSync(f, "utf8"));
  if (violations.length > 0) {
    console.error("✗ ORCH-1398 / I-PROPOSED-1398-EXPO-PINNED-54 — expo must stay on SDK 54:");
    for (const v of violations) console.error("  - " + v);
    console.error(
      "\nExpo 57 was INTENTIONALLY reverted (ORCH-1386 — it broke native builds). " +
        "Do not re-bump to fix a red. See this file's header.",
    );
    process.exit(1);
  }
  console.log("✓ ORCH-1398: expo pinned to SDK 54 in both apps.");
}

main();
