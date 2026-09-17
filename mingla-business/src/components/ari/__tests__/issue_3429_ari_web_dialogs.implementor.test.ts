/**
 * #3429 REWORK-1 D-9 implementor proof. `Alert.alert` is a no-op on
 * react-native-web, so the Ari drawer and attachment cards must not use it.
 * Uses the TypeScript compiler API: comments and string mentions never count,
 * only real import specifiers, call expressions and JSX elements do.
 */

import fs from "fs";
import path from "path";
import ts from "typescript";

const ARI_DIR = path.resolve(__dirname, "..");

function parse(fileName: string): ts.SourceFile {
  const filePath = path.join(ARI_DIR, fileName);
  return ts.createSourceFile(filePath, fs.readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function alertUses(file: ts.SourceFile): string[] {
  const uses: string[] = [];
  walk(file, (node) => {
    if (ts.isImportSpecifier(node) && node.name.text === "Alert") uses.push("import Alert");
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Alert"
    ) {
      uses.push(`Alert.${node.expression.name.text}()`);
    }
  });
  return uses;
}

interface DialogElement {
  attributes: Record<string, string>;
}

function confirmDialogs(file: ts.SourceFile): DialogElement[] {
  const dialogs: DialogElement[] = [];
  walk(file, (node) => {
    if (!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) return;
    if (node.tagName.getText(file) !== "ConfirmDialog") return;
    const attributes: Record<string, string> = {};
    for (const property of node.attributes.properties) {
      if (!ts.isJsxAttribute(property)) continue;
      const name = property.name.getText(file);
      if (!property.initializer) {
        attributes[name] = "true";
        continue;
      }
      const initializer = property.initializer;
      if (ts.isStringLiteral(initializer)) {
        attributes[name] = initializer.text;
      } else if (ts.isJsxExpression(initializer) && initializer.expression) {
        attributes[name] = initializer.expression.getText(file);
      }
    }
    dialogs.push({ attributes });
  });
  return dialogs;
}

describe("#3429 D-9 Ari actions work on web", () => {
  it("never imports or calls Alert in the conversation drawer or attachment cards", () => {
    expect(alertUses(parse("ConversationDrawer.tsx"))).toEqual([]);
    expect(alertUses(parse("AriAttachmentCards.tsx"))).toEqual([]);
  });

  it("confirms Regenerate, single Delete and bulk Delete with web-capable ConfirmDialogs", () => {
    const dialogs = confirmDialogs(parse("ConversationDrawer.tsx"));
    const byConfirm = (label: string) => dialogs.filter((dialog) => dialog.attributes.confirmLabel === label);

    expect(byConfirm("Regenerate")).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({
          title: "Replace your name with a new Ari title?",
          cancelLabel: "Cancel",
        }),
      }),
    ]);
    const deletes = byConfirm("Delete");
    expect(deletes).toHaveLength(2);
    expect(deletes.map((dialog) => dialog.attributes.description).sort()).toEqual([
      "Delete this conversation? This can't be undone.",
      "This can't be undone.",
    ]);
    const single = deletes.find((dialog) => dialog.attributes.description.startsWith("Delete this"));
    expect(single?.attributes.title).toContain("conversationDisplayTitle(deleteConfirm)");
    expect(single?.attributes.destructive).toBe("true");
    const bulk = deletes.find((dialog) => dialog.attributes.description === "This can't be undone.");
    expect(bulk?.attributes.title).toContain("`Delete ${");
    expect(bulk?.attributes.destructive).toBe("true");
  });
});
