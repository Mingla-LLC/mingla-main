#!/usr/bin/env node
// #2539 [brand avatar renders square instead of clipped to a circle] — class gate.
//
// Enforces I-PROPOSED-2539-RNW-IMAGE-NO-FILTER-UNDER-ROUND-CLIP:
//
//   A react-native-web <Image> must never resolve a style or prop set that
//   produces a CSS `filter` (shadowColor / shadowOpacity / shadowOffset /
//   shadowRadius / tintColor / blurRadius, or an explicit `filter`) while it
//   also resolves a `borderRadius`. Shadows for a rounded image belong on a
//   wrapping <View> via `boxShadow`.
//
// WHY THIS EXISTS. react-native-web's Image renders TWO elements: a root <View>
// that is unconditionally `overflow: hidden` (Image/index.js L297-302), and an
// absolutely-positioned inner layer that carries the picture. Any shadow*/tint/
// blur on the Image is hoisted onto that inner layer as a CSS `filter`
// (Image/index.js L52-87), and the shadow is ERASED from the root twice over
// (`styles.undo` nulls all four shadow* props, and an explicit
// `{ boxShadow: null }` follows).
//
// A `filter` promotes that inner layer to its own composited layer. Under
// WebKit's accelerated-compositing path the non-composited ancestor's
// `overflow: hidden` is applied to that layer as a RECTANGULAR layer clip and
// the `border-radius` is discarded. Blink applies the rounded clip correctly.
// So the avatar rendered as a full square photo painted over its own round
// orange ring — in Safari only, on the live production page, for months.
//
// THE BUG CLASS, WHICH IS THE POINT. Every observable signal read as correct:
//   * the source says borderRadius + overflow: hidden;
//   * getComputedStyle on the live page says border-radius: 30px, overflow: hidden;
//   * headless Chromium renders a perfect circle;
//   * playwright.webkit renders a perfect circle too — headless AND headed —
//     because Playwright's WebKit build does not take the CoreAnimation
//     accelerated-compositing path, so the filtered child never gets a real
//     composited layer and the bug simply does not exist there.
// Only pixels from real WebKit.framework (a WKWebView snapshot) show it. That
// makes every cheap guard structurally blind, which is why this gate asserts
// the CAUSE — a filter-producing prop meeting a border-radius on an <Image> —
// rather than the rendered effect.
//
// C-1  a resolved <Image> style set contains a filter-producing prop AND
//      borderRadius. Resolution covers `styles.X` keys, inline object literals,
//      and ONE hop through a `const …Style = [ … ]` / `= { … }` binding.
// C-2  an <Image>'s own PROPS carry tintColor= or blurRadius= while its
//      resolved style contains borderRadius.
// C-3  census — the gate must resolve at least one <Image> in
//      packages/brand-rendering/PublicBrandPage.tsx. A parser that silently
//      resolves zero elements would pass vacuously forever; this is the guard
//      against that, and it is the check that fails first if the component is
//      renamed or moved.
//
// Comments are stripped before ANY match. This repo has already produced a
// false positive from an audit regex matching the word inside a comment in the
// same file (reference_audit_regex_matches_comments_same_file), and the
// protective comment this fix adds to `styles.avatar` spells out all four
// shadow* prop names directly above the style block it protects — an
// unstripped matcher would fire on the fix itself.
//
// `--self-test` proves the gate fires on the reverted shape and passes on the
// shipped shape, so a green run is evidence rather than vacuity.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

/** Directories swept. */
const SCAN_ROOTS = ["packages", "mingla-business/src"];
/** Directory names never descended into. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "__tests__",
  ".expo",
  "web-build",
  "coverage",
]);
/**
 * The census target. `.native.tsx` files are excluded from the sweep because
 * react-native-web never loads them, so the filter mechanism cannot apply.
 */
const CENSUS_FILE = "packages/brand-rendering/PublicBrandPage.tsx";

/**
 * Style props react-native-web turns into a CSS `filter` on the Image's inner
 * picture layer, plus `filter` itself. Any ONE of them is enough — the shadow
 * branch fires on `shadowOffset` alone (Image/index.js L75), and reverting a
 * single `shadowOpacity: 0.26` line into `styles.avatar` re-trips C-1.
 */
const FILTER_PROPS = [
  "shadowColor",
  "shadowOpacity",
  "shadowOffset",
  "shadowRadius",
  "tintColor",
  "blurRadius",
  "filter",
];
/** Props that produce a filter when passed as ELEMENT props rather than style. */
const FILTER_ELEMENT_PROPS = ["tintColor", "blurRadius"];

