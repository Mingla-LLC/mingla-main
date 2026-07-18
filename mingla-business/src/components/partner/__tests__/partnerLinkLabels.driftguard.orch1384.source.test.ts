// ORCH-1384 — web eager-bundle budget DRIFT GUARD.
//
// The ORCH-1083 initial-bundle budget (scripts/ci/orch-1083-initial-bundle-
// budget.mjs) requires the native-first PartnerLinkDetailSheet — and its pure
// label module partnerLinkLabels — to stay OUT of the shared web boot
// `__common` chunk. To achieve that, partnerLinkLabels is imported ONLY by the
// lazy sheet, and the two tiny eager list surfaces carry VERBATIM inline copies
// of the labels they need:
//   - app/partner/brands.tsx               → reasonLabelFor + terminalEventNameFor
//   - src/components/team/MemberDetailSheet → errorCopyFor
//
// Duplicating pure spec-frozen copy is safe ONLY if the copies never drift.
// This guard extracts + EXECUTES every copy and asserts byte-identical outputs
// against the canonical partnerLinkLabels definitions across every input. If
// anyone edits one copy and not the others, this test goes red.
//
// (Source-assertion + executed-value style, matching the sibling ORCH-1384
// source tests; no RTL under the default node/ts-jest config.)

/* eslint-disable import/first */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const CANON = fs.readFileSync(
  path.resolve(__dirname, "../partnerLinkLabels.ts"),
  "utf8",
);
const BRANDS = fs.readFileSync(
  path.resolve(__dirname, "../../../../app/partner/brands.tsx"),
  "utf8",
);
const MEMBER = fs.readFileSync(
  path.resolve(__dirname, "../../team/MemberDetailSheet.tsx"),
  "utf8",
);

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Balanced-brace slice from a start marker (asserts uniqueness). */
function sliceIn(src: string, marker: string): string {
  expect(countOf(src, marker)).toBe(1);
  const start = src.indexOf(marker);
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced slice for ${marker}`);
}

function evalFn<T>(tsSource: string, name: string): T {
  const js = ts.transpileModule(`${tsSource}\nmodule.exports = ${name};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const shim = { exports: {} as unknown };
  new Function("module", "exports", js)(shim, shim.exports);
  return shim.exports as T;
}

type StrFn = (arg: string | null) => string;

const REASONS: Array<string | null> = [
  "owner_declined",
  "invitation_revoked",
  "partner_disconnected",
  "owner_removed",
  "partner_cancelled",
  null,
  "some_unrecognized_reason",
];

const ERROR_CODES: string[] = [
  "link_not_pending",
  "link_not_active",
  "link_not_found",
  "forbidden",
  "email_send_failed",
  "server",
  "totally_unknown_code",
];

describe("ORCH-1384 label drift guard — inline copies == canonical partnerLinkLabels", () => {
  test("reasonLabelFor: brands inline copy matches canonical for every input", () => {
    const canon = evalFn<StrFn>(
      sliceIn(CANON, "export function reasonLabelFor"),
      "reasonLabelFor",
    );
    const brands = evalFn<StrFn>(
      sliceIn(BRANDS, "function reasonLabelFor"),
      "reasonLabelFor",
    );
    for (const r of REASONS) {
      expect(`${String(r)}→${brands(r)}`).toBe(`${String(r)}→${canon(r)}`);
    }
    // Spot-pin a canonical value so a matching double-edit still can't pass.
    expect(canon("owner_removed")).toBe("Disconnected by owner");
  });

  test("terminalEventNameFor: brands inline copy matches canonical for every input", () => {
    const canon = evalFn<StrFn>(
      sliceIn(CANON, "export function terminalEventNameFor"),
      "terminalEventNameFor",
    );
    const brands = evalFn<StrFn>(
      sliceIn(BRANDS, "function terminalEventNameFor"),
      "terminalEventNameFor",
    );
    for (const r of REASONS) {
      expect(`${String(r)}→${brands(r)}`).toBe(`${String(r)}→${canon(r)}`);
    }
    expect(canon("invitation_revoked")).toBe("Revoked");
  });

  test("errorCopyFor: MemberDetailSheet inline copy matches canonical for every code", () => {
    const canon = evalFn<(c: string) => string>(
      sliceIn(CANON, "export function errorCopyFor"),
      "errorCopyFor",
    );
    const member = evalFn<(c: string) => string>(
      sliceIn(MEMBER, "function errorCopyFor"),
      "errorCopyFor",
    );
    for (const c of ERROR_CODES) {
      expect(`${c}→${member(c)}`).toBe(`${c}→${canon(c)}`);
    }
    expect(canon("email_send_failed")).toBe(
      "We couldn't send the email. Tap Resend invite to try again.",
    );
  });
});
