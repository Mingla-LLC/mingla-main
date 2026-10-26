/**
 * #4111 — Customer enquiries stay off the business-web boot payload.
 *
 * WHY. TopBar and Home's To-do run on every business-web visit, so whatever
 * they import is in `__common`, the chunk every visitor downloads before
 * anything renders. When they imported brandEnquiryDisplay / the full
 * brandEnquiriesService, and the Messages routes imported the list and thread
 * screens statically, `__common` grew +19,985 B against a 12,000 B per-PR
 * allowance. Metro hoists a module out of the lazy routes only when EVERY
 * eager importer stops importing it, so one stray import puts it all back.
 *
 * WHAT THIS PINS:
 *   - the boot-path files import only the two small modules
 *     (brandEnquiryWaiting.ts, brandEnquiryList.ts);
 *   - those two modules import no display or service code at runtime;
 *   - both Messages routes load the screens with import(), from one module;
 *   - the old modules still re-export what moved, so callers keep working.
 *
 * FAILS ON REVERT: point TopBar or useBusinessTodos back at
 * brandEnquiryDisplay, point useBrandEnquiries back at brandEnquiriesService,
 * or import BrandEnquiryListSection / BrandEnquiryThreadScreen statically in a
 * route, and the matching test fails.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

/** Runtime import specifiers (type-only imports are erased and do not count). */
const runtimeImports = (code: string): string[] => {
  const found: string[] = [];
  const pattern = /^\s*(import|export)\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']/gms;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) found.push(match[2]);
  return found;
};

const staticImportsOf = (code: string, name: string): boolean =>
  runtimeImports(code).some((specifier) => specifier.endsWith(`/${name}`));

const HEAVY = [
  "brandEnquiryDisplay",
  "brandEnquiriesService",
  "BrandEnquiryListSection",
  "BrandEnquiryThreadScreen",
  "BrandEnquiryScreens",
];

describe("#4111 boot payload — the eager importers", () => {
  test.each([
    ["src/components/ui/TopBar.tsx"],
    ["src/hooks/useBusinessTodos.ts"],
    ["src/hooks/useBrandEnquiries.ts"],
  ])("%s imports no enquiry display, service or screen code", (file) => {
    const code = source(file);
    for (const heavy of HEAVY) expect(staticImportsOf(code, heavy)).toBe(false);
  });

  test("TopBar and Home read the badge and To-do rules from the small module", () => {
    expect(source("src/components/ui/TopBar.tsx")).toContain(
      'import { messagesBadgeCount } from "../../utils/brandEnquiryWaiting";',
    );
    expect(source("src/hooks/useBusinessTodos.ts")).toContain(
      'import { brandEnquiryTodos } from "../utils/brandEnquiryWaiting";',
    );
    expect(source("src/hooks/useBrandEnquiries.ts")).toContain(
      'import { listBrandEnquiries } from "../services/brandEnquiryList";',
    );
  });

  test.each([
    ["src/utils/brandEnquiryWaiting.ts", []],
    ["src/services/brandEnquiryList.ts", ["./supabase"]],
  ])("%s has no runtime imports beyond %j", (file, allowed) => {
    expect(runtimeImports(source(file))).toEqual(allowed);
  });
});

describe("#4111 boot payload — the Messages routes load the screens lazily", () => {
  test.each([
    ["app/messages/index.tsx", "BrandEnquiryListSection"],
    ["app/messages/enquiry/[enquiryId].tsx", "BrandEnquiryThreadScreen"],
  ])("%s loads %s with import() from the one shared module", (file, screen) => {
    const code = source(file);
    for (const heavy of HEAVY) expect(staticImportsOf(code, heavy)).toBe(false);
    expect(code).toContain('await import("');
    expect(code).toContain('components/messages/BrandEnquiryScreens")).' + screen);
    expect(code).toContain("React.Suspense");
  });

  test("the Brand-group route uses only the small modules", () => {
    const code = source("app/messages/[conversationId].tsx");
    for (const heavy of HEAVY) expect(staticImportsOf(code, heavy)).toBe(false);
  });

  test("the shared lazy module exports both screens", () => {
    const code = source("src/components/messages/BrandEnquiryScreens.ts");
    expect(code).toContain('export { BrandEnquiryListSection } from "./BrandEnquiryListSection";');
    expect(code).toContain('export { BrandEnquiryThreadScreen } from "./BrandEnquiryThreadScreen";');
  });
});

describe("#4111 boot payload — what moved is still reachable from the old modules", () => {
  test("brandEnquiryDisplay re-exports the badge and To-do rules", () => {
    const display = require("../brandEnquiryDisplay") as Record<string, unknown>;
    const waiting = require("../brandEnquiryWaiting") as Record<string, unknown>;
    for (const name of [
      "brandEnquiryAge",
      "brandEnquiryNeedsReply",
      "brandEnquiryThreadRoute",
      "brandEnquiryTodos",
      "messagesBadgeCount",
    ]) {
      expect(typeof waiting[name]).toBe("function");
      expect(display[name]).toBe(waiting[name]);
    }
  });

  test("brandEnquiriesService re-exports the list read and the lookup", () => {
    const code = source("src/services/brandEnquiriesService.ts");
    for (const name of [
      "brandEnquiryErrorMessage",
      "findBrandEnquiryIdForConversation",
      "listBrandEnquiries",
      "normalizeBrandEnquiryList",
    ]) {
      expect(code).toContain(`  ${name},`);
    }
    expect(code).toContain('} from "./brandEnquiryList";');
  });
});
