/**
 * #1758 [netinfo-ota-guard] — structural sole-owner guard (direction (b) of
 * the fix contract): this suite FAILS if a bare static import — or any other
 * value-level reach (require / dynamic import) — of
 * `@react-native-community/netinfo` returns anywhere in mingla-business
 * outside `src/lib/netinfoSafe.ts`.
 *
 * WHY A JEST STRUCTURAL TEST AND NOT A NEW STRICT-GREP GATE: a new gate costs
 * the full MANIFEST dance (script + entry + selfTestWiredFloor equality bump +
 * expectedStrictGrepMjsFiles bump) — disproportionate for a one-package rule —
 * while this suite is equally CI-binding: the full mingla-business jest suite
 * has been a required PR gate since #1062 (mingla-business-jest-suite.yml,
 * enforced by I-PROPOSED-1047-BIZ-JEST-WIRED).
 *
 * WHY THE RULE EXISTS: the package throws "NativeModule.RNCNetInfo is null"
 * at MODULE EVAL when the native module is absent. Every shipped business
 * binary predates the dependency (#1719, 2026-08-09; last native builds
 * 2026-07-14 / 2026-07-20), so a module-scope reach bricks startup on every
 * OTA install (COMMS-0138). All access goes through the guarded accessor in
 * `src/lib/netinfoSafe.ts`. `import type` is erased at compile time and is
 * allowed anywhere.
 *
 * Vacuity guards (the #1047 "unfalsifiable test" lesson): the matchers are
 * proven live against fixtures AND against netinfoSafe's own require, and the
 * walk is proven to see a real corpus via a file-count floor.
 */

import fs from 'fs';
import path from 'path';

const APP_ROOT = path.resolve(__dirname, '..'); // mingla-business/
const SCAN_ROOTS = ['src', 'app'];
const SOLE_OWNER = 'src/lib/netinfoSafe.ts';

// Value-level static import (default / named / namespace / side-effect) of the
// package. `(?!type\b)` skips erased `import type`; `[^(;]` cannot cross a `(`
// so dynamic `import(` never matches; the class includes `\n` so multiline
// import statements are still caught.
const STATIC_IMPORT =
  /(?:^|\n)\s*import\s+(?!type\b)[^(;]*?\sfrom\s*["']@react-native-community\/netinfo["']|(?:^|\n)\s*import\s*["']@react-native-community\/netinfo["']/;
// CommonJS reach — only netinfoSafe.ts may do this (inside try/catch).
const REQUIRE_CALL = /require\(\s*["']@react-native-community\/netinfo["']\s*\)/;
// Dynamic import reach — also catches `typeof import("...")` type queries;
// stricter than needed, and fine: nothing outside netinfoSafe needs either.
const DYNAMIC_IMPORT = /import\s*\(\s*["']@react-native-community\/netinfo["']\s*\)/;

const isTestFile = (rel: string): boolean =>
  /(^|\/)__tests__\//.test(rel) || /\.(test|spec)\.[tj]sx?$/.test(rel);

const collectSourceFiles = (): string[] => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      files.push(path.relative(APP_ROOT, abs).split(path.sep).join('/'));
    }
  };
  for (const root of SCAN_ROOTS) {
    const abs = path.join(APP_ROOT, root);
    if (fs.existsSync(abs)) walk(abs);
  }
  return files;
};

describe('#1758 netinfo sole-owner guard', () => {
  const files = collectSourceFiles();

  it('matcher self-check: catches every value-level reach fixture, allows the erased/type-only forms (vacuity guard)', () => {
    const flagged = (src: string): boolean =>
      STATIC_IMPORT.test(src) || REQUIRE_CALL.test(src) || DYNAMIC_IMPORT.test(src);
    // Forbidden forms — every one must be caught:
    expect(flagged("import NetInfo from '@react-native-community/netinfo';")).toBe(true);
    expect(flagged("import { useNetInfo } from '@react-native-community/netinfo';")).toBe(true);
    expect(flagged('import {\n  useNetInfo,\n} from "@react-native-community/netinfo";')).toBe(true);
    expect(flagged("import * as NetInfo from '@react-native-community/netinfo';")).toBe(true);
    expect(flagged("import '@react-native-community/netinfo';")).toBe(true);
    expect(flagged("const mod = require('@react-native-community/netinfo');")).toBe(true);
    expect(flagged("const mod = await import('@react-native-community/netinfo');")).toBe(true);
    // Allowed forms — erased at compile time or a different package entirely:
    expect(flagged("import type { NetInfoState } from '@react-native-community/netinfo';")).toBe(false);
    expect(flagged("import { useNetInfo } from 'some-other-package';")).toBe(false);
    expect(flagged("// mentions @react-native-community/netinfo in prose only")).toBe(false);
  });

  it('the walk sees the real corpus (floor guard: a broken walk cannot go green)', () => {
    expect(files.length).toBeGreaterThan(800);
    expect(files).toContain(SOLE_OWNER);
    expect(files).toContain('src/components/ui/useShareNetworkState.native.ts');
  });

  it('netinfoSafe.ts exists, reaches the package ONLY via guarded require, and the matcher sees that reach (liveness)', () => {
    const src = fs.readFileSync(path.join(APP_ROOT, SOLE_OWNER), 'utf8');
    expect(REQUIRE_CALL.test(src)).toBe(true); // matcher proven live on real code
    expect(STATIC_IMPORT.test(src)).toBe(false); // even the sole owner may not static-import
  });

  it('NO file outside src/lib/netinfoSafe.ts imports/requires @react-native-community/netinfo (a bare static import bricks startup on OTA — #1758 / COMMS-0138)', () => {
    const violations: string[] = [];
    for (const rel of files) {
      if (rel === SOLE_OWNER) continue;
      if (isTestFile(rel)) continue; // tests mock the specifier; jest.mock is not a runtime reach
      const src = fs.readFileSync(path.join(APP_ROOT, rel), 'utf8');
      if (STATIC_IMPORT.test(src) || REQUIRE_CALL.test(src) || DYNAMIC_IMPORT.test(src)) {
        violations.push(rel);
      }
    }
    expect(violations).toEqual([]);
  });
});
