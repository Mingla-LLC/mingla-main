/**
 * @mingla/card-identity ISOLATION guard — I-MOR-0827-PACKAGE-ISOLATION.
 *
 * Proves the package is RN-free and dependency-free, which is the property that
 * lets `@mingla/offering-rendering` (react-native-web) and `mingla-business/server`
 * (Node + satori, CommonJS) consume it at all. A single real
 * `import ... from 'react-native'` would take the OG renderer down at require
 * time, in production, on a surface nobody runs locally.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE REPLACED AN INLINE `node -e` SUBSTRING SCAN
 *
 * The previous form of this guard lived inline in
 * `.github/workflows/issue-1609-card-identity.yml` and did:
 *
 *     for (const bad of ['react-native', 'expo-', ..., 'StyleSheet', 'jsx'])
 *       if (rawFileText.includes(bad)) fail();
 *
 * against the RAW text of index.js. It went red on a file that is completely
 * clean, because index.js's own header COMMENTS explain the constraint:
 *
 *     line 15  "S6 renders from `@mingla/offering-rendering` on react-native-web"
 *     line 20  "dependency-free**: plain data and pure functions. No JSX, no react-native"
 *     line 234 "expo-blur's dark tint lays its OWN darkening over the backdrop"
 *
 * index.d.ts carries the same hazard ("`expo-linear-gradient` types `colors` as
 * ..."), and package.json legitimately declares a `"react-native": "index.js"`
 * bundler entry field — none of which is a dependency.
 *
 * This is the #1607 defect class — a guard whose assertion does not match its
 * claim — inverted: #1607's guards were SATISFIED by prose, this one was TRIPPED
 * by it. Both directions are the same bug, and the trip direction is the more
 * corrosive one: a guard that a comment can turn red is a guard people weaken or
 * delete rather than fix. The cheapest way to make this workflow green was to
 * reword the very comments that document why the constraint exists.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ASSERTS INSTEAD
 *
 * The claim is about the MODULE GRAPH, so the assertions are about the module
 * graph, not about the bytes of a file:
 *
 *   I-0  the strippers are proven on fixtures — prose is erased, code is kept.
 *        Without this, every scan below could pass vacuously.
 *   I-1  every module specifier is extracted from comment-stripped source (string
 *        literals PRESERVED, because a specifier IS a string literal) and the set
 *        of external ones must be empty. This subsumes the whole old token list
 *        and also catches `lodash`, `react-native-reanimated`, `@expo/vector-icons`
 *        and everything else nobody thought to blocklist.
 *   I-2  RN runtime identifiers and JSX syntax are scanned on comment-AND-string
 *        stripped source, so neither a comment nor a string can trip OR satisfy it.
 *   I-3  the package is actually REQUIRED under a `Module._load` hook and must
 *        pull in zero external modules. This is the real graph, executed.
 *   I-4  package.json declares no dependency fields.
 *   I-5  the documented exports exist and are callable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Module, { createRequire, builtinModules } from 'node:module';

const require_ = createRequire(import.meta.url);

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
const PKG_ENTRY = fileURLToPath(new URL('../index.js', import.meta.url));
const PKG_TYPES = fileURLToPath(new URL('../index.d.ts', import.meta.url));
const PKG_JSON = fileURLToPath(new URL('../package.json', import.meta.url));

const SCANNED = {
  'index.js': PKG_ENTRY,
  'index.d.ts': PKG_TYPES,
};

// ---------------------------------------------------------------------------
// Stripping — copied in discipline from the sibling #1609 / #1593 guards, all of
// which already strip. This step was the only one on the branch that did not.
// ---------------------------------------------------------------------------

/**
 * Remove `//` and block comments. String literals are PRESERVED, because module
 * specifiers are string literals and I-1 hunts exactly those.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i += 2; continue; }
      if (c === '\n') out += c;
      i += 1;
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && n === '/') { inLine = true; i += 2; continue; }
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue; }
    out += c;
    i += 1;
  }
  return out;
}

/** Remove comments AND the CONTENTS of string literals, leaving empty quotes. */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += quote;
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      out += quote;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Module-specifier extraction.
// ---------------------------------------------------------------------------

