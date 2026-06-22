#!/usr/bin/env node
/**
 * ORCH-1211 [business notifications inbox crashes on mobile web] —
 * I-PROPOSED-1211-NOTIF-WEB-RENDER-SAFE.
 *
 * WHY: `BusinessNotificationsScreen.tsx` called a `react-native-reanimated`
 * layout-animation builder at MODULE TOP LEVEL:
 *   const EXPAND_TRANSITION = LinearTransition.duration(durations.entry).easing(EASE_OUT);
 * `LinearTransition` (and every reanimated layout-animation builder) is
 * `undefined` on web at module-eval, so reading `.duration` throws
 * "Cannot read properties of undefined (reading 'duration')" the instant the
 * `/notifications` route imports the screen — BEFORE any render guard. The throw
 * bubbles to the global ErrorBoundary ("Something broke."), crashing the whole
 * page. The fix guards the builder call to native (`isWeb ? undefined : …`).
 *
 * Separately, `ReanimatedSwipeable` (react-native-gesture-handler) must stay
 * rendered NATIVE-ONLY — the file branches `if (isWeb) return <Reanimated.View>`
 * BEFORE the `<ReanimatedSwipeable>` JSX so the swipe panel never mounts on web.
 *
 * RULE (both must hold in BusinessNotificationsScreen.tsx):
 *   1. NO module-top-level (not inside a function/hook body) reanimated
 *      layout-animation builder invocation (LinearTransition / FadeIn* / FadeOut* /
 *      SlideIn* / SlideOut* / ZoomIn* / ZoomOut* / CurvedTransition /
 *      JumpingTransition / SequencedTransition / FadingTransition /
 *      EntryExitTransition + `.duration(` / `.easing(` / `.springify(` / `.delay(` /
 *      `.build(`) UNLESS the SAME line is platform-guarded (`isWeb ?` /
 *      `Platform.OS`).
 *   2. `<ReanimatedSwipeable` MUST be preceded (anywhere earlier in the file) by an
 *      `if (isWeb) return` guard so it never renders on web.
 *
 * `--self-test` injects synthetic guarded / unguarded / web-branch lines and
 * asserts the gate fires on the unguarded builder call and on a missing isWeb
 * return guard, and passes on the compliant shapes.
 *
 * Model: orch-1105-web-gesture-safe.mjs / orch-1001-no-native-turbomodule-in-web-bundle.mjs.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const TARGET =
  "mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx";

// A reanimated layout-animation builder method invocation. Matches the builder
// identifier immediately followed by one of the crash-on-web builder methods.
const BUILDER_CALL =
  /\b(LinearTransition|FadeIn[A-Za-z]*|FadeOut[A-Za-z]*|SlideIn[A-Za-z]*|SlideOut[A-Za-z]*|ZoomIn[A-Za-z]*|ZoomOut[A-Za-z]*|CurvedTransition|JumpingTransition|SequencedTransition|FadingTransition|EntryExitTransition)\s*\.\s*(duration|easing|springify|delay|build)\s*\(/;

// A platform guard on the SAME line makes the builder call web-safe.
const PLATFORM_GUARD = /\bisWeb\b|\bPlatform\.OS\b/;

// `<ReanimatedSwipeable` JSX open tag (the native-only swipe panel).
const SWIPEABLE_JSX = /<ReanimatedSwipeable\b/;
// The native-only guard that must precede the swipeable.
const WEB_RETURN_GUARD = /if\s*\(\s*isWeb\s*\)\s*\{?\s*\n?\s*return/;

/**
 * Strip line comments + block comments so a builder call mentioned in a comment
 * (e.g. the protective ORCH-1211 comment, or the gate's own JSDoc when this file
 * is swept) is not flagged. We blank out comment content but PRESERVE newlines so
 * line numbers stay accurate.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | line | block | str | tmpl
  let quote = "";
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (mode === "code") {
      if (c === "/" && c2 === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (c === "/" && c2 === "*") {
        mode = "block";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        mode = "str";
        quote = c;
        out += c;
        i += 1;
        continue;
      }
      if (c === "`") {
        mode = "tmpl";
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += "\n";
      }
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && c2 === "/") {
        mode = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (mode === "str") {
      out += c;
      if (c === "\\") {
        out += c2 ?? "";
        i += 2;
        continue;
      }
      if (c === quote) mode = "code";
      i += 1;
      continue;
    }
    if (mode === "tmpl") {
      out += c;
      if (c === "\\") {
        out += c2 ?? "";
        i += 2;
        continue;
      }
      if (c === "`") mode = "code";
      i += 1;
      continue;
    }
  }
  return out;
}

/**
 * Track brace depth to determine module-top-level (depth 0). A builder call at
 * depth 0 is evaluated at import time → crashes on web unless guarded.
 */
