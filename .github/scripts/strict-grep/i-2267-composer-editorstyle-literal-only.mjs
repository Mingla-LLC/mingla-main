#!/usr/bin/env node
/**
 * issue #2267 — the marketing composer's `editorStyle` values stay literal.
 * Invariant: I-2267-COMPOSER-EDITORSTYLE-LITERAL-ONLY.
 *
 * WHY THIS GATE EXISTS. `react-native-pell-rich-editor` builds the editor's
 * WebView source as a template string and interpolates `editorStyle`'s four
 * values into a `<style>` block RAW — no escaping, no quoting discipline
 * (`node_modules/react-native-pell-rich-editor/src/editor.js:55-70`). That is
 * upstream's design, it is not something we can fix from here, and the package
 * is effectively unmaintained (latest release 2025-07-22; the release before it
 * was April 2023), so it will not change.
 *
 * Today every one of those values in `ComposerV2Editor.tsx` is a fixed literal
 * or a frozen design-system token, which makes the raw interpolation harmless:
 * there is nothing for a caller to steer. This gate is what keeps that property
 * true. The failure mode it guards is mundane and easy to introduce — someone
 * makes the composer's colours themeable, or reads a font size from a prop, and
 * a value that used to be constant starts arriving from somewhere else. Nothing
 * about the diff would look dangerous, and no test would notice.
 *
 * REQUIRE:
 *   1. `ComposerV2Editor.tsx` still mounts an `editorStyle={{ … }}` prop. If it
 *      stops, this gate is asserting nothing and must say so out loud rather
 *      than pass — a gate that cannot fail is worse than no gate (#2113).
 *   2. In EVERY `editorStyle={{ … }}` object anywhere under the scanned trees,
 *      every property's value is one of:
 *        - a plain quoted string literal with no `${` interpolation, or
 *        - a dotted static reference into the design-system token modules
 *          (e.g. `textTokens.primary`), which are `as const` object literals.
 *      Anything else — a template literal with a substitution, a function call,
 *      a bare variable, a ternary, a prop or state read, a spread — fails.
 *
 * The rule is deliberately whole-object rather than a list of the four known
 * keys: a fifth key added later gets the same treatment automatically, instead
 * of arriving unguarded.
 *
 * SCOPE. `mingla-business/src` + `mingla-business/app`. `__tests__` is excluded
 * so a test may quote a non-literal shape as a fixture.
 *
 * --self-test drives the pure core with fixtures. Exit 0 clean / 1 violation.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const MOUNT = "mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx";
const SCAN_ROOTS = ["mingla-business/src", "mingla-business/app"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx"]);

/**
 * Static token namespaces whose members are frozen `as const` object literals
 * in `mingla-business/src/constants/designSystem.ts`. A member read off one of
 * these is a compile-time constant, exactly as safe as writing the literal.
 * Append-only by intent: adding a name here widens what the gate permits, so it
 * must be a visible diff.
 */
const STATIC_TOKEN_NAMESPACES = new Set([
  "text",
  "textTokens",
  "accent",
  "glass",
  "radius",
  "spacing",
  "typography",
]);

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Extract the body of every `editorStyle={{ … }}` in `src`, brace-matched so a
 * nested object or a string containing `}` does not truncate the capture.
 * Returns the inner text of each object (without the outer `{ }`).
 */
export function extractEditorStyleObjects(src) {
  const out = [];
  const marker = /editorStyle\s*=\s*\{\s*\{/g;
  let m;
  while ((m = marker.exec(src)) !== null) {
    // Position of the inner `{` is the last char the marker consumed.
    const innerOpen = m.index + m[0].length - 1;
    let depth = 0;
    let quote = null;
    let i = innerOpen;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote !== null) {
        if (c === "\\") { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      out.push({ body: null, raw: m[0] }); // unbalanced — reported by the caller
      continue;
    }
    out.push({ body: src.slice(innerOpen + 1, i), raw: m[0] });
  }
  return out;
}

/**
 * Split an object body into top-level `key: value` pairs. Commas inside nested
 * braces, brackets, parens or strings do not separate.
 */
export function splitTopLevelProps(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote !== null) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** A quoted string with no `${` substitution — the safe base case. */
function isPlainStringLiteral(value) {
  const v = value.trim();
  const quoted =
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2) ||
    (v.startsWith("`") && v.endsWith("`") && v.length >= 2);
  if (!quoted) return false;
  // Reject an "adjacent literals" shape like `"a" + b` that happens to start
  // and end with a quote: the interior must contain no unescaped closing quote.
  const q = v[0];
  const inner = v.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\") { i++; continue; }
    if (inner[i] === q) return false;
  }
  return !inner.includes("${");
}

/** `textTokens.primary`, `typography.body.size` — a frozen design-system read. */
function isStaticTokenPath(value) {
  const v = value.trim();
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(v)) return false;
  return STATIC_TOKEN_NAMESPACES.has(v.split(".")[0]);
}