// ---------------------------------------------------------------------------
// Source normalisation
// ---------------------------------------------------------------------------

/**
 * Blank out comment bodies AND string/template contents, preserving every
 * newline and the overall character offset so reported line numbers stay true.
 * Strings are blanked as well as comments: a literal like "shadowRadius" in a
 * label or a URL is data, not a style key, and must not be matched.
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  let state = "code"; // code | line | block | sq | dq | tpl
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === "code") {
      if (c === "/" && d === "/") { out += "  "; i += 2; state = "line"; continue; }
      if (c === "/" && d === "*") { out += "  "; i += 2; state = "block"; continue; }
      if (c === "'") { out += c; i += 1; state = "sq"; continue; }
      if (c === '"') { out += c; i += 1; state = "dq"; continue; }
      if (c === "`") { out += c; i += 1; state = "tpl"; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") {
      if (c === "\n") { out += "\n"; i += 1; state = "code"; continue; }
      out += " "; i += 1; continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") { out += "  "; i += 2; state = "code"; continue; }
      out += c === "\n" ? "\n" : " "; i += 1; continue;
    }
    // string / template states
    if (c === "\\") { out += "  "; i += 2; continue; }
    const closer = state === "sq" ? "'" : state === "dq" ? '"' : "`";
    if (c === closer) { out += c; i += 1; state = "code"; continue; }
    // A template literal's ${ … } is real code — leave it alone.
    if (state === "tpl" && c === "$" && d === "{") {
      const end = matchBrace(src, i + 1);
      if (end !== -1) { out += src.slice(i, end + 1); i = end + 1; continue; }
    }
    out += c === "\n" ? "\n" : " ";
    i += 1;
  }
  return out;
}

/** Index of the `}` matching the `{` at `open`, or -1. Strings are pre-blanked. */
export function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// ---------------------------------------------------------------------------
// StyleSheet.create parsing
// ---------------------------------------------------------------------------

