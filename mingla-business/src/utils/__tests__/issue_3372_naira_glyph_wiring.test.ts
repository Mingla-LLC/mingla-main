/**
 * issue #3372 — every trip, experience and RSVP money display sends its price
 * through #3341's ONE shared glyph rule, so naira reads "₦25,000", never
 * "NGN 25,000".
 *
 * #3359 wired the rule (packages/offering-rendering/currencyGlyph.ts) into the
 * event page and the Business money util. Trips, experiences, RSVP chip-ins and
 * the Explorer app's cart, trip card and trip screen format money with their own
 * inline `Intl.NumberFormat` calls, so they kept printing the ISO code.
 *
 * Many of those formatters live inside route and screen files that can't be
 * mounted in this jest project (and app-mobile has no lane that runs its jest
 * suites by folder), so this guard reads the source with the TypeScript parser —
 * comments are not code, so a comment can never satisfy it. It fails when:
 *   - a listed file disappears, or no longer formats money with Intl at all
 *     (the list would silently check nothing);
 *   - any `new Intl.NumberFormat(…, { style: "currency" })` in a listed file, or
 *     anywhere under the trip / experience / RSVP / shared-offering folders, is
 *     not wrapped as `withCurrencyGlyph(new Intl.NumberFormat(…).format(…), code)`;
 *   - the file doesn't import `withCurrencyGlyph` from the shared module, defines
 *     its own copy, or hardcodes the "₦" glyph.
 *
 * The rendered behaviour is proven separately in
 * src/components/trip/__tests__/issue_3372_naira_trip_experience_rsvp.test.tsx.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "@jest/globals";

// The repo intentionally reads the compiler API through require (see
// issue3187CanonicalShareUrl.implementor.test.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require("typescript") as typeof import("typescript");

const REPO = join(__dirname, "..", "..", "..", "..");
const SHARED_SPECIFIER = "@mingla/offering-rendering/currencyGlyph";
const PACKAGE_DIR = "packages/offering-rendering/";

/** Every money formatter #3372 routes through the shared rule, by file. */
const WIRED_FILES: readonly string[] = [
  // Shared offering package — public trip / experience / RSVP pages on buyer
  // web, the Business app and the Explorer app.
  "packages/offering-rendering/useTripOfferingState.ts",
  "packages/offering-rendering/TripPaymentChoice.tsx",
  "packages/offering-rendering/ExperienceOfferingBody.tsx",
  "packages/offering-rendering/RsvpChipInPanel.tsx",
  "packages/offering-rendering/RsvpOfferingBody.tsx",
  // Legacy event page: still renders a password-protected event's tickets once
  // the password is entered (#3359 missed it).
  "packages/offering-rendering/PublicEventPage.tsx",
  // Business app — public pages and host screens.
  "mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx",
  "mingla-business/app/experience/[id]/index.tsx",
  "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
  "mingla-business/app/trip/[id]/index.tsx",
  "mingla-business/app/trip/[id]/money/index.tsx",
  "mingla-business/app/trip/[id]/travelers/index.tsx",
  "mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx",
  "mingla-business/src/components/experience/ExperiencePreview.tsx",
  "mingla-business/src/components/offering/ExperienceStopsGalleryTile.tsx",
  "mingla-business/src/components/rsvp/RsvpStep5Setup.tsx",
  "mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx",
  "mingla-business/src/components/trip/PaymentPlanEditor.tsx",
  "mingla-business/src/components/trip/RefundPreviewBody.tsx",
  "mingla-business/src/components/trip/RefundPreviewSheet.tsx",
  "mingla-business/src/components/trip/TripCheckoutFlow.tsx",
  "mingla-business/src/components/trip/TripCreatorStep6Intake.tsx",
  "mingla-business/src/components/trip/TripPreview.tsx",
  "mingla-business/src/components/event/ChangeSummaryModal.tsx",
  // Explorer app.
  "app-mobile/src/components/expandedCard/TicketCartSheet.tsx",
  "app-mobile/src/components/discover/TripCard.tsx",
  "app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx",
];

/** The experience creator's price-field symbol has no Intl call of its own. */
const EXPERIENCE_WIZARD =
  "mingla-business/src/components/experience/ExperienceCreatorWizard.tsx";

