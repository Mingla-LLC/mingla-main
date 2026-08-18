#!/usr/bin/env node
// #2180 [get-app link opens the installed app and strands the user] — T-8.
//
// Enforces I-PROPOSED-2180-BRAND-IMAGE-EXPLICIT-DIMENSIONS:
//
//   Any React Native <Image> rendering a `@mingla/brand-assets` master declares an
//   explicit width AND an explicit height. `aspectRatio` is never used in place of
//   a `height`.
//
// WHY THIS EXISTS. The brand masters are up to 2000x2000 at scale 1
// (`mingla-business-logo.png` is exactly that; Metro registers it `"scales": [1]`),
// so an <Image> with no effective height lays out at width / scale = 2000 pt.
// `mingla-business/app/+not-found.tsx` carried `{ width: 140, aspectRatio: 1356/480 }`
// with NO height, and on device the lockup rendered 2000x2000 pt — pushing the
// heading, the subtext and the screen's ONLY exit ("Go home") off the bottom of an
// 852 pt display. Proven by pixel cross-correlation against the device screenshot
// (mean abs diff 2.52/255) and by two runtime captures where the user could only
// escape by force-quitting: 77 s, then 121 s of focal foreground.
//
// This gate is repo-wide on purpose, so the class cannot recur in a screen nobody
// is looking at.
//
// Modes:
//   node issue-2180-brand-image-explicit-dimensions.mjs              — enforce
//   node issue-2180-brand-image-explicit-dimensions.mjs --self-test  — prove it detects

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const SCAN_ROOTS = [
  "mingla-business/src",
  "mingla-business/app",
  "app-mobile/src",
  "app-mobile/app",
];

/**
 * KNOWN, FROZEN violations that #2180 was forbidden to touch. This list may only
 * SHRINK. Every entry cites why it is here and who owns the fix — a new violation
 * cannot be laundered in, because `EXPECTED_VIOLATIONS.length` is asserted exactly.
 */
const EXEMPT = new Map([
  [
    "mingla-business/src/components/landing/BusinessLandingScreen.tsx",
    "Dead code with zero importers, same bug class (width + maxWidth% + aspectRatio, " +
      "no height). #2180's SPEC put it on the DO-NOT-TOUCH list and routed removal to " +
      "its own work item; this gate is what stops it shipping if it is ever revived.",
  ],
  [
    "app-mobile/src/components/AppLoadingScreen.tsx",
    "width + maxWidth% + aspectRatio, no height. Outside #2180's allowlist. Bounded " +
      "in practice by maxWidth 40%, so it cannot reach 2000 pt — but it is the same " +
      "under-constrained pattern and is owed a fix.",
  ],
]);

/**
 * Prop-spread wrappers: `<Image {...props} source={MASTER} />`. Dimensions come
 * from the caller, so no static rule can be applied at the definition site. Listed
 * explicitly rather than silently skipped.
 */
const SPREAD_WRAPPERS = new Set([
  "mingla-business/src/components/checkout/AttendanceClaimAppIcon.tsx",
]);

/** Exactly what the clean tree is expected to report. Shrinking is the only legal move. */
const EXPECTED_VIOLATION_COUNT = EXEMPT.size;