/** Map of styleKey -> { body, line } for every StyleSheet.create block in a file. */
export function parseStyleSheets(src) {
  const sheets = new Map();
  const re = /StyleSheet\.create\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = src.indexOf("{", m.index + "StyleSheet.create".length);
    if (open === -1) continue;
    const close = matchBrace(src, open);
    if (close === -1) continue;
    let i = open + 1;
    while (i < close) {
      const rest = src.slice(i, close);
      const km = /(^|[\s,{])([A-Za-z_$][\w$]*)\s*:\s*\{/.exec(rest);
      if (!km) break;
      const brace = i + km.index + km[0].length - 1;
      const end = matchBrace(src, brace);
      if (end === -1 || end > close) break;
      sheets.set(km[2], { body: src.slice(brace + 1, end), line: lineOf(src, brace) });
      i = end + 1;
    }
    re.lastIndex = close;
  }
  return sheets;
}

/** Every `{ … }` group at brace-depth 0 within an expression. */
function objectLiterals(expr) {
  const out = [];
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === "{") {
      const end = matchBrace(expr, i);
      if (end === -1) break;
      out.push(expr.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** The right-hand side of `const <id> = …` up to the `;` that closes it. */
export function constBinding(src, id) {
  const re = new RegExp(`\\bconst\\s+${id}\\s*(?::[^=]*)?=`, "g");
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 0;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === "{" || c === "[" || c === "(") depth += 1;
    else if (c === "}" || c === "]" || c === ")") {
      depth -= 1;
      if (depth < 0) break;
    } else if (c === ";" && depth === 0) break;
  }
  return src.slice(m.index + m[0].length, i);
}

// ---------------------------------------------------------------------------
// JSX element scanning
// ---------------------------------------------------------------------------

/** End index of the opening tag that starts at `start`. Braces are balanced. */
function openTagEnd(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

/** The `{ … }` value of attribute `name` inside an opening tag, or null. */
function attrExpr(tag, name) {
  const re = new RegExp(`(^|[\\s{])${name}\\s*=\\s*\\{`);
  const m = re.exec(tag);
  if (!m) return null;
  const brace = m.index + m[0].length - 1;
  const end = matchBrace(tag, brace);
  if (end === -1) return null;
  return tag.slice(brace + 1, end);
}

/**
 * Resolve a style expression into the concrete style bodies it contributes.
 * `hop` bounds how many `const` bindings deep resolution follows (1 per SPEC).
 */
export function resolveStyleSources(expr, sheets, src, hop = 1, seen = new Set()) {
  const sources = [];
  if (expr === null || expr === undefined) return sources;
  for (const m of expr.matchAll(/styles\.([A-Za-z_$][\w$]*)/g)) {
    const entry = sheets.get(m[1]);
    if (entry) sources.push({ name: `styles.${m[1]}`, body: entry.body, line: entry.line });
  }
  for (const body of objectLiterals(expr)) {
    sources.push({ name: "inline style object", body, line: null });
  }
  if (hop > 0) {
    // Bare identifiers: `style={avatarStyle}` / `style={[base, avatarStyle]}`.
    const withoutMembers = expr.replace(/\b[A-Za-z_$][\w$]*\s*\.\s*[A-Za-z_$][\w$]*/g, " ");
    for (const m of withoutMembers.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const bound = constBinding(src, id);
      if (bound === null) continue;
      sources.push(...resolveStyleSources(bound, sheets, src, hop - 1, seen));
    }
  }
  return sources;
}

/** Style-object keys present in a style body (keys only, never values). */
function propsIn(body, names) {
  const found = [];
  for (const name of names) {
    if (new RegExp(`(^|[\\s,{])${name}\\s*:`).test(body)) found.push(name);
  }
  return found;
}

const hasBorderRadius = (body) => /(^|[\s,{])borderRadius\s*:/.test(body);

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/** @returns {{resolvedImages: number}} — the census counter for C-3. */
export function checkSource(rawSrc, relPath, failures) {
  const src = stripComments(rawSrc);
  const sheets = parseStyleSheets(src);
  let resolvedImages = 0;

  const re = /<Image(?![A-Za-z0-9_$])/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const end = openTagEnd(src, m.index);
    if (end === -1) continue;
    const tag = src.slice(m.index, end);
    const line = lineOf(src, m.index);
    const sources = resolveStyleSources(attrExpr(tag, "style"), sheets, src);
    if (sources.length > 0) resolvedImages += 1;

    const rounded = sources.filter((s) => hasBorderRadius(s.body));
    // C-1 — filter-producing style prop meeting a borderRadius on the same Image.
    if (rounded.length > 0) {
      for (const source of sources) {
        for (const prop of propsIn(source.body, FILTER_PROPS)) {
          failures.push(
            `${relPath}:${line}: <Image> resolves \`${prop}\` (via ${source.name}` +
              `${source.line === null ? "" : ` at line ${source.line}`}) together with ` +
              `\`borderRadius\` (via ${rounded.map((r) => r.name).join(", ")}). ` +
              `react-native-web hoists that prop to \`filter: drop-shadow()\` on the ` +
              `Image's inner picture layer, and WebKit then clips that composited ` +
              `layer to a RECTANGLE and drops the border-radius — the image renders ` +
              `SQUARE in Safari while every computed style still reads correct ` +
              `(#2539). Move the shadow to a wrapping <View> using \`boxShadow\`.`,
          );
        }
      }
      // C-2 — the same defect reached through element props instead of style.
      for (const prop of FILTER_ELEMENT_PROPS) {
        if (new RegExp(`(^|[\\s{])${prop}\\s*=`).test(tag)) {
          failures.push(
            `${relPath}:${line}: <Image> passes \`${prop}=\` as a PROP while its ` +
              `resolved style sets \`borderRadius\` (via ` +
              `${rounded.map((r) => r.name).join(", ")}). Same mechanism as C-1 — ` +
              `react-native-web turns it into a CSS filter on the clipped inner ` +
              `layer and WebKit drops the round clip (#2539).`,
          );
        }
      }
    }
  }
  return { resolvedImages };
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.isFile() && e.name.endsWith(".tsx") && !e.name.endsWith(".native.tsx")) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (src) => {
    const f = [];
    const r = checkSource(src, "fixture.tsx", f);
    return { failures: f, ...r };
  };

  const SHEET = (body) => `const styles = StyleSheet.create({\n${body}\n});`;

  // (a) The SHIPPED (fixed) shape — glow on a wrapper, Image unfiltered → PASS.
  const fixed = `
    const glowStyle = { width: size, height: size, borderRadius: size / 2,
      boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 18, spreadDistance: 0, color: c }] };
    const avatarStyle = [styles.avatar, { width: size, height: size, borderRadius: size / 2 }];
    const el = <View style={glowStyle}><Image source={s} style={avatarStyle} resizeMode="cover" /></View>;
    ${SHEET(`  avatar: { alignItems: "center", borderWidth: 3, overflow: "hidden" },`)}
  `;
  if (run(fixed).failures.length !== 0) {
    selfFailures.push(`fixed wrapper-glow shape wrongly flagged: ${run(fixed).failures[0]}`);
  }
  if (run(fixed).resolvedImages !== 1) {
    selfFailures.push("fixed shape: parser resolved 0 Images — gate would be vacuous");
  }

  // (b) T-7 — the REVERT the SPEC names: shadowOpacity: 0.26 restored to
  //     styles.avatar, borderRadius still arriving from the inline object.
  const revert = `
    const avatarStyle = [styles.avatar, { width: size, height: size, borderRadius: size / 2 }];
    const el = <Image source={s} style={avatarStyle} resizeMode="cover" />;
    ${SHEET(`  avatar: { borderWidth: 3, overflow: "hidden", shadowOpacity: 0.26 },`)}
  `;
  if (run(revert).failures.length === 0) {
    selfFailures.push("T-7: shadowOpacity restored to styles.avatar was NOT flagged");
  } else if (!/shadowOpacity/.test(run(revert).failures[0])) {
    selfFailures.push("T-7: failure message does not name the offending prop");
  }

  // (c) The FULL shipped-before shape — all four shadow* props, two of them in
  //     the StyleSheet and shadowColor in the inline object.
  const original = `
    const avatarStyle = [styles.avatar, { width: size, borderRadius: size / 2, shadowColor: palette.accent }];
    const el = <Image source={s} style={avatarStyle} />;
    ${SHEET(`  avatar: { overflow: "hidden", shadowOpacity: 0.26, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },`)}
  `;
  if (run(original).failures.length < 4) {
    selfFailures.push(`original 4-shadow-prop shape flagged only ${run(original).failures.length}/4 props`);
  }

  // (d) Direct style, no indirection at all.
  const direct = `
    const el = <Image source={s} style={styles.thumb} />;
    ${SHEET(`  thumb: { borderRadius: 12, shadowRadius: 4 },`)}
  `;
  if (run(direct).failures.length === 0) selfFailures.push("direct styles.X shape not flagged");

  // (e) Inline-only style object.
  const inline = `const el = <Image source={s} style={{ borderRadius: 8, tintColor: "#fff" }} />;`;
  if (run(inline).failures.length === 0) selfFailures.push("inline object shape not flagged");

  // (f) C-2 — tintColor as an element PROP with a rounded style.
  const propTint = `
    const el = <Image source={s} tintColor={accent} style={styles.logo} />;
    ${SHEET(`  logo: { width: 40, height: 40, borderRadius: 20 },`)}
  `;
  const propTintRun = run(propTint);
  if (propTintRun.failures.length === 0) selfFailures.push("C-2: tintColor prop + rounded style not flagged");
  else if (!/PROP/.test(propTintRun.failures[0])) selfFailures.push("C-2: failure does not identify the prop route");

  // (g) T-8 — the real SeeWhosGoingGate shape: filtered but NOT rounded → PASS.
  const kicker = `
    const el = <Image source={MINGLA_WORDMARK} tintColor={palette.accent} style={styles.kickerLogo} resizeMode="contain" />;
    ${SHEET(`  kickerLogo: { width: 40, height: 14 },`)}
  `;
  if (run(kicker).failures.length !== 0) {
    selfFailures.push("T-8: unrounded tinted logo wrongly flagged (gate over-fires)");
  }

  // (h) Rounded but unfiltered → PASS. The complement of (g).
  const roundedOnly = `
    const el = <Image source={s} style={styles.round} />;
    ${SHEET(`  round: { width: 40, height: 40, borderRadius: 20 },`)}
  `;
  if (run(roundedOnly).failures.length !== 0) selfFailures.push("rounded-but-unfiltered wrongly flagged");

  // (i) T-9 — comment prose naming the props next to an <Image> must NOT fire.
  //     This is the exact shape the #2539 fix ships: a protective comment above
  //     `styles.avatar` spelling out all four shadow* names.
  const comments = `
    // #2539 — NO shadow* here. shadowOpacity: 0.26, shadowRadius: 18 and
    /* shadowOffset: { width: 0, height: 10 } and shadowColor all belong on the
       wrapper, never on this <Image> with its borderRadius. */
    const el = <Image source={s} style={styles.avatar} />;
    ${SHEET(`  avatar: { borderWidth: 3, overflow: "hidden", borderRadius: 30 },`)}
  `;
  if (run(comments).failures.length !== 0) {
    selfFailures.push("T-9: comment prose was matched — gate is not comment-stripped");
  }

  // (j) VACUITY GUARD — a comment must not RESCUE a real violation either.
  const commentPlusRevert = `
    // the glow moved to a wrapper, this Image is clean
    const el = <Image source={s} style={styles.avatar} />;
    ${SHEET(`  avatar: { borderRadius: 30, shadowOpacity: 0.26 },`)}
  `;
  if (run(commentPlusRevert).failures.length === 0) {
    selfFailures.push("VACUITY: a reassuring comment suppressed a real violation");
  }

  // (k) A string containing a prop name is data, not a style key → PASS.
  const stringy = `
    const label = "shadowOpacity: 0.26";
    const el = <Image source={s} style={styles.avatar} accessibilityLabel={\`\${n} avatar\`} />;
    ${SHEET(`  avatar: { borderRadius: 30 },`)}
  `;
  if (run(stringy).failures.length !== 0) selfFailures.push("string literal matched as a style key");

  // (l) <ImageBackground> is a different component and is out of scope → PASS.
  const imageBackground = `
    const el = <ImageBackground source={s} style={styles.avatar} />;
    ${SHEET(`  avatar: { borderRadius: 30, shadowOpacity: 0.26 },`)}
  `;
  if (run(imageBackground).failures.length !== 0) selfFailures.push("<ImageBackground> wrongly matched as <Image>");

  // (m) An <Image> with no style at all resolves nothing and must not count
  //     toward the census — otherwise C-3 could be satisfied by a blind parser.
  const noStyle = `const el = <Image source={s} />;`;
  if (run(noStyle).resolvedImages !== 0) selfFailures.push("census counted an Image with no resolvable style");

  if (selfFailures.length > 0) {
    console.error("#2539 I-PROPOSED-2539-RNW-IMAGE-NO-FILTER-UNDER-ROUND-CLIP self-test FAIL:");
    selfFailures.forEach((s) => console.error("  - " + s));
    process.exit(1);
  }
  console.log(
    "#2539 I-PROPOSED-2539-RNW-IMAGE-NO-FILTER-UNDER-ROUND-CLIP self-test PASS (13/13 cases: " +
      "fixed-shape, T-7 revert, 4-prop original, direct, inline, C-2 prop route, T-8 unrounded, " +
      "rounded-unfiltered, T-9 comments, vacuity, strings, ImageBackground, census).",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Plain mode
// ---------------------------------------------------------------------------

const files = [];
for (const root of SCAN_ROOTS) walk(path.join(repoRoot, root), files);
files.sort();

const failures = [];
let censusResolved = 0;
let censusSeen = false;
for (const full of files) {
  const rel = path.relative(repoRoot, full);
  const { resolvedImages } = checkSource(fs.readFileSync(full, "utf8"), rel, failures);
  if (rel === CENSUS_FILE) {
    censusSeen = true;
    censusResolved = resolvedImages;
  }
}

// C-3 — census. Checked BEFORE reporting a clean run, because "zero violations"
// from a parser that resolved zero elements is the failure mode this gate exists
// to avoid producing itself.
if (!censusSeen) {
  failures.push(
    `${CENSUS_FILE}: census target not found in the sweep — the #2539 gate would be ` +
      `scanning nothing. Re-point CENSUS_FILE at the moved/renamed component.`,
  );
} else if (censusResolved < 1) {
  failures.push(
    `${CENSUS_FILE}: the gate resolved ${censusResolved} <Image> elements here, expected ` +
      `at least 1. The parser has gone blind (a style-prop rename, a new indirection, or a ` +
      `refactor of the Avatar component) and would pass vacuously on the very defect it guards.`,
  );
}

if (failures.length > 0) {
  console.error("FAIL: #2539 rnw-image-filter-clip");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `OK: #2539 rnw-image-filter-clip — ${files.length} .tsx files swept across ` +
    `${SCAN_ROOTS.join(" + ")}; no <Image> resolves a filter-producing prop together with a ` +
    `borderRadius (census: ${censusResolved} resolved <Image> in ${CENSUS_FILE}).`,
);