/** Folders where every Intl currency formatter must use the rule (non-test files). */
const SWEPT_DIRS: readonly string[] = [
  "packages/offering-rendering",
  "mingla-business/app/exp",
  "mingla-business/app/experience",
  "mingla-business/app/t",
  "mingla-business/app/trip",
  "mingla-business/app/checkout-trip",
  "mingla-business/app/checkout-experience",
  "mingla-business/src/components/experience",
  "mingla-business/src/components/trip",
  "mingla-business/src/components/rsvp",
  "app-mobile/src/screens/Trip",
  "app-mobile/src/screens/Experience",
];

const parse = (rel: string): import("typescript").SourceFile => {
  const text = readFileSync(join(REPO, rel), "utf8");
  return ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
};

const walk = (
  node: import("typescript").Node,
  visit: (n: import("typescript").Node) => void,
): void => {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
};

const isIntlNumberFormat = (node: import("typescript").Node): boolean =>
  ts.isNewExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "Intl" &&
  node.expression.name.text === "NumberFormat";

/** `{ style: "currency", … }` passed as the options argument. */
const hasCurrencyStyle = (node: import("typescript").NewExpression): boolean =>
  (node.arguments ?? []).some(
    (arg) =>
      ts.isObjectLiteralExpression(arg) &&
      arg.properties.some(
        (prop) =>
          ts.isPropertyAssignment(prop) &&
          prop.name.getText() === "style" &&
          ts.isStringLiteralLike(prop.initializer) &&
          prop.initializer.text === "currency",
      ),
  );

const isGlyphCall = (node: import("typescript").Node | undefined): boolean =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === "withCurrencyGlyph";

/**
 * The only accepted shape: `withCurrencyGlyph(new Intl.NumberFormat(…).format(x), code)`
 * — the formatted string is the rule's first argument and a currency is passed.
 */
const isWrapped = (node: import("typescript").NewExpression): boolean => {
  let current: import("typescript").Node = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const access = current.parent;
  if (
    access === undefined ||
    !ts.isPropertyAccessExpression(access) ||
    access.name.text !== "format"
  ) {
    return false;
  }
  const formatCall = access.parent;
  if (formatCall === undefined || !ts.isCallExpression(formatCall)) return false;
  const glyphCall = formatCall.parent;
  return (
    isGlyphCall(glyphCall) &&
    ts.isCallExpression(glyphCall) &&
    glyphCall.arguments[0] === formatCall &&
    glyphCall.arguments.length === 2
  );
};

interface Formatter {
  line: number;
  wrapped: boolean;
}

const currencyFormatters = (sf: import("typescript").SourceFile): Formatter[] => {
  const out: Formatter[] = [];
  walk(sf, (node) => {
    if (isIntlNumberFormat(node) && hasCurrencyStyle(node as import("typescript").NewExpression)) {
      out.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        wrapped: isWrapped(node as import("typescript").NewExpression),
      });
    }
  });
  return out;
};

const importsSharedRule = (sf: import("typescript").SourceFile, rel: string): boolean => {
  const allowed = rel.startsWith(PACKAGE_DIR)
    ? new Set(["./currencyGlyph", SHARED_SPECIFIER])
    : new Set([SHARED_SPECIFIER]);
  return sf.statements.some(
    (stmt) =>
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      allowed.has(stmt.moduleSpecifier.text) &&
      stmt.importClause?.isTypeOnly !== true &&
      stmt.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(stmt.importClause.namedBindings) &&
      stmt.importClause.namedBindings.elements.some(
        (el) => el.name.text === "withCurrencyGlyph" && el.propertyName === undefined,
      ),
  );
};

/** A local function/const named withCurrencyGlyph would be a second copy of the rule. */
const definesOwnCopy = (sf: import("typescript").SourceFile): boolean => {
  let found = false;
  walk(sf, (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === "withCurrencyGlyph"
    ) {
      found = true;
    }
  });
  return found;
};

