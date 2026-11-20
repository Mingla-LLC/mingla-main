/**
 * #4420 P0 (2a5f48061d) — every thread crashed on load with
 * "ReferenceError: Cannot access 'openRailTab' before initialization":
 * openMedia's useCallback dependency array named openRailTab, a const
 * declared further down the component. Dependency arrays (and anything else
 * outside a closure) run during render, so a const read before its line is a
 * temporal-dead-zone crash on web, iOS and Android.
 *
 * This guard parses the Messages screens with the TypeScript compiler and,
 * for every function in the file, fails when a `const`/`let` declared at the
 * function's top level is read before its declaration by code that runs
 * during the call (hook dependency arrays, render expressions, initialisers).
 * Reads inside nested functions (callbacks, handlers) are deferred and fine.
 *
 * FAILS ON REVERT: put openMedia back above openRailTab and this fails (the
 * fixture test below proves the detector catches exactly that shape).
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const FILES = [
  "app/messages/[conversationId].tsx",
  "src/components/groupChat/GroupChatPanel.tsx",
  "src/components/messages/BrandGroupInboxScreen.tsx",
  "src/components/messages/BrandGroupInboxList.tsx",
];

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

/** "name read before its declaration" findings for one source text. */
export function renderOrderViolations(code: string, fileName = "file.tsx"): string[] {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];

  const checkFunction = (fn: ts.FunctionLikeDeclaration): void => {
    const body = fn.body;
    if (!body || !ts.isBlock(body)) return;
    // Block-scoped names declared directly in this function's body.
    const declaredAt = new Map<string, number>();
    for (const statement of body.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      if (!(statement.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) continue;
      for (const declaration of statement.declarationList.declarations) {
        const names: string[] = [];
        const collect = (name: ts.BindingName): void => {
          if (ts.isIdentifier(name)) names.push(name.text);
          else for (const element of name.elements) if (!ts.isOmittedExpression(element)) collect(element.name);
        };
        collect(declaration.name);
        for (const name of names) declaredAt.set(name, declaration.getStart(sourceFile));
      }
    }
    // Reads that run during the call: everything not inside a nested function.
    const visit = (node: ts.Node): void => {
      if (node !== fn && isFunctionLike(node)) return;
      // Types are erased; they read nothing at run time.
      if (ts.isTypeNode(node)) return;
      if (ts.isIdentifier(node) && declaredAt.has(node.text)) {
        const parent = node.parent;
        const isDeclarationName = ts.isVariableDeclaration(parent) && parent.name === node;
        const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || (ts.isPropertyAssignment(parent) && parent.name === node)
          || (ts.isBindingElement(parent) && parent.propertyName === node)
          || ts.isPropertySignature(parent)
          || ts.isJsxAttribute(parent);
        const declared = declaredAt.get(node.text) ?? 0;
        if (!isDeclarationName && !isPropertyName && node.getStart(sourceFile) < declared) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          found.push(`${fileName}:${line + 1} reads '${node.text}' before its declaration`);
        }
      }
      ts.forEachChild(node, visit);
    };
    for (const statement of body.statements) visit(statement);
  };

  const walk = (node: ts.Node): void => {
    if (isFunctionLike(node)) checkFunction(node);
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return found;
}

describe("#4420 Messages screens never read a const before its declaration during render", () => {
  test.each(FILES)("%s", (file) => {
    const code = readFileSync(join(process.cwd(), file), "utf8");
    expect(renderOrderViolations(code, file)).toEqual([]);
  });

  test("the detector catches the 2a5f48061d shape (dependency array names a later const)", () => {
    const broken = `
      function Screen() {
        const openMedia = useCallback(() => { openRailTab("media"); }, [openRailTab]);
        const openRailTab = useCallback((tab) => setTab(tab), []);
        return null;
      }`;
    expect(renderOrderViolations(broken)).toEqual(["file.tsx:3 reads 'openRailTab' before its declaration"]);
  });

  test("type members and renamed destructuring keys are not reads", () => {
    const fine = `
      function Screen() {
        const params = useParams<{ side?: string }>();
        const { refresh: refreshGroups } = useGroups();
        const side = params.side;
        const refresh = refreshGroups;
        return [side, refresh];
      }`;
    expect(renderOrderViolations(fine)).toEqual([]);
  });

  test("a read inside a callback body alone is deferred and allowed", () => {
    const fine = `
      function Screen() {
        const later = () => early();
        const early = () => 1;
        return later;
      }`;
    expect(renderOrderViolations(fine)).toEqual([]);
  });
});