const SPECIFIER_PATTERNS = [
  /\brequire\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g,
  /\brequire\s*\.\s*resolve\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g,
  /\bimport\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g,
  /\bfrom\s*(['"`])([^'"`]*)\1/g,
  /\bimport\s+(['"`])([^'"`]*)\1/g,
];

/** Every module specifier mentioned in `code`, deduped. */
function moduleSpecifiers(code) {
  const found = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let m = pattern.exec(code);
    while (m !== null) {
      found.add(m[2]);
      m = pattern.exec(code);
    }
  }
  return [...found];
}

const BUILTINS = new Set(builtinModules);

/** A specifier that needs `node_modules` to resolve — i.e. a real dependency. */
function isExternal(spec) {
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) return false;
  if (spec.startsWith('node:')) return false;
  if (BUILTINS.has(spec)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// I-0 — the strippers and the extractor are proven BEFORE anything relies on them.
// ---------------------------------------------------------------------------

const PROSE_FIXTURE = [
  "// prose mentioning require('react-native') and expo-blur and StyleSheet",
  '/* block prose: import StyleSheet from "react-native"; and <View/> */',
  'const realCode = 42;',
].join('\n');

const CODE_FIXTURE = [
  "const RN = require('react-native');",
  'import blur from "expo-blur";',
  "import('./sibling.js');",
  "export { thing } from '@scope/pkg';",
  "import 'side-effect-pkg';",
  "const r = require.resolve('resolved-pkg');",
  "const builtin = require('node:fs');",
].join('\n');

test('I-0a stripComments erases prose but keeps code', () => {
  const stripped = stripComments(PROSE_FIXTURE);
  for (const token of ['react-native', 'expo-blur', 'StyleSheet', '<View']) {
    assert.equal(
      stripped.includes(token),
      false,
      `I-0a: stripComments left "${token}" behind — a comment can still trip every scan below, `
      + 'which is the exact defect this file exists to remove.',
    );
  }
  assert.ok(
    stripped.includes('const realCode = 42;'),
    'I-0a: stripComments ate real code — every scan below would then pass vacuously.',
  );
});

test('I-0b stripComments PRESERVES real code, so the guard still catches a real import', () => {
  // The other half of the discrimination proof. A stripper that erased
  // everything would make I-1 pass on a package that imports react-native.
  const stripped = stripComments(CODE_FIXTURE);
  assert.ok(
    stripped.includes('react-native'),
    'I-0b: stripComments removed a REAL require specifier — the guard can no longer fail.',
  );
  const specs = moduleSpecifiers(stripped);
  for (const expected of [
    'react-native',
    'expo-blur',
    './sibling.js',
    '@scope/pkg',
    'side-effect-pkg',
    'resolved-pkg',
    'node:fs',
  ]) {
    assert.ok(
      specs.includes(expected),
      `I-0b: the specifier extractor missed "${expected}" (found: ${specs.join(', ')}). `
      + 'An extractor that finds nothing makes I-1 vacuous.',
    );
  }
  const external = specs.filter(isExternal).sort();
  assert.deepEqual(
    external,
    ['@scope/pkg', 'expo-blur', 'react-native', 'resolved-pkg', 'side-effect-pkg'],
    'I-0b: isExternal() misclassifies — relative and node: specifiers are not dependencies, '
    + 'bare ones are.',
  );
});

test('I-0c stripCommentsAndStrings erases both prose and string contents', () => {
  const stripped = stripCommentsAndStrings(`${PROSE_FIXTURE}\nconst s = "react-native";`);
  assert.equal(
    stripped.includes('react-native'),
    false,
    'I-0c: stripCommentsAndStrings left a token that lives only in prose or a string literal.',
  );
  assert.ok(
    stripped.includes('const realCode = 42;'),
    'I-0c: stripCommentsAndStrings ate real code.',
  );
});

// ---------------------------------------------------------------------------
// I-1 — the static module graph.
// ---------------------------------------------------------------------------

test('I-1 the package imports nothing that needs node_modules', () => {
  let scanned = 0;
  for (const [name, absPath] of Object.entries(SCANNED)) {
    const raw = readFileSync(absPath, 'utf8');
    const code = stripComments(raw);

    // Anti-vacuity: the file was really read, and stripping really ran.
    assert.ok(
      raw.length > 500,
      `I-1: ${name} read as ${raw.length} chars — it was not really read.`,
    );
    assert.ok(
      code.length < raw.length,
      `I-1: stripping removed nothing from ${name}, so it is not actually stripping.`,
    );

    const external = moduleSpecifiers(code).filter(isExternal).sort();
    assert.deepEqual(
      external,
      [],
      `I-1: ${name} imports ${external.join(', ')}. @mingla/card-identity must be RN-free and `
      + 'dependency-free — it is consumed by @mingla/offering-rendering (react-native-web) and '
      + 'by mingla-business/server under Node + satori, and a single real react-native import '
      + 'would take the OG renderer down at require time in production '
      + '(I-MOR-0827-PACKAGE-ISOLATION).',
    );
    scanned += 1;
  }
  assert.equal(scanned, Object.keys(SCANNED).length, 'I-1: not every scanned file was visited');
});

// ---------------------------------------------------------------------------
// I-2 — RN runtime identifiers and JSX, on code only.
// ---------------------------------------------------------------------------

/**
 * These are RN APIs a file could reach for WITHOUT an import (via a global, a
 * re-export, or a lazy require), so the specifier scan alone would miss them.
 * Scanned with string contents removed as well, so neither prose nor a data
 * string can trip them.
 */
const FORBIDDEN_IDENTIFIERS = [
  'StyleSheet',
  'PixelRatio',
  'NativeModules',
  'requireNativeComponent',
  'useWindowDimensions',
  'TurboModuleRegistry',
];

test('I-2 the package uses no react-native runtime API and no JSX', () => {
  let scanned = 0;
  for (const [name, absPath] of Object.entries(SCANNED)) {
    const code = stripCommentsAndStrings(readFileSync(absPath, 'utf8'));
    assert.ok(code.length > 200, `I-2: ${name} stripped to ${code.length} chars — not read.`);

    for (const ident of FORBIDDEN_IDENTIFIERS) {
      assert.equal(
        code.includes(ident),
        false,
        `I-2: ${name} references the react-native API ${ident} — the package must be plain data `
        + 'and pure functions.',
      );
    }
    // A JSX element is `<Capitalised` followed by whitespace, `/` or `>`. Numeric
    // comparisons (`t <= 0`, `i < loc.length`) cannot match.
    const jsx = /<[A-Z][A-Za-z0-9_]*[\s/>]/.exec(code);
    assert.equal(
      jsx,
      null,
      `I-2: ${name} contains JSX (${jsx && jsx[0]}) — satori and the CI oracle load this file as `
      + 'plain CommonJS with no transform.',
    );
    scanned += 1;
  }
  assert.equal(scanned, Object.keys(SCANNED).length, 'I-2: not every scanned file was visited');
});

// ---------------------------------------------------------------------------
// I-3 — the EXECUTED module graph. Not text at all.
// ---------------------------------------------------------------------------

test('I-3 requiring the package under a bare Node pulls in zero external modules', () => {
  const requested = [];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...rest) {
    requested.push(request);
    return originalLoad.call(this, request, ...rest);
  };

  let CI;
  try {
    delete require_.cache[PKG_ENTRY];
    CI = require_(PKG_ENTRY);
  } finally {
    Module._load = originalLoad;
  }

  // Anti-vacuity: if the hook never fired, an empty `requested` would prove
  // nothing at all.
  assert.ok(
    requested.includes(PKG_ENTRY),
    `I-3: the Module._load hook never observed the package load (saw: ${requested.join(', ')}), `
    + 'so an empty dependency list would be meaningless.',
  );

  const external = requested.filter(isExternal).sort();
  assert.deepEqual(
    external,
    [],
    `I-3: loading @mingla/card-identity pulled in ${external.join(', ')}. It must load under a `
    + 'bare Node with no install, which is what the satori/OG path does.',
  );

  const loaded = require_.cache[PKG_ENTRY];
  assert.ok(loaded, 'I-3: the package is not in the require cache after being required.');
  assert.deepEqual(
    loaded.children.map((c) => c.filename),
    [],
    'I-3: the package module has children — it is no longer self-contained.',
  );
  assert.ok(
    loaded.filename.startsWith(PKG_DIR),
    'I-3: the resolved entry is outside the package directory.',
  );
  assert.equal(typeof CI, 'object', 'I-3: the package did not export an object.');
});

// ---------------------------------------------------------------------------
// I-4 / I-5 — the manifest and the export surface.
// ---------------------------------------------------------------------------

test('I-4 package.json declares no dependencies of any kind', () => {
  const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'));
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    const declared = pkg[field] ? Object.keys(pkg[field]) : [];
    assert.deepEqual(
      declared,
      [],
      `I-4: card-identity declares ${field} (${declared.join(', ')}); it must have none.`,
    );
  }
  // Anti-vacuity: prove we parsed the right manifest. Note that `react-native`
  // is a legitimate KEY here — it is the RN bundler's entry-point field, not a
  // dependency, and a scan of this file's raw TEXT for "react-native" would
  // wrongly condemn it. That is the same defect this file removed.
  assert.equal(pkg.name, '@mingla/card-identity', 'I-4: parsed the wrong package.json.');
  assert.equal(pkg['react-native'], 'index.js', 'I-4: the RN entry field moved.');
});

test('I-5 the documented export surface exists and is callable', () => {
  const CI = require_(PKG_ENTRY);
  for (const fn of ['scrimHeight', 'plateUnderAlpha', 'rampAlphaAtDepth', 'plateRows', 'typeLadder']) {
    assert.equal(typeof CI[fn], 'function', `I-5: card-identity does not export ${fn}.`);
  }
  // Callable, not merely present — a stub would satisfy `typeof === 'function'`.
  assert.equal(typeof CI.scrimHeight(112, 0, 783), 'number', 'I-5: scrimHeight returned no number.');
  assert.equal(typeof CI.plateUnderAlpha(0.42), 'number', 'I-5: plateUnderAlpha returned no number.');
});
