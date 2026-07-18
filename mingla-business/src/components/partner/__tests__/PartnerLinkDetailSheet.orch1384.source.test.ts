// ORCH-1384 — implementor regression: PartnerLinkDetailSheet contract
// (T-11 detail-sheet states + T-9 component leg + the BINDING copy blocks).
//
// Source-contract tests under the default node/ts-jest config (no RTL) with
// COMMS-0106 companions: every slice asserts declaration uniqueness, sliced
// logic is transpiled + EXECUTED (value asserts), and per-testID occurrence
// counts pin the render structure so a commented-out or duplicated block
// cannot orphan an assert.

/* eslint-disable import/first */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../PartnerLinkDetailSheet.tsx"),
  "utf8",
);
/** JSX collapses run-on whitespace — normalize for copy asserts. */
const FLAT = SRC.replace(/\s+/g, " ");

// ORCH-1384 web eager-bundle budget fix: reasonLabelFor / terminalEventNameFor
// / errorCopyFor were relocated to the zero-dependency partnerLinkLabels module
// so the eager list surfaces (brands rows, team MemberDetailSheet) stop
// dragging this heavy native-first sheet into the web boot __common chunk. The
// executed-value contracts for those three now slice the labels module; every
// other slice (verbSetFor, styles, JSX) still reads the sheet source.
const LABELS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../partnerLinkLabels.ts"),
  "utf8",
);

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Balanced-brace slice from an arbitrary source string. */
function sliceIn(src: string, marker: string): string {
  expect(countOf(src, marker)).toBe(1);
  const start = src.indexOf(marker);
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] === "{") continue;
        return src.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unbalanced slice for ${marker}`);
}

function slice(marker: string): string {
  expect(countOf(SRC, marker)).toBe(1);
  const start = SRC.indexOf(marker);
  const braceStart = SRC.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    if (SRC[i] === "}") {
      depth--;
      if (depth === 0) {
        let j = i + 1;
        while (j < SRC.length && /\s/.test(SRC[j])) j++;
        if (SRC[j] === "{") continue;
        return SRC.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unbalanced slice for ${marker}`);
}