export function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(tsx|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Read a balanced `{...}` / `[...]` region starting at `open`.
 * Returns the inner text, or null if unbalanced.
 */
function balanced(source, open) {
  const pairs = { "{": "}", "[": "]" };
  const closer = pairs[source[open]];
  if (!closer) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Every `<Image ... />` / `<Image ...>` open tag body in a file. */
function imageTags(source) {
  const out = [];
  const re = /<(?:[A-Za-z][\w.]*\.)?Image\b/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    // Walk to the end of the open tag, respecting nested {...} expressions.
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    out.push({
      attrs: source.slice(m.index + m[0].length, i),
      line: source.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

/** Names bound to a `@mingla/brand-assets` export, including local aliases. */
function brandSymbols(source) {
  const importMatch = source.match(
    /import\s*\{([^}]+)\}\s*from\s*["']@mingla\/brand-assets["']/,
  );
  if (!importMatch) return null;
  const symbols = new Set(
    importMatch[1]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/).pop().trim())
      .filter(Boolean),
  );
  // `const logo = MINGLA_WORDMARK;` — the trailing semicolon is OPTIONAL. Several
  // files in app-mobile are written without semicolons, and requiring one here was
  // a live false negative: AppLoadingScreen.tsx's under-constrained logo went
  // undetected until the self-test below was added to pin this exact shape.
  for (const m of source.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\s*(?:;|$)/gm)) {
    if (symbols.has(m[2])) symbols.add(m[1]);
  }
  return symbols;
}

/** Extract the raw text of a JSX attribute's `{...}` value. */
function attrExpression(attrs, name) {
  const idx = attrs.search(new RegExp(`\\b${name}\\s*=\\s*\\{`));
  if (idx === -1) return null;
  return balanced(attrs, attrs.indexOf("{", idx));
}

/** Which of width/height/aspectRatio a single style-object body DECLARES. */
function keysOf(body) {
  const keys = new Set();
  for (const key of ["width", "height", "aspectRatio"]) {
    if (new RegExp(`(?:^|[\\s{,;])${key}\\s*:`).test(body)) keys.add(key);
  }
  return keys;
}

/**
 * Resolve a style expression into its INDIVIDUAL members — one entry per style
 * object that can reach the element — instead of one merged blob.
 *
 * #2180 D-1. The previous version returned a single union, which made the gate
 * unable to see the masking case: in
 *
 *   <Image style={[styles.logo, largeType ? styles.logoCompact : null]} />
 *
 * deleting `height` from `styles.logo` left the union holding `logoCompact`'s
 * height, so the gate exited 0 on a screen that renders with NO height at every
 * ordinary type size — the exact 2000 pt defect this invariant exists to stop.
 * A conditional sibling must never be able to satisfy the rule on behalf of a
 * branch it does not apply to, so each member is now judged on its own.
 *
 * Handles `styles.x`, inline `{...}`, arrays mixing both, and the conditional
 * forms (`c ? a : b`, `c && a`, `a ?? b`) — every leaf is enumerated, so the
 * conditional operator itself needs no special parsing.
 */
function styleMembers(styleExpr, source) {
  const members = [];
  if (styleExpr === null) return members;

  // Inline object literals anywhere in the expression (incl. inside an array or
  // either arm of a conditional).
  let scan = 0;
  while (scan < styleExpr.length) {
    const open = styleExpr.indexOf("{", scan);
    if (open === -1) break;
    const body = balanced(styleExpr, open);
    if (body === null) break;
    members.push({ label: "an inline style object", keys: keysOf(body) });
    scan = open + body.length + 2;
  }

  // `styles.NAME` references -> look the block up in the StyleSheet.create call.
  // Deliberately NOT anchored to a leading newline: a single-line
  // `StyleSheet.create({ a: { width: 1, height: 2 } })` is legal and was invisible
  // to an earlier newline-anchored lookup, which made the gate report a correctly
  // sized Image as unstyled. Pinned by A-5 in the adversarial suite.
  for (const m of styleExpr.matchAll(/\bstyles\.(\w+)\b/g)) {
    const decl = new RegExp(`(?:^|[{,\\s])${m[1]}\\s*:\\s*\\{`, "g");
    const keys = new Set();
    let hit;
    let found = false;
    while ((hit = decl.exec(source)) !== null) {
      const body = balanced(source, source.indexOf("{", hit.index + hit[0].length - 1));
      if (body !== null) {
        found = true;
        for (const k of keysOf(body)) keys.add(k);
      }
    }
    if (found) members.push({ label: `styles.${m[1]}`, keys });
  }

  return members;
}

/** The union across every member — what the element ends up laid out with. */
function mergedKeys(members) {
  const keys = new Set();
  for (const m of members) for (const k of m.keys) keys.add(k);
  return keys;
}

/**
 * Pure checker. `files` is [{ rel, source }] so --self-test can drive fixtures
 * without mutating the repo.
 */
export function analyze(files) {
  const violations = [];
  let inspected = 0;

  for (const { rel, source } of files) {
    const symbols = brandSymbols(source);
    if (symbols === null) continue;

    for (const tag of imageTags(source)) {
      const sourceExpr = attrExpression(tag.attrs, "source");
      if (sourceExpr === null) {
        // `<Image {...props} source={X} />` with a spread and no literal source
        // attribute is covered by the wrapper list below.
        continue;
      }
      if (![...symbols].some((s) => new RegExp(`\\b${s}\\b`).test(sourceExpr))) continue;

      inspected += 1;
      if (SPREAD_WRAPPERS.has(rel)) continue;

      const members = styleMembers(attrExpression(tag.attrs, "style"), source);
      const keys = mergedKeys(members);
      const hasWidth = keys.has("width");
      const hasHeight = keys.has("height");

      if (!hasWidth || !hasHeight) {
        const why = !hasWidth && !hasHeight
          ? "declares neither width nor height"
          : !hasHeight
            ? keys.has("aspectRatio")
              ? "uses aspectRatio in place of an explicit height"
              : "declares no explicit height"
            : "declares no explicit width";

        violations.push({ rel, line: tag.line, why });
        continue;
      }

      // #2180 D-1 — THE ANTI-MASKING RULE. Every member that sizes this Image on
      // ONE axis must size it on BOTH. Without this, a conditionally-applied
      // sibling silently covers for a branch it is not part of: the merged view
      // above stays green while the screen renders with no height whenever the
      // condition is false. One violation per tag, so the frozen-exemption count
      // keeps its exact meaning.
      const halfSized = members.find(
        (m) => m.keys.has("width") !== m.keys.has("height"),
      );
      if (halfSized) {
        violations.push({
          rel,
          line: tag.line,
          why:
            `${halfSized.label} declares a ` +
            `${halfSized.keys.has("width") ? "width but no height" : "height but no width"}` +
            " — a sibling style member is masking it, so the branch where that " +
            "sibling does not apply renders under-constrained",
        });
      }
    }
  }

  return { violations, inspected };
}

function loadRepoFiles() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    for (const abs of walk(path.join(REPO_ROOT, root))) {
      files.push({
        rel: path.relative(REPO_ROOT, abs).split(path.sep).join("/"),
        source: fs.readFileSync(abs, "utf8"),
      });
    }
  }
  return files;
}

