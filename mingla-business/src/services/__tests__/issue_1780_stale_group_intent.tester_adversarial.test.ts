/**
 * #1780 tester-owned adversarial regression: stale saved-group/Everyone intent.
 *
 * Saved-group and Everyone mutations do not know their server-expanded person
 * IDs before the RPC succeeds, so the PendingReceipt is the only exact copy of
 * the creator's unsaved choice. A revision conflict must hydrate current truth
 * and retain that receipt for an explicit, user-triggered retry. Clearing it
 * makes Retry fall through to a quote refresh while falsely claiming the choice
 * is still present.
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";

type AstNode = Record<string, unknown> & { type?: string };

const SOURCE_PATH = path.resolve(
  __dirname,
  "../../components/invites/InvitePeopleStep.tsx",
);
const source = fs.readFileSync(SOURCE_PATH, "utf8");
const ast = parse(source, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});

function walk(node: unknown, visit: (value: AstNode) => void): void {
  if (node === null || typeof node !== "object") return;
  const value = node as AstNode;
  visit(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((entry) => walk(entry, visit));
    else walk(child, visit);
  }
}

function contains(node: unknown, predicate: (value: AstNode) => boolean): boolean {
  let found = false;
  walk(node, (value) => {
    if (predicate(value)) found = true;
  });
  return found;
}

function memberPath(node: unknown): string | null {
  if (node === null || typeof node !== "object") return null;
  const value = node as AstNode;
  if (value.type === "Identifier") return String(value.name);
  if (value.type !== "MemberExpression" && value.type !== "OptionalMemberExpression") {
    return null;
  }
  const object = memberPath(value.object);
  const property = memberPath(value.property);
  return object && property ? `${object}.${property}` : null;
}

function variableInitializer(name: string): AstNode {
  let result: AstNode | null = null;
  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const id = node.id as AstNode | undefined;
    if (id?.type === "Identifier" && id.name === name) {
      result = (node.init as AstNode | undefined) ?? null;
    }
  });
  if (result === null) throw new Error(`Missing variable ${name}`);
  return result;
}

function namedFunction(name: string): AstNode {
  let result: AstNode | null = null;
  walk(ast, (node) => {
    if (node.type !== "FunctionDeclaration") return;
    const id = node.id as AstNode | undefined;
    if (id?.type === "Identifier" && id.name === name) result = node;
  });
  if (result === null) throw new Error(`Missing function ${name}`);
  return result;
}

function revisionConflictBranch(): AstNode {
  let result: AstNode | null = null;
  walk(ast, (node) => {
    if (node.type !== "IfStatement") return;
    if (contains(node.test, (part) =>
      part.type === "StringLiteral" && part.value === "wizard_invite_revision_conflict")) {
      result = node.consequent as AstNode;
    }
  });
  if (result === null) throw new Error("Missing revision-conflict branch");
  return result;
}

function assignmentTo(node: unknown, target: string, rightType?: string): boolean {
  return contains(node, (part) => {
    if (part.type !== "AssignmentExpression") return false;
    if (memberPath(part.left) !== target) return false;
    return rightType === undefined || (part.right as AstNode | undefined)?.type === rightType;
  });
}

function callTo(node: unknown, callee: string): AstNode[] {
  const calls: AstNode[] = [];
  walk(node, (part) => {
    if (part.type === "CallExpression" && memberPath(part.callee) === callee) calls.push(part);
  });
  return calls;
}

describe("#1780 stale saved-group/Everyone recovery", () => {
  test("source actions keep their pre-expansion intent in the pending receipt", () => {
    const receiptOnlyMutations = callTo(ast, "persistSelection").filter((call) => {
      const args = call.arguments as AstNode[];
      return args[1]?.type === "NullLiteral";
    });

    // Everyone and Saved groups both intentionally have no localDesired IDs
    // until the server expands them. This proves why their receipt cannot be
    // treated as disposable local retry bookkeeping.
    expect(receiptOnlyMutations).toHaveLength(2);
  });

  test("a revision conflict retains the only exact intent for explicit retry", () => {
    const stale = revisionConflictBranch();
    const retry = variableInitializer("retry");
    const retryUsesReceipt = callTo(retry, "persistSelection").some((call) => {
      const args = call.arguments as AstNode[];
      return memberPath(args[0]) === "pendingReceipt.current.selection";
    });
    const staleDiscardsReceipt = assignmentTo(
      stale,
      "pendingReceipt.current",
      "NullLiteral",
    );

    // If staleDiscardsReceipt is true, retryUsesReceipt is unreachable for a
    // group/Everyone choice and Retry can only refresh authoritative state.
    expect({ retryUsesReceipt, staleDiscardsReceipt }).toEqual({
      retryUsesReceipt: true,
      staleDiscardsReceipt: false,
    });
  });

  test("the stale handler hydrates current truth but never blindly replays", () => {
    const stale = revisionConflictBranch();
    const persistCalls = callTo(stale, "persistSelection");
    const mutationCalls = callTo(stale, "model.replace.mutateAsync");
    const refreshCalls = callTo(ast, "model.refreshAuthoritative");

    // Hydration belongs to the surrounding catch before the typed stale branch;
    // the stale branch itself must only retain/label intent. A later user action
    // performs the retry against the newly hydrated revision.
    expect(refreshCalls.length).toBeGreaterThan(0);
    expect(persistCalls).toHaveLength(0);
    expect(mutationCalls).toHaveLength(0);
  });

  test("explicit retry rotates the receipt when hydration changed revision", () => {
    const persistSelection = namedFunction("persistSelection");
    const hasFreshRevisionKey = contains(persistSelection, (node) =>
      node.type === "MemberExpression" && memberPath(node) === "plan.selectionRevision");
    const rotatesMismatchedReceipt = contains(persistSelection, (node) => {
      if (node.type !== "BinaryExpression" || node.operator !== "!==") return false;
      return memberPath(node.left) === "pendingReceipt.current.key" ||
        memberPath(node.right) === "pendingReceipt.current.key";
    });

    expect({ hasFreshRevisionKey, rotatesMismatchedReceipt }).toEqual({
      hasFreshRevisionKey: true,
      rotatesMismatchedReceipt: true,
    });
  });
});
