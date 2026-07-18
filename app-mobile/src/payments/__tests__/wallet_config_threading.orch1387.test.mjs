/**
 * ORCH-1387 — consumer-side structural suite for the wallet-config threading
 * net (I-PROPOSED-1387-WALLET-CONFIG-THREADED).
 *
 * WHY (INVESTIGATION_ORCH-1387 F-2): the Apple-4.9 fix (ORCH-1244/1246 —
 * Apple Pay sheet shows the PRODUCT title, fallback "Ticket"/"Reservation",
 * NEVER the company) had helper-math coverage only; the THREADING of the
 * wallet config into initPaymentSheet had zero regression net. This suite is
 * the implementor happy-path fails-on-revert net for the CONSUMER callsites:
 * nativeCheckoutFlow.ts (W-2/W-5/W-7) and the useReserveTable reserve flow
 * (W-3/W-8/W-9 — incl. "the F-5 `as Record<string, unknown>` cast must never
 * return").
 *
 * Structural node:test suite — fs + regex ONLY, zero product imports
 * (ORCH-1271 / orch_1190 house pattern; runs under bare `node --test`).
 * Deliberately overlaps the strict-grep gate
 * (orch-1387-wallet-config-threaded.mjs) with an INDEPENDENT scanner
 * implementation — defense in depth.
 *
 * Comment-stripping contract (COMMS-0106 ORPHAN-2 defense): BOTH `//` line
 * comments AND block comments are stripped, string-aware, before any
 * assertion; the suite proves its own stripper on a decoy fixture.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

const C = "app-mobile/src/payments/nativeCheckoutFlow.ts";
const R = "app-mobile/src/hooks/useReserveTable.ts";

const CART_TOKEN = "cartItems: buildApplePayCartItems(";
const FORBIDDEN_CAST = "as Record<string, unknown>";

/** String-aware strip of // line + block comments (independent of the gate). */
function stripComments(source) {
  let out = "";
  let state = "code";
  let tplDepth = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] ?? "";
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        out += " ";
      } else if (ch === "/" && next === "*") {
        state = "block";
        out += " ";
      } else {
        if (ch === "'") state = "squote";
        else if (ch === '"') state = "dquote";
        else if (ch === "`") state = "template";
        else if (ch === "}" && tplDepth > 0) {
          tplDepth--;
          state = "template";
        }
        out += ch;
      }
    } else if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += "\n";
      } else out += " ";
    } else if (state === "block") {
      if (ch === "*" && next === "/") {
        out += "  ";
        i++;
        state = "code";
      } else out += ch === "\n" ? "\n" : " ";
    } else if (state === "squote") {
      if (ch === "\\") {
        out += ch + next;
        i++;
      } else {
        if (ch === "'") state = "code";
        out += ch;
      }
    } else if (state === "dquote") {
      if (ch === "\\") {
        out += ch + next;
        i++;
      } else {
        if (ch === '"') state = "code";
        out += ch;
      }
    } else if (state === "template") {
      if (ch === "\\") {
        out += ch + next;
        i++;
      } else if (ch === "$" && next === "{") {
        tplDepth++;
        state = "code";
        out += ch + next;
        i++;
      } else {
        if (ch === "`") state = "code";
        out += ch;
      }
    }
  }
  return out;
}

function countToken(text, token) {
  let c = 0;
  let i = 0;
  for (;;) {
    i = text.indexOf(token, i);
    if (i === -1) return c;
    c++;
    i += token.length;
  }
}

/** Argument span of the single initPaymentSheet( call (string-aware paren count). */
function callSpan(stripped) {
  const start = stripped.indexOf("initPaymentSheet(");
  if (start === -1) return null;
  const openIdx = start + "initPaymentSheet".length;
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") inStr = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return stripped.slice(openIdx, i + 1);
    }
  }
  return null;
}

