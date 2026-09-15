/**
 * #1780 tester-owned adversarial regression: selection-flag rollback.
 *
 * SPEC SC-34 and §15 require the OFF state to preserve legacy no-invite
 * publishing. Hydration/quote remain available for an existing non-empty plan,
 * but an empty/no-plan draft must not become dependent on Edge quote health.
 *
 * This source-level boundary test covers all four independently implemented
 * wizard adapters. Each adapter must either make summary readiness itself
 * conditional on inviteEnabled, or condition the publish-disabled gate on
 * inviteEnabled. An unconditional `!inviteSummaryReady` is the outage coupling
 * this regression prevents.
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";

const ROOT = path.resolve(__dirname, "../../..");

const WIZARDS = [
  { file: "src/components/event/EventCreatorWizard.tsx", handler: "handlePublishTap" },
  { file: "src/components/rsvp/RsvpCreatorWizard.tsx", handler: "handlePublishTap" },
  { file: "src/components/experience/ExperienceCreatorWizard.tsx", handler: "beginPublish" },
  { file: "src/components/trip/TripCreatorWizard.tsx", handler: "handlePublishTap" },
] as const;

function removesComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

type AstNode = Record<string, unknown> & { type?: string };

function walks(node: unknown, predicate: (value: AstNode) => boolean): boolean {
  if (node === null || typeof node !== "object") return false;
  const value = node as AstNode;
  if (predicate(value)) return true;
  return Object.values(value).some((child) =>
    Array.isArray(child)
      ? child.some((entry) => walks(entry, predicate))
      : walks(child, predicate),
  );
}

function hasFlagOffTapBypass(source: string, handlerName: string): boolean {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const found: { body: AstNode[] | null } = { body: null };
  walks(ast, (node) => {
    if (node.type !== "VariableDeclarator") return false;
    const id = node.id as AstNode | undefined;
    const init = node.init as AstNode | undefined;
    if (id?.type !== "Identifier" || id.name !== handlerName || init?.type !== "CallExpression") {
      return false;
    }
    const callback = (init.arguments as AstNode[] | undefined)?.[0];
    const body = callback?.body as AstNode | undefined;
    if (body?.type === "BlockStatement") found.body = body.body as AstNode[];
    return false;
  });
  const handlerBody = found.body;
  if (handlerBody === null) return false;

  const refreshIndex = handlerBody.findIndex((statement) =>
    walks(statement, (node) =>
      node.type === "Identifier" && node.name === "refreshAuthoritative"),
  );
  if (refreshIndex < 0) return true;

  return handlerBody.slice(0, refreshIndex).some((statement) => {
    if (statement.type !== "IfStatement") return false;
    const test = statement.test as AstNode | undefined;
    const branchesOnFlagOff = walks(test, (node) =>
      node.type === "UnaryExpression" && node.operator === "!" &&
      (node.argument as AstNode | undefined)?.type === "Identifier" &&
      (node.argument as AstNode | undefined)?.name === "inviteEnabled");
    const consequent = statement.consequent as AstNode | undefined;
    const exitsBeforeRefresh = walks(consequent, (node) => node.type === "ReturnStatement");
    const stillRefreshes = walks(consequent, (node) =>
      node.type === "Identifier" && node.name === "refreshAuthoritative");
    return branchesOnFlagOff && exitsBeforeRefresh && !stillRefreshes;
  });
}

describe("#1780 selection feature-flag rollback", () => {
  test.each(WIZARDS)(
    "$file keeps Publish enabled without a quote when invites are disabled",
    ({ file: relativePath }) => {
      const source = removesComments(
        fs.readFileSync(path.join(ROOT, relativePath), "utf8"),
      );

      const readinessBypassesWhenDisabled =
        /const\s+inviteSummaryReady\s*=\s*!inviteEnabled\s*\|\|/.test(source);
      const publishGateIsConditional =
        /inviteEnabled\s*&&\s*!inviteSummaryReady/.test(source);

      expect(
        readinessBypassesWhenDisabled || publishGateIsConditional,
      ).toBe(true);
    },
  );

  test.each(WIZARDS)(
    "$file bypasses the quote refresh on a flag-off Publish tap",
    ({ file: relativePath, handler }) => {
      const source = removesComments(
        fs.readFileSync(path.join(ROOT, relativePath), "utf8"),
      );
      // Button enablement is not enough: tapping Publish must also have a real
      // flag-off control-flow branch that exits before the Edge quote refresh.
      expect(hasFlagOffTapBypass(source, handler)).toBe(true);
    },
  );
});