function checkSource(src, failures) {
  const clean = stripComments(src);
  const lines = clean.split("\n");
  let depth = 0;
  let sawWebReturnGuard = false;
  let sawSwipeable = false;

  // Detect the web-return guard anywhere before the swipeable JSX.
  if (WEB_RETURN_GUARD.test(clean)) {
    const guardIdx = clean.search(WEB_RETURN_GUARD);
    const swipeIdx = clean.search(SWIPEABLE_JSX);
    sawWebReturnGuard = swipeIdx === -1 || (guardIdx > -1 && guardIdx < swipeIdx);
  }
  sawSwipeable = SWIPEABLE_JSX.test(clean);

  // A builder call is web-safe when its ENCLOSING STATEMENT carries a platform
  // guard — the guard may sit a couple of lines above the `.duration(` call when
  // the ternary is line-wrapped (prettier splits `isWeb ? undefined : Builder…`).
  // So look back across the current unterminated statement (no `;` yet) for the
  // guard, not just the same physical line. `statementBuf` accumulates the
  // depth-0 statement text since the last `;`.
  let statementBuf = "";
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const depthBefore = depth;
    if (depthBefore === 0) {
      statementBuf += "\n" + line;
    }
    if (BUILDER_CALL.test(line) && depthBefore === 0) {
      const guardedInline = PLATFORM_GUARD.test(line);
      const guardedInStatement = PLATFORM_GUARD.test(statementBuf);
      if (!guardedInline && !guardedInStatement) {
        failures.push(
          `${TARGET}:${n + 1}: module-top-level reanimated layout-builder call ` +
            `"${line.trim().slice(0, 100)}" — this is \`undefined\` on web at ` +
            `module-eval and crashes /notifications into the global ErrorBoundary. ` +
            `Guard it with \`isWeb ? undefined : …\` (ORCH-1211).`,
        );
      }
    }
    // Update brace depth AFTER classifying the line.
    for (const ch of line) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
    if (depth < 0) depth = 0;
    // Reset the statement buffer at each top-level statement terminator so a
    // guard from a PRIOR statement cannot mask an unguarded later call.
    if (depth === 0 && line.includes(";")) {
      statementBuf = "";
    }
  }

  if (sawSwipeable && !sawWebReturnGuard) {
    failures.push(
      `${TARGET}: <ReanimatedSwipeable> is rendered without a preceding ` +
        `\`if (isWeb) return\` guard — the gesture-handler swipe panel must stay ` +
        `NATIVE-ONLY (it crashes on web). Restore the web-branch early return ` +
        `(ORCH-1211 F-4).`,
    );
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];

  const run = (src) => {
    const f = [];
    checkSource(src, f);
    return f;
  };

  // (a) Unguarded module-top-level builder call → MUST fire.
  const bad = `const isWeb = Platform.OS === "web";\nconst EXPAND_TRANSITION = LinearTransition.duration(260).easing(out);\n`;
  if (run(bad).length === 0) {
    selfFailures.push("unguarded top-level LinearTransition.duration() not flagged");
  }

  // (b) Guarded (isWeb ?) top-level builder call → MUST pass.
  const good = `const isWeb = Platform.OS === "web";\nconst EXPAND_TRANSITION = isWeb\n  ? undefined\n  : LinearTransition.duration(260).easing(out);\n`;
  if (run(good).length !== 0) {
    selfFailures.push("guarded (isWeb ?) builder call wrongly flagged");
  }

  // (c) Builder call INSIDE a function body (depth > 0) → not module-top-level → pass.
  const insideFn = `function make() {\n  return FadeIn.duration(100);\n}\n`;
  if (run(insideFn).length !== 0) {
    selfFailures.push("builder call inside a function body wrongly flagged");
  }

  // (d) Builder name only in a comment → must NOT fire (comments stripped).
  const commentOnly = `// LinearTransition.duration(260) is undefined on web\nconst x = 1;\n`;
  if (run(commentOnly).length !== 0) {
    selfFailures.push("builder mention in a comment wrongly flagged");
  }

  // (e) Swipeable WITHOUT a web-return guard → MUST fire.
  const noGuard = `function Row() {\n  return <ReanimatedSwipeable ref={r}><Inner /></ReanimatedSwipeable>;\n}\n`;
  if (run(noGuard).length === 0) {
    selfFailures.push("ReanimatedSwipeable without isWeb-return guard not flagged");
  }

  // (f) Swipeable WITH a preceding web-return guard → MUST pass.
  const withGuard = `function Row() {\n  if (isWeb) {\n    return <Reanimated.View><Inner /></Reanimated.View>;\n  }\n  return <ReanimatedSwipeable ref={r}><Inner /></ReanimatedSwipeable>;\n}\n`;
  if (run(withGuard).length !== 0) {
    selfFailures.push("ReanimatedSwipeable WITH a preceding isWeb return wrongly flagged");
  }

  // (g) FadeOut + .springify (other builder/method) unguarded at top level → MUST fire.
  const otherBuilder = `const T = FadeOutDown.springify();\n`;
  if (run(otherBuilder).length === 0) {
    selfFailures.push("unguarded top-level FadeOutDown.springify() not flagged");
  }

  if (selfFailures.length) {
    console.error("ORCH-1211 I-PROPOSED-1211-NOTIF-WEB-RENDER-SAFE self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1211 I-PROPOSED-1211-NOTIF-WEB-RENDER-SAFE self-test PASS (7/7 cases).",
  );
  process.exit(0);
}

// ---- Live mode
const abs = path.join(root, TARGET);
if (!fs.existsSync(abs)) {
  console.error(
    `ORCH-1211 gate FAIL — target not found at ${TARGET} (gate path out of sync with source).`,
  );
  process.exit(1);
}
const failures = [];
checkSource(fs.readFileSync(abs, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1211 I-PROPOSED-1211-NOTIF-WEB-RENDER-SAFE FAIL — the business notifications\n" +
      "screen regressed into a web crash. A reanimated layout-animation builder must NOT\n" +
      "run at module top level on web, and <ReanimatedSwipeable> must stay native-only.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1211 I-PROPOSED-1211-NOTIF-WEB-RENDER-SAFE PASS — no unguarded top-level reanimated\n" +
    "layout-builder call; ReanimatedSwipeable stays behind the isWeb return guard.",
);