/** { … } block starting at first { at/after fromIdx (string-aware). */
function braceBlock(text, fromIdx) {
  const open = text.indexOf("{", fromIdx);
  if (open === -1) return null;
  let depth = 0;
  let inStr = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") inStr = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

/** The walletConfig declaration body in R (first { after the = following const walletConfig). */
function walletConfigBody(stripped) {
  const decl = stripped.indexOf("const walletConfig");
  if (decl === -1) return null;
  const eq = stripped.indexOf("=", decl);
  if (eq === -1) return null;
  return braceBlock(stripped, eq);
}

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

// ─── Scanner self-proof (COMMS-0106: the suite proves its own tooling) ─────

test("stripper: block/line-comment wallet decoys do NOT count", () => {
  const decoy = `
    /* applePay: { merchantCountryCode: "US",
       cartItems: buildApplePayCartItems(t, c, "Reservation") }, */
    // ...(walletConfig as Record<string, unknown>),
    const x = 1;
  `;
  const stripped = stripComments(decoy);
  assert.ok(!stripped.includes("applePay"), "block-comment decoy must be stripped");
  assert.ok(!stripped.includes(FORBIDDEN_CAST), "line-comment cast mention must be stripped");
});

// ─── W-2 — uniqueness (consumer flow) ──────────────────────────────────────

test("W-2: consumer flow file has exactly ONE initPaymentSheet( call", () => {
  const stripped = stripComments(read(C));
  assert.equal(
    countToken(stripped, "initPaymentSheet("),
    1,
    `${C} must contain exactly one initPaymentSheet( — a second call shape could smuggle an unguarded config`,
  );
});

// ─── W-5 — the Apple Pay 4.9 threading, span-scoped ────────────────────────

test("W-5: call span threads applePay", () => {
  const span = callSpan(stripComments(read(C)));
  assert.ok(span !== null, "call span must be extractable");
  assert.ok(span.includes("applePay"), "applePay config block must be inside the initPaymentSheet call");
});

test("W-5: call span threads merchantCountryCode", () => {
  const span = callSpan(stripComments(read(C)));
  assert.ok(span.includes("merchantCountryCode"), "merchantCountryCode must be inside the call span");
});

test("W-5: call span threads the Apple-4.9 cart line (buildApplePayCartItems)", () => {
  const span = callSpan(stripComments(read(C)));
  assert.ok(
    span.includes(CART_TOKEN),
    `the 4.9 product line — \`${CART_TOKEN}…)\` (label = product title, fallback "Ticket", NEVER the company) — must be inside the call span`,
  );
});

// ─── W-7 — the Google Pay analog ───────────────────────────────────────────

test("W-7: call span threads a googlePay block carrying merchantCountryCode", () => {
  const span = callSpan(stripComments(read(C)));
  const gpIdx = span.indexOf("googlePay");
  assert.notEqual(gpIdx, -1, "googlePay config block must be inside the call span");
  const block = braceBlock(span, gpIdx);
  assert.ok(block !== null, "googlePay block must be brace-matchable");
  assert.ok(block.includes("merchantCountryCode"), "googlePay block must carry its own merchantCountryCode");
});

// ─── W-3 — uniqueness (reserve hook) ───────────────────────────────────────

test("W-3: useReserveTable has exactly ONE initPaymentSheet( call", () => {
  const stripped = stripComments(read(R));
  assert.equal(
    countToken(stripped, "initPaymentSheet("),
    1,
    `${R} must contain exactly one initPaymentSheet( call`,
  );
});

// ─── W-8 — walletConfig body + spread ──────────────────────────────────────

test("W-8: walletConfig body carries applePay + the 4.9 cart line + googlePay", () => {
  const body = walletConfigBody(stripComments(read(R)));
  assert.ok(body !== null, "the walletConfig declaration body must exist");
  assert.ok(body.includes("applePay"), "walletConfig must carry applePay");
  assert.ok(
    body.includes(CART_TOKEN),
    `walletConfig must carry \`${CART_TOKEN}…)\` — fallback "Reservation", NEVER the company`,
  );
  assert.ok(body.includes("googlePay"), "walletConfig must carry googlePay");
});

test("W-8: the initPaymentSheet call span spreads ...walletConfig", () => {
  const span = callSpan(stripComments(read(R)));
  assert.ok(span !== null, "call span must be extractable");
  assert.ok(
    span.includes("...walletConfig"),
    "the walletConfig must actually be spread into the call — declared-but-never-passed is the silent-drop shape",
  );
});

// ─── W-9 — the F-5 cast must never return ──────────────────────────────────

test("W-9: useReserveTable contains no `as Record<string, unknown>` cast", () => {
  const stripped = stripComments(read(R));
  assert.ok(
    !stripped.includes(FORBIDDEN_CAST),
    `${R} must not smuggle wallet keys past the type contract with \`${FORBIDDEN_CAST}\` — the config is first-class on PaymentSheetInitInput since ORCH-1387`,
  );
});