/** Pure core over a {relPath: content} map so --self-test can inject fixtures. */
export function checkEditorStyleLiteralOnly(files, failures) {
  let mountObjects = 0;

  for (const [rel, raw] of Object.entries(files)) {
    if (/(^|\/)__tests__\//.test(rel)) continue; // fixtures may quote bad shapes
    const src = stripComments(raw);
    if (!src.includes("editorStyle")) continue;

    for (const { body } of extractEditorStyleObjects(src)) {
      if (body === null) {
        failures.push(
          `${rel}: an editorStyle={{ … }} object has unbalanced braces — this gate cannot read it and will not assume it is safe.`,
        );
        continue;
      }
      if (rel === MOUNT) mountObjects++;

      for (const prop of splitTopLevelProps(body)) {
        if (prop.startsWith("...")) {
          failures.push(
            `${rel}: editorStyle spreads \`${prop.slice(0, 48)}\` — a spread hides where the values come from, and pell writes them into its WebView <style> block unescaped (#2267). Write each value out.`,
          );
          continue;
        }
        const sep = splitKeyValue(prop);
        if (sep === null) {
          failures.push(
            `${rel}: editorStyle entry \`${prop.slice(0, 48)}\` is shorthand or unparseable — every value must be written out as a literal (#2267).`,
          );
          continue;
        }
        const { key, value } = sep;
        if (isPlainStringLiteral(value) || isStaticTokenPath(value)) continue;
        failures.push(
          `${rel}: editorStyle.${key} is \`${value.slice(0, 60)}\`, which is not a literal or a design-system token. pell interpolates editorStyle values straight into the WebView's <style> block (src/editor.js:55-70), so these stay constant (#2267).`,
        );
      }
    }
  }

  if (files[MOUNT] === undefined) {
    failures.push(
      `${MOUNT}: not found — the composer's pell mount moved and this gate is pointing at nothing.`,
    );
  } else if (mountObjects === 0) {
    failures.push(
      `${MOUNT}: no editorStyle={{ … }} prop found. Either the pell mount moved or the prop was renamed; until this gate is re-pointed it is asserting nothing (#2113 — a gate that cannot fail carries no information).`,
    );
  }
}

/** Split `key: value` at the first top-level `:`. Returns null for shorthand. */
function splitKeyValue(prop) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < prop.length; i++) {
    const c = prop[i];
    if (quote !== null) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === ":" && depth === 0) {
      const key = prop.slice(0, i).trim().replace(/^["'`]|["'`]$/g, "");
      const value = prop.slice(i + 1).trim();
      if (key.length === 0 || value.length === 0) return null;
      return { key, value };
    }
  }
  return null;
}

