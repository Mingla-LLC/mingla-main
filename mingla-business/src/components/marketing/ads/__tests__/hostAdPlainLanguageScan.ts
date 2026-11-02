/**
 * #4238 — finds Host-visible ad copy that uses Mingla's internal words.
 *
 * Test-support module (used by the plain-language regression test). It reads
 * TypeScript source and collects only text a Host can see: JSX text, string
 * and template literals that read like sentences (they contain a space), and
 * for Ari the messages its ad tools return. Identifiers, testIDs, import
 * paths, comments and error codes (no spaces) are never scanned.
 */

import ts from "typescript";

import { HOST_AD_BANNED_WORDS } from "../hostAdCopy";

export { HOST_AD_BANNED_WORDS };

const SKIP_ATTRIBUTES = new Set([
  "testID",
  "key",
  "style",
  "contentStyle",
  "nativeID",
  "accessibilityRole",
  "variant",
  "illustration",
  "leadingIcon",
  "mediaMode",
  "href",
]);

const ARI_MESSAGE_PROPERTIES = new Set([
  "next_step",
  "message",
  "note",
  "notice",
  "summary",
  "warning",
]);

export type CopyHit = { text: string; word: string; line: number };

function isCopy(text: string): boolean {
  const trimmed = text.trim();
  // A sentence (has a space), or a one-word label such as "Creative".
  return /[A-Za-z]/.test(trimmed) &&
    (/\s/.test(trimmed) || /^[A-Z][a-z]+$/.test(trimmed));
}

function bannedWord(text: string): string | null {
  for (const pattern of HOST_AD_BANNED_WORDS) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    // Join the fixed parts without adding spaces, so an id template such as
    // `host_plan_${hash}` is still read as a code, not a sentence.
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("…");
  }
  if (ts.isJsxText(node)) return node.text.replace(/\s+/g, " ").trim();
  return null;
}

function skipped(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) return true;
    if (ts.isLiteralTypeNode(current) || ts.isTypeNode(current)) return true;
    if (ts.isJsxAttribute(current) && SKIP_ATTRIBUTES.has(current.name.getText())) return true;
    if (ts.isElementAccessExpression(current) && current.argumentExpression === node) return true;
    if (ts.isCallExpression(current)) {
      const callee = current.expression.getText();
      if (/^console\./.test(callee) || /^(require|import)$/.test(callee)) return true;
      if (/\b(includes|startsWith|endsWith|test|match|replace|replaceAll|split|indexOf|join)$/.test(callee)) {
        return true;
      }
    }
    if (ts.isBinaryExpression(current)) {
      const op = current.operatorToken.kind;
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        return true;
      }
    }
    if (ts.isPropertyAssignment(current) && current.name === node) return true;
  }
  return false;
}

/** Host-visible sentences in a TSX/TS screen or helper that use banned words. */
export function scanHostCopy(source: string, fileName: string): CopyHit[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: CopyHit[] = [];
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text !== null && isCopy(text) && !skipped(node)) {
      const word = bannedWord(text);
      if (word) {
        hits.push({ text, word, line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}

/**
 * Messages Ari's ad tools hand back to a Host: ToolError messages and the
 * plain-text properties of tool results. Tool descriptions (read by the model,
 * not shown) are not scanned.
 */
export function scanAriAdMessages(region: string): CopyHit[] {
  const file = ts.createSourceFile("ari.ts", region, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: CopyHit[] = [];
  const record = (node: ts.Node): void => {
    const collect = (inner: ts.Node): void => {
      const text = literalText(inner);
      if (text !== null && isCopy(text)) {
        const word = bannedWord(text);
        if (word) {
          hits.push({ text, word, line: file.getLineAndCharacterOfPosition(inner.getStart()).line + 1 });
        }
      }
      ts.forEachChild(inner, collect);
    };
    collect(node);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && node.expression.getText() === "ToolError" && node.arguments?.[1]) {
      record(node.arguments[1]);
    }
    if (
      ts.isPropertyAssignment(node) &&
      ARI_MESSAGE_PROPERTIES.has(node.name.getText()) &&
      node.initializer
    ) {
      record(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}
