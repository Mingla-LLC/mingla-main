/**
 * #4304 — Brand group, Home's Ari orb, the first-run gate and the scanner
 * manager stay off the business-web boot chunk.
 *
 * WHY. Expo's web build gives every route file its own lazy chunk and hoists
 * any module that two or more lazy chunks import statically into `__common`,
 * the chunk every visitor downloads before anything renders. #4304 grew it by
 * +35 KB (limit +1,024 B, bundle-baseline-movement): the inbox list, tiles,
 * thread model and chat tokens were imported by both Messages routes, Home
 * required AriOrb (also in Ari's chunk), Help & Support imported the
 * first-run gate (also in the tabs layout), and /rsvp/[id]/scanners
 * re-exported the event scanner route.
 *
 * WHAT THIS PINS:
 *   - /messages loads its inbox screen with import() of the thread route's own
 *     module (one chunk), and imports no Brand-group module statically;
 *   - only the thread route imports BrandGroupInboxScreen statically;
 *   - Home's orb never loads AriOrb or reanimated;
 *   - Help & Support reads the reduced nav from the store, not the gate;
 *   - /rsvp/[id]/scanners loads the event route's module with import().
 *
 * FAILS ON REVERT: restore any static import above and the matching test fails.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "@jest/globals";

const ROOT = process.cwd();
const source = (relativePath: string): string => readFileSync(join(ROOT, relativePath), "utf8");

/** Runtime import / re-export / require specifiers. Type-only imports and import() do not count. */
const staticSpecifiers = (code: string): string[] => {
  const found: string[] = [];
  const fromPattern = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']/gms;
  const requirePattern = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [fromPattern, requirePattern]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) found.push(match[1]);
  }
  return found;
};

const importsStatically = (code: string, moduleName: string): boolean =>
  staticSpecifiers(code).some((specifier) => specifier.endsWith(`/${moduleName}`) || specifier === `./${moduleName}`);

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const full = join(ROOT, dir, name);
    const rel = relative(ROOT, full);
    if (name === "__tests__" || name === "node_modules") return [];
    if (statSync(full).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });

describe("#4304 — /messages shares the thread route's lazy chunk", () => {
  const index = source("app/messages/index.tsx");
  const thread = source("app/messages/[conversationId].tsx");

  test.each([
    "BrandGroupInboxScreen",
    "BrandGroupInboxList",
    "BrandGroupTile",
    "brandGroupThreadModel",
    "brandGroupChatTokens",
  ])("app/messages/index.tsx does not import %s statically", (moduleName) => {
    expect(importsStatically(index, moduleName)).toBe(false);
  });

  test("the index loads the inbox from the thread route's module with import()", () => {
    expect(index).toContain('(await import("./[conversationId]")).BrandGroupInboxScreen');
    expect(thread).toContain(
      'export { BrandGroupInboxScreen } from "../../src/components/messages/BrandGroupInboxScreen";',
    );
  });

  test("only the thread route imports BrandGroupInboxScreen statically", () => {
    const importers = [...sourceFiles("app"), ...sourceFiles("src")].filter((file) =>
      importsStatically(source(file), "BrandGroupInboxScreen"),
    );
    expect(importers).toEqual(["app/messages/[conversationId].tsx"]);
  });
});

describe("#4304 — Home's Ari orb stays out of Ari's chunk", () => {
  test("HomeAriOrb never loads AriOrb or reanimated", () => {
    const code = source("src/components/home/HomeAriOrb.tsx");
    expect(staticSpecifiers(code).filter((specifier) => /AriOrb|reanimated/.test(specifier))).toEqual([]);
    expect(code).not.toMatch(/import\(\s*["'][^"']*(AriOrb|reanimated)/);
  });
});

describe("#4304 — Help & Support does not load the first-run gate", () => {
  test("support.tsx reads the reduced nav from firstRunStore", () => {
    const code = source("app/account/support.tsx");
    expect(importsStatically(code, "useFirstRunStage")).toBe(false);
    expect(importsStatically(code, "firstRunState")).toBe(false);
    expect(code).toContain("useFirstRunStore((s) => s.lockedNavUserId)");
  });

  test("the tabs layout is the one publisher of the reduced nav", () => {
    const publishers = [...sourceFiles("app"), ...sourceFiles("src")].filter((file) =>
      source(file).includes("setLockedNavUserId("),
    );
    expect(publishers).toEqual(["app/(tabs)/_layout.tsx"]);
  });
});

describe("#4304 — /rsvp/[id]/scanners shares the event scanner route's chunk", () => {
  test("it loads the event route's module with import(), never a static re-export", () => {
    const code = source("app/rsvp/[id]/scanners/index.tsx");
    expect(staticSpecifiers(code).some((specifier) => specifier.includes("event/[id]/scanners"))).toBe(false);
    expect(code).toContain('await import("../../../event/[id]/scanners/index")');
  });
});