function walk(dirAbs, out) {
  if (!fs.existsSync(dirAbs)) return;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (SCAN_EXT.has(path.extname(entry.name))) out.push(abs);
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (files) => {
    const f = [];
    checkEditorStyleLiteralOnly(files, f);
    return f;
  };

  const goodMount = `
import { text as textTokens } from "../../../constants/designSystem";
export function ComposerV2Editor() {
  return (
    <RichEditor
      editorStyle={{
        backgroundColor: "transparent",
        color: textTokens.primary,
        placeholderColor: "rgba(255, 255, 255, 0.62)",
        contentCSSText:
          "font-size: 15px; line-height: 1.55; padding: 12px; min-height: 100%;",
      }}
      disabled={!editable}
    />
  );
}
`;
  const good = { [MOUNT]: goodMount };
  if (run(good).length !== 0) {
    selfFailures.push("today's compliant mount was flagged: " + JSON.stringify(run(good)));
  }

  // 1. The mount file disappearing must FAIL, not quietly pass.
  if (run({}).length === 0) selfFailures.push("a missing mount file was treated as compliant");

  // 2. The prop disappearing must FAIL — otherwise the gate is decorative.
  const noProp = { [MOUNT]: "export function ComposerV2Editor() { return <RichEditor disabled />; }" };
  if (run(noProp).length === 0) {
    selfFailures.push("editorStyle prop removed and the gate still passed — it would be unfalsifiable");
  }

  // 3. THE CLASS THIS GATE EXISTS FOR — each of the four values going dynamic.
  const dynamicCases = [
    ["contentCSSText interpolation", 'contentCSSText: `font-size: ${size}px;`,'],
    ["contentCSSText from a call", "contentCSSText: buildContentCss(theme),"],
    ["color from a prop", "color: props.textColor,"],
    ["color from a bare variable", "color: textColor,"],
    ["backgroundColor from state", "backgroundColor: bgColor,"],
    ["placeholderColor ternary", 'placeholderColor: dark ? "#111" : "#eee",'],
    ["placeholderColor concat", 'placeholderColor: "rgba(" + rgb + ")",'],
  ];
  for (const [label, line] of dynamicCases) {
    const fixture = {
      [MOUNT]: goodMount.replace('backgroundColor: "transparent",', line),
    };
    if (run(fixture).length === 0) selfFailures.push(`${label} was NOT flagged`);
  }

  // 4. A brand-new key is covered automatically, without listing it anywhere.
  const newKey = {
    [MOUNT]: goodMount.replace('backgroundColor: "transparent",', 'caretColor: theme.caret,\n        backgroundColor: "transparent",'),
  };
  if (run(newKey).length === 0) selfFailures.push("a NEW dynamic editorStyle key was not flagged");

  // 5. A spread hides the whole object — must fail.
  const spread = {
    [MOUNT]: goodMount.replace('backgroundColor: "transparent",', "...baseEditorStyle,"),
  };
  if (run(spread).length === 0) selfFailures.push("an editorStyle spread was not flagged");

  // 6. A SECOND mount elsewhere is in scope — the copy is the recurrence.
  const secondMount = {
    ...good,
    "mingla-business/src/components/marketing/OtherEditor.tsx":
      "export const E = () => <RichEditor editorStyle={{ color: userColor }} />;",
  };
  if (run(secondMount).length === 0) selfFailures.push("a dynamic editorStyle in a SECOND file was not flagged");

  // 7. Other design-system token namespaces are accepted (they are `as const`).
  const otherToken = {
    [MOUNT]: goodMount.replace("color: textTokens.primary,", "color: accent.primary,"),
  };
  if (run(otherToken).length !== 0) {
    selfFailures.push("a design-system token read was wrongly flagged: " + JSON.stringify(run(otherToken)));
  }

  // 8. A dotted read off a NON-token namespace is not a token — must fail.
  const fakeToken = {
    [MOUNT]: goodMount.replace("color: textTokens.primary,", "color: userPrefs.primary,"),
  };
  if (run(fakeToken).length === 0) selfFailures.push("a dotted read off a non-token namespace was accepted");

  // 9. A template literal with NO substitution is still a literal — allowed.
  const plainBacktick = {
    [MOUNT]: goodMount.replace('backgroundColor: "transparent",', "backgroundColor: `transparent`,"),
  };
  if (run(plainBacktick).length !== 0) {
    selfFailures.push("a substitution-free template literal was wrongly flagged: " + JSON.stringify(run(plainBacktick)));
  }

  // 10. A CSS literal containing braces and semicolons must not break the
  //     brace matcher (this is what contentCSSText actually looks like).
  const bracey = {
    [MOUNT]: goodMount.replace(
      '"font-size: 15px; line-height: 1.55; padding: 12px; min-height: 100%;"',
      '"body { font-size: 15px; } p { margin: 0; }"',
    ),
  };
  if (run(bracey).length !== 0) {
    selfFailures.push("a CSS literal containing braces broke the parser: " + JSON.stringify(run(bracey)));
  }

  // 11. __tests__ may quote a non-literal shape as a fixture.
  const testFixture = {
    ...good,
    "mingla-business/src/components/marketing/ComposerV2/__tests__/editorStyle.test.tsx":
      "const bad = <RichEditor editorStyle={{ color: someVariable }} />;",
  };
  if (run(testFixture).length !== 0) {
    selfFailures.push("a __tests__ fixture was wrongly flagged: " + JSON.stringify(run(testFixture)));
  }

  // 12. Comments naming a dynamic shape are stripped before the check.
  const commented = {
    [MOUNT]: goodMount.replace(
      "      editorStyle={{",
      "      // never: editorStyle={{ color: props.color }}\n      editorStyle={{",
    ),
  };
  if (run(commented).length !== 0) {
    selfFailures.push("a commented example was wrongly flagged: " + JSON.stringify(run(commented)));
  }

  if (selfFailures.length) {
    console.error("#2267 composer editorStyle literal-only self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "#2267 editorStyle-literal-only self-test PASS (12 groups / 22 cases, incl. all\n" +
      "  four values going dynamic, a new key, a spread, a second file, the mount and\n" +
      "  the prop disappearing, and a brace-bearing CSS literal parsed correctly).",
  );
  process.exit(0);
}

// ---- Live mode
const files = {};
for (const scanRoot of SCAN_ROOTS) {
  const absFiles = [];
  walk(path.join(root, scanRoot), absFiles);
  for (const abs of absFiles) {
    files[path.relative(root, abs)] = fs.readFileSync(abs, "utf8");
  }
}

const failures = [];
checkEditorStyleLiteralOnly(files, failures);

if (failures.length > 0) {
  console.error(
    "#2267 (I-2267-COMPOSER-EDITORSTYLE-LITERAL-ONLY) FAIL — pell interpolates every\n" +
      "editorStyle value into its WebView <style> block raw, so each one stays a fixed\n" +
      "literal or a frozen design-system token.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "#2267 PASS — every editorStyle value in the marketing composer is a literal or a\n" +
    "design-system token, and the guarded mount is still there to assert it against.",
);