function report(violations) {
  for (const v of violations) {
    const exemption = EXEMPT.get(v.rel);
    const tag = exemption ? "KNOWN" : "NEW  ";
    console.error(`  ${tag} ${v.rel}:${v.line} — ${v.why}`);
    if (exemption) console.error(`        exempt: ${exemption}`);
  }
}

function selfTest() {
  const fixtureHeader = 'import { MINGLA_WORDMARK } from "@mingla/brand-assets";\n';

  const clean = [
    {
      rel: "fixture/Good.tsx",
      source:
        fixtureHeader +
        "const logo = MINGLA_WORDMARK;\n" +
        "export const A = () => <Image source={logo} style={styles.logo} />;\n" +
        "const styles = StyleSheet.create({\n  logo: { width: 200, height: 200 },\n});\n",
    },
  ];
  let r = analyze(clean);
  if (r.violations.length !== 0) {
    console.error("#2180 self-test: a correctly-sized Image was reported as a violation.");
    report(r.violations);
    process.exit(1);
  }
  if (r.inspected !== 1) {
    console.error("#2180 self-test: the clean fixture was not inspected at all.");
    process.exit(1);
  }

  // The exact shipped defect: width + aspectRatio, no height.
  r = analyze([
    {
      rel: "fixture/Bad.tsx",
      source:
        fixtureHeader +
        "const logo = MINGLA_WORDMARK;\n" +
        "export const A = () => <Image source={logo} style={styles.logo} />;\n" +
        "const styles = StyleSheet.create({\n  logo: { width: 140, aspectRatio: 1356 / 480 },\n});\n",
    },
  ]);
  if (r.violations.length !== 1 || !/aspectRatio in place/.test(r.violations[0].why)) {
    console.error("#2180 self-test: width+aspectRatio with no height was NOT detected — this gate proves nothing.");
    process.exit(1);
  }

  // No style at all.
  r = analyze([
    {
      rel: "fixture/None.tsx",
      source: fixtureHeader + "export const A = () => <Image source={MINGLA_WORDMARK} />;\n",
    },
  ]);
  if (r.violations.length !== 1) {
    console.error("#2180 self-test: an unstyled brand Image was NOT detected.");
    process.exit(1);
  }

  // Array style with an inline override supplying both dimensions is legitimate.
  r = analyze([
    {
      rel: "fixture/Array.tsx",
      source:
        fixtureHeader +
        "export const A = () => <Image source={MINGLA_WORDMARK} style={[styles.logo, { width: w, height: h }]} />;\n" +
        "const styles = StyleSheet.create({\n  logo: { aspectRatio: 1356 / 480 },\n});\n",
    },
  ]);
  if (r.violations.length !== 0) {
    console.error("#2180 self-test: an array style with an explicit width+height override was wrongly flagged.");
    report(r.violations);
    process.exit(1);
  }

  // Semicolon-free alias binding. This shape shipped undetected in
  // app-mobile/src/components/AppLoadingScreen.tsx (`const logo = MINGLA_WORDMARK`
  // with no semicolon) and made the gate silently blind to that whole file.
  r = analyze([
    {
      rel: "fixture/NoSemi.tsx",
      source:
        "import { MINGLA_WORDMARK } from '@mingla/brand-assets'\n" +
        "const logo = MINGLA_WORDMARK\n" +
        "export const A = () => <Image source={logo} style={styles.logo} />\n" +
        "const styles = StyleSheet.create({\n  logo: { width: 140, aspectRatio: 1356 / 480 },\n})\n",
    },
  ]);
  if (r.inspected !== 1 || r.violations.length !== 1) {
    console.error(
      "#2180 self-test: a semicolon-free `const logo = MASTER` alias was not resolved, " +
        "so the gate is blind to every file written without semicolons.",
    );
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // #2180 D-1 — THE CONDITIONAL SHAPE. This is the exact composition both
  // shipped `+not-found.tsx` screens use, and the one that used to defeat this
  // gate: the union of the members held a height, so deleting `height` from the
  // member that applies at ORDINARY type sizes exited 0.
  //
  // Proving the member split rather than assuming it: each case asserts WHICH
  // member was named, so a gate that merely re-unioned would fail here.
  // -------------------------------------------------------------------------
  const conditional = (logoBody, compactBody, operator) => ({
    rel: "fixture/Conditional.tsx",
    source:
      fixtureHeader +
      "const logo = MINGLA_WORDMARK;\n" +
      "export const A = () => <Image source={logo} style={[styles.logo, " +
      operator +
      "]} />;\n" +
      "const styles = StyleSheet.create({\n" +
      `  logo: ${logoBody},\n` +
      `  logoCompact: ${compactBody},\n` +
      "});\n",
  });

  const TERNARY = "largeType ? styles.logoCompact : null";
  const LOGICAL = "largeType && styles.logoCompact";

  // Both members fully sized — the shipped, correct shape. Must stay green, or
  // the rule below is just "always red".
  for (const operator of [TERNARY, LOGICAL]) {
    r = analyze([
      conditional("{ width: 200, height: 200 }", "{ width: 96, height: 96 }", operator),
    ]);
    if (r.inspected !== 1 || r.violations.length !== 0) {
      console.error(
        `#2180 self-test: the correct conditional lockup (${operator}) was flagged or not inspected.`,
      );
      report(r.violations);
      process.exit(1);
    }
  }

  // The masking case, in BOTH directions and BOTH operators. Deleting `height`
  // from either member must be caught, and the message must name the member
  // that actually lost it.
  for (const operator of [TERNARY, LOGICAL]) {
    for (const [logoBody, compactBody, expected] of [
      ["{ width: 200 }", "{ width: 96, height: 96 }", "styles.logo"],
      ["{ width: 200, height: 200 }", "{ width: 96 }", "styles.logoCompact"],
    ]) {
      r = analyze([conditional(logoBody, compactBody, operator)]);
      if (
        r.violations.length !== 1 ||
        !r.violations[0].why.startsWith(`${expected} declares a width but no height`)
      ) {
        console.error(
          `#2180 self-test: a conditionally-masked missing height (${expected}, ${operator}) was NOT ` +
            "caught. A sibling style member can cover for a branch it does not apply to, " +
            "so this gate cannot fail on the regression it exists to prevent.",
        );
        report(r.violations);
        process.exit(1);
      }
    }
  }

  // The mirror image: a member that supplies a height but no width is equally
  // under-constrained, and must be named as such rather than as a missing height.
  r = analyze([
    conditional("{ height: 200 }", "{ width: 96, height: 96 }", TERNARY),
  ]);
  if (
    r.violations.length !== 1 ||
    !r.violations[0].why.startsWith("styles.logo declares a height but no width")
  ) {
    console.error("#2180 self-test: a member with a height but no width was not caught.");
    report(r.violations);
    process.exit(1);
  }

  // A non-brand Image must be ignored entirely.
  r = analyze([
    {
      rel: "fixture/Other.tsx",
      source: fixtureHeader + "export const A = () => <Image source={{ uri }} style={styles.x} />;\n",
    },
  ]);
  if (r.inspected !== 0) {
    console.error("#2180 self-test: a non-brand Image was inspected — the source match is too loose.");
    process.exit(1);
  }

  // P-vacuous: discovering nothing must never read as success.
  r = analyze([]);
  if (r.inspected !== 0) {
    console.error("#2180 self-test: empty input did not report zero inspected.");
    process.exit(1);
  }

  console.log(
    "#2180 self-test passed (clean green; missing height, missing style, and " +
      "over-loose source matching all caught; array-style override correctly " +
      "allowed; conditionally-masked missing dimensions caught in both " +
      "directions for both `? :` and `&&`).",
  );
}

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const files = loadRepoFiles();
  const { violations, inspected } = analyze(files);

  // P-vacuous — a gate that matched nothing must FAIL, never pass green.
  if (inspected === 0) {
    console.error(
      "#2180: discovered ZERO @mingla/brand-assets <Image> render sites across " +
        SCAN_ROOTS.join(", ") +
        ". A gate that checks nothing must fail, not pass.",
    );
    process.exit(1);
  }

  const unexpected = violations.filter((v) => !EXEMPT.has(v.rel));

  if (unexpected.length > 0) {
    console.error(
      "#2180: a brand-asset <Image> is missing an explicit width and/or height.\n" +
        "The @mingla/brand-assets masters are up to 2000x2000 at scale 1, so an Image\n" +
        "with no effective height lays out at 2000 pt and silently pushes its siblings\n" +
        "off-screen. That is what made the business 404 escapable only by force-quit.\n" +
        "Declare BOTH a numeric width and a numeric height; never use aspectRatio in\n" +
        "place of a height.\n",
    );
    report(violations);
    process.exit(1);
  }

  // The frozen list may shrink (someone fixed one) but never grow.
  if (violations.length > EXPECTED_VIOLATION_COUNT) {
    console.error(
      `#2180: known-violation count grew from ${EXPECTED_VIOLATION_COUNT} to ${violations.length}.`,
    );
    report(violations);
    process.exit(1);
  }

  console.log(
    `#2180 OK — ${inspected} brand-asset <Image> render sites inspected; ` +
      `${violations.length} known-and-frozen exemption(s), 0 new violations.`,
  );
}

// Run ONLY when invoked directly (`node issue-2180-….mjs`), so the adversarial
// suite in __tests__/ can import `analyze` without the gate exiting the process
// out from under the test runner.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { EXEMPT, SPREAD_WRAPPERS, EXPECTED_VIOLATION_COUNT, SCAN_ROOTS, loadRepoFiles };