function evalSlice<T>(tsSource: string, returnExpr: string): T {
  const js = ts.transpileModule(
    `${tsSource}\nmodule.exports = ${returnExpr};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const moduleShim = { exports: {} as unknown };
  new Function("module", "exports", js)(moduleShim, moduleShim.exports);
  return moduleShim.exports as T;
}

describe("T-11 — verb set per status (executed contract)", () => {
  test("verbSetFor: awaiting_owner=4 verbs+close; stripe/active=dashboard+disconnect+close; cancelled=close ONLY", () => {
    const fn = evalSlice<{ (s: string): readonly string[] }>(
      slice("export function verbSetFor"),
      "verbSetFor",
    );
    expect(fn("awaiting_owner")).toEqual([
      "resend",
      "correctEmail",
      "openDashboard",
      "cancel",
      "close",
    ]);
    expect(fn("awaiting_stripe")).toEqual([
      "openDashboard",
      "disconnect",
      "close",
    ]);
    expect(fn("active")).toEqual(["openDashboard", "disconnect", "close"]);
    expect(fn("cancelled")).toEqual(["close"]);
  });

  test("testID registry — every DESIGN §10.2 sheet id present with the exact expected multiplicity", () => {
    const exactly: Array<[string, number]> = [
      ['testID="partner-link-detail-sheet"', 1],
      ['testID="partner-link-resend"', 1],
      ['testID="partner-link-correct-email"', 1],
      ['testID="partner-link-correct-email-input"', 1],
      ['testID="partner-link-correct-email-send"', 1],
      // awaiting_owner block + awaiting_stripe/active block (the reject step
      // uses its own reject-dashboard id).
      ['testID="partner-link-open-dashboard"', 2],
      ['testID="partner-link-cancel"', 1],
      ['testID="partner-link-confirm-cancel"', 1],
      ['testID="partner-link-confirm-disconnect"', 1],
      // Shared by both confirm steps (only one renders at a time).
      ['testID="partner-link-confirm-back"', 2],
      ['testID="partner-link-disconnect"', 1],
      ['testID="partner-link-reject-dashboard"', 1],
      ['testID="partner-link-reject-close"', 1],
      // awaiting_owner + awaiting_stripe/active + cancelled blocks.
      ['testID="partner-link-close"', 3],
    ];
    for (const [needle, n] of exactly) {
      expect(`${needle} → ${countOf(SRC, needle)}`).toBe(`${needle} → ${n}`);
    }
  });

  test("destructive verbs are confirm-GATED: detail-step buttons only change step; mutations fire from confirm steps", () => {
    // Cancel: the detail-step button routes to the confirm step…
    expect(countOf(SRC, 'setStep("confirmCancel")')).toBe(1);
    expect(countOf(SRC, 'setStep("confirmDisconnect")')).toBe(1);
    // …and the mutation handlers are wired ONLY on the confirm buttons.
    expect(countOf(SRC, "onPress={handleConfirmCancel}")).toBe(1);
    expect(countOf(SRC, "onPress={handleConfirmDisconnect}")).toBe(1);
    // The cancel button block does NOT call the mutation directly.
    const cancelBtnIdx = SRC.indexOf('testID="partner-link-cancel"');
    const around = SRC.slice(cancelBtnIdx - 600, cancelBtnIdx);
    expect(around).not.toContain("mutateAsync");
  });

  test("submitting rule: acting button loading, siblings disabled", () => {
    // Every verb button either carries loading={submittingVerb === …} or
    // disables on anySubmitting — spot-pin the resend pair.
    expect(SRC).toContain('loading={submittingVerb === "resend"}');
    expect(SRC).toContain(
      'disabled={anySubmitting && submittingVerb !== "resend"}',
    );
    expect(SRC).toContain('loading={submittingVerb === "cancel"}');
    expect(SRC).toContain('loading={submittingVerb === "disconnect"}');
  });

  test("no native Alert anywhere (DESIGN §8.3 — custom in-app confirms only)", () => {
    // No Alert.alert call and no Alert import from react-native (the header
    // comment MAY name the rule — code usage is what's banned).
    expect(SRC).not.toContain("Alert.alert");
    const rnImport = SRC.match(/import \{[^}]*\} from "react-native"/);
    expect(rnImport).not.toBeNull();
    expect(String(rnImport?.[0])).not.toMatch(/\bAlert\b/);
  });
});

describe("T-9 component leg — cancelled is terminal read-only (SC-14)", () => {
  test("the cancelled branch renders Close ONLY — no dashboard verb for any cancelled reason", () => {
    // The cancelled ternary appears EXACTLY twice: the facts-card Group D
    // (STATUS) row and the terminal verb block (COMMS-0106 count pin).
    const marker = '{link.status === "cancelled" ? (';
    expect(countOf(SRC, marker)).toBe(2);
    // Neither cancelled-gated block may contain a dashboard/verb affordance.
    let from = 0;
    for (let occurrence = 0; occurrence < 2; occurrence++) {
      const start = SRC.indexOf(marker, from);
      const end = SRC.indexOf(") : null}", start);
      expect(end).toBeGreaterThan(start);
      const block = SRC.slice(start, end);
      expect(block).not.toContain("partner-link-open-dashboard");
      expect(block).not.toContain("handleOpenDashboard");
      expect(block).not.toContain("partner-link-resend");
      expect(block).not.toContain('testID="partner-link-cancel"');
      from = end;
    }
    // The terminal verb block (marked SC-14) carries the lone Close.
    const sc14 = SRC.indexOf("Terminal read-only (SC-14)");
    expect(sc14).toBeGreaterThan(-1);
    const verbBlock = SRC.slice(sc14, SRC.indexOf(") : null}", sc14));
    expect(verbBlock).toContain('testID="partner-link-close"');
  });
});

describe("BINDING copy blocks (DESIGN §9.2 — verbatim)", () => {
  test("deletion disclosure — verbatim", () => {
    expect(FLAT).toContain(
      "This cancels the invite and deletes the draft brand you built. This can't be undone.",
    );
  });

  test("money truth — verbatim", () => {
    expect(FLAT).toContain(
      "You'll stop earning from future sales for this brand. Money already earned still pays out.",
    );
  });

  test("danger-card titles ride text.primary (semantic.error text BANNED at 3.86:1 — DESIGN §4.3)", () => {
    const style = slice("  dangerTitle:");
    expect(style).toContain("color: textTokens.primary");
    expect(style).not.toContain("semantic.error");
  });

  test("§5.6 typed error copy table (executed)", () => {
    const fn = evalSlice<{ (code: string): string }>(
      sliceIn(LABELS_SRC, "export function errorCopyFor"),
      "errorCopyFor",
    );
    expect(fn("link_not_pending")).toBe(
      "This invite already changed state. Close this and check the list.",
    );
    expect(fn("link_not_active")).toBe(
      "This connection isn't active anymore. Close this and check the list.",
    );
    expect(fn("link_not_found")).toBe(
      "This link no longer exists. Close this and refresh.",
    );
    expect(fn("forbidden")).toBe(
      "You don't have permission to manage this link.",
    );
    expect(fn("email_send_failed")).toBe(
      "We couldn't send the email. Tap Resend invite to try again.",
    );
    expect(fn("anything_else")).toBe("Something broke on our side. Try again.");
  });

  test("§9.1 reason labels + terminal timeline verbs (executed)", () => {
    const labelFn = evalSlice<{ (r: string | null): string }>(
      sliceIn(LABELS_SRC, "export function reasonLabelFor"),
      "reasonLabelFor",
    );
    expect(labelFn("partner_cancelled")).toBe("Cancelled");
    expect(labelFn("owner_declined")).toBe("Declined by owner");
    expect(labelFn("invitation_revoked")).toBe("Invite revoked");
    expect(labelFn("partner_disconnected")).toBe("Disconnected");
    expect(labelFn("owner_removed")).toBe("Disconnected by owner");
    expect(labelFn(null)).toBe("Cancelled");

    const eventFn = evalSlice<{ (r: string | null): string }>(
      sliceIn(LABELS_SRC, "export function terminalEventNameFor"),
      "terminalEventNameFor",
    );
    expect(eventFn("partner_cancelled")).toBe("Cancelled");
    expect(eventFn("owner_declined")).toBe("Declined");
    expect(eventFn("invitation_revoked")).toBe("Revoked");
    expect(eventFn("partner_disconnected")).toBe("Disconnected");
    expect(eventFn("owner_removed")).toBe("Disconnected");
    expect(eventFn(null)).toBe("Cancelled");
  });

  test("reject step (Decision-11): recovery path + zero-writes copy honesty", () => {
    expect(FLAT).toContain("Can't cancel yet");
    // Recovery path — dashboard verb inside the reject step.
    const rejectIdx = SRC.indexOf('testID="partner-link-reject-dashboard"');
    expect(rejectIdx).toBeGreaterThan(-1);
    // The reject copy directs to fix events THEN come back — never implies a
    // partial cancel happened.
    expect(FLAT).toContain(
      "first, then come back and cancel the invite.",
    );
  });

  test("snap contract: full for awaiting_owner, half otherwise; status frozen at open via snapshot prop", () => {
    expect(SRC).toContain(
      'link.status === "awaiting_owner" ? "full" : "half"',
    );
    expect(FLAT).toContain("Row SNAPSHOT captured at tap time");
  });
});