/** A hardcoded naira glyph in code (strings/templates) would bypass the one table. */
const hardcodesNaira = (sf: import("typescript").SourceFile): boolean => {
  let found = false;
  walk(sf, (node) => {
    if (
      (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      /₦|\\u20a6/i.test(node.getText(sf))
    ) {
      found = true;
    }
  });
  return found;
};

const listSourceFiles = (relDir: string): string[] => {
  const out: string[] = [];
  const visit = (abs: string): void => {
    for (const name of readdirSync(abs)) {
      if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
      const child = join(abs, name);
      if (statSync(child).isDirectory()) {
        visit(child);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
        out.push(relative(REPO, child));
      }
    }
  };
  visit(join(REPO, relDir));
  return out;
};

describe("#3372 every trip, experience and RSVP money formatter uses the shared naira rule", () => {
  test("the shared rule still exists and still maps NGN to ₦", () => {
    const rule = readFileSync(join(REPO, "packages/offering-rendering/currencyGlyph.ts"), "utf8");
    expect(rule).toMatch(/export const withCurrencyGlyph\b/);
    expect(rule).toMatch(/NGN:\s*"₦"/);
  });

  test.each(WIRED_FILES.map((rel) => [rel]))("%s", (rel) => {
    expect(existsSync(join(REPO, rel))).toBe(true);
    const sf = parse(rel);
    const formatters = currencyFormatters(sf);
    // A file that stops formatting currency must be taken off this list, not
    // silently pass with nothing checked.
    expect(formatters.length).toBeGreaterThan(0);
    expect(formatters.filter((f) => !f.wrapped).map((f) => `${rel}:${f.line}`)).toEqual([]);
    expect(importsSharedRule(sf, rel)).toBe(true);
    expect(definesOwnCopy(sf)).toBe(false);
    expect(hardcodesNaira(sf)).toBe(false);
  });

  test("the experience creator's price symbol goes through the rule", () => {
    expect(existsSync(join(REPO, EXPERIENCE_WIZARD))).toBe(true);
    const sf = parse(EXPERIENCE_WIZARD);
    expect(importsSharedRule(sf, EXPERIENCE_WIZARD)).toBe(true);
    expect(definesOwnCopy(sf)).toBe(false);
    expect(hardcodesNaira(sf)).toBe(false);

    let symbolHelper: import("typescript").Node | undefined;
    walk(sf, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "currencySymbolFor"
      ) {
        symbolHelper = node.initializer;
      }
    });
    expect(symbolHelper).toBeDefined();
    let callsRule = false;
    walk(symbolHelper as import("typescript").Node, (node) => {
      if (isGlyphCall(node)) callsRule = true;
    });
    expect(callsRule).toBe(true);
  });

  test("no trip, experience, RSVP or shared offering file formats currency without the rule", () => {
    const unwrapped: string[] = [];
    let scanned = 0;
    for (const dir of SWEPT_DIRS) {
      expect(existsSync(join(REPO, dir))).toBe(true);
      for (const rel of listSourceFiles(dir)) {
        const text = readFileSync(join(REPO, rel), "utf8");
        if (!text.includes("NumberFormat")) continue;
        for (const f of currencyFormatters(parse(rel))) {
          scanned += 1;
          if (!f.wrapped) unwrapped.push(`${rel}:${f.line}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(unwrapped).toEqual([]);
  });

  test("the guard really detects an unwrapped formatter (self-check)", () => {
    const sample = (code: string): Formatter[] =>
      currencyFormatters(
        ts.createSourceFile("sample.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
      );
    const bare = sample(
      `const f = (c: number, code: string) => new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(c);`,
    );
    expect(bare).toEqual([{ line: 1, wrapped: false }]);

    // A comment mentioning the rule does not count.
    const commented = sample(
      `// withCurrencyGlyph(\nconst f = (c: number, code: string) => new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(c);`,
    );
    expect(commented.every((f) => !f.wrapped)).toBe(true);

    // Wrapping something else, or dropping the code, does not count.
    const wrongArg = sample(
      `const f = (c: number, code: string) => withCurrencyGlyph(String(new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(c)), code);`,
    );
    expect(wrongArg.every((f) => !f.wrapped)).toBe(true);
    const noCode = sample(
      `const f = (c: number, code: string) => withCurrencyGlyph(new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(c));`,
    );
    expect(noCode.every((f) => !f.wrapped)).toBe(true);

    const wrapped = sample(
      `const f = (c: number, code: string) => withCurrencyGlyph(new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(c), code);`,
    );
    expect(wrapped).toEqual([{ line: 1, wrapped: true }]);

    // Non-currency number formatting is not a money formatter.
    expect(sample(`const n = new Intl.NumberFormat("en-GB").format(3);`)).toEqual([]);
  });
});
