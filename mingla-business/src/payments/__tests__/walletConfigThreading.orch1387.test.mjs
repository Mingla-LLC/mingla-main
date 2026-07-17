/**
 * ORCH-1387 — business-side structural suite for the wallet-config threading
 * net (I-PROPOSED-1387-WALLET-CONFIG-THREADED).
 *
 * WHY (INVESTIGATION_ORCH-1387 F-2): ORCH-1246's Apple-4.9 fix had
 * HELPER-MATH coverage only — deleting the whole `applePay:` block, the
 * `cartItems:` line, or the `googlePay:` block from the callsite failed
 * nothing. This suite is the implementor happy-path fails-on-revert net for
 * the BUSINESS callsite (W-1/W-4/W-6), the shared hook's whole-object
 * forward (W-10), and the shared type contract (W-11).
 *
 * Structural node:test suite — fs + regex ONLY, zero product imports
 * (ORCH-1271 / orch_1190 house pattern; runs under bare `node --test`, no
 * npm ci). Deliberately overlaps the strict-grep gate
 * (orch-1387-wallet-config-threaded.mjs) with an INDEPENDENT scanner
 * implementation — defense in depth, a bug in one net cannot blind the other.
 *
 * Comment-stripping contract (COMMS-0106 ORPHAN-2 defense): BOTH `//` line
 * comments AND block comments are stripped, string-aware, before any
 * assertion — a decoy config living inside a comment can never satisfy a
 * rule. The suite proves its own stripper on a decoy fixture.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

const B = "mingla-business/src/payments/nativeCheckoutFlow.native.ts";
const H = "packages/payments-native/useStripePaymentSheet.ts";
const T = "packages/payments-native/types.ts";

const CART_TOKEN = "cartItems: buildApplePayCartItems(";

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

/** Argument span of the single initPaymentSheet( call (paren-counted on stripped text). */
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

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

// ─── Scanner self-proof (COMMS-0106: the suite proves its own tooling) ─────

test("stripper: a block-comment applePay decoy does NOT count", () => {
  const decoy = `
    /* applePay: { merchantCountryCode: "US",
       cartItems: buildApplePayCartItems(t, c, "Ticket") }, */
    const x = 1; // applePay in a line comment doesn't count either
  `;
  const stripped = stripComments(decoy);
  assert.ok(!stripped.includes("applePay"), "block/line-comment decoys must be stripped");
  assert.ok(!stripped.includes(CART_TOKEN), "comment-boxed cart line must be stripped");
});

test("stripper: string contents survive (URL // is not a comment)", () => {
  const src = 'const u = "com.app://x"; const v = `${A}://y`;';
  const stripped = stripComments(src);
  assert.ok(stripped.includes('"com.app://x"'), "string content must survive stripping");
  assert.ok(stripped.includes("://y"), "template content must survive stripping");
});

// ─── W-1 — uniqueness ──────────────────────────────────────────────────────

test("W-1: business flow file has exactly ONE initPaymentSheet( call", () => {
  const stripped = stripComments(read(B));
  assert.equal(
    countToken(stripped, "initPaymentSheet("),
    1,
    `${B} must contain exactly one initPaymentSheet( — a second call shape could smuggle an unguarded config`,
  );
});

// ─── W-4 — the Apple Pay 4.9 threading, span-scoped ────────────────────────

test("W-4: call span threads applePay", () => {
  const span = callSpan(stripComments(read(B)));
  assert.ok(span !== null, "call span must be extractable");
  assert.ok(span.includes("applePay"), "applePay config block must be inside the initPaymentSheet call");
});

test("W-4: call span threads merchantCountryCode", () => {
  const span = callSpan(stripComments(read(B)));
  assert.ok(span.includes("merchantCountryCode"), "merchantCountryCode must be inside the call span");
});

test("W-4: call span threads the Apple-4.9 cart line (buildApplePayCartItems)", () => {
  const span = callSpan(stripComments(read(B)));
  assert.ok(
    span.includes(CART_TOKEN),
    `the 4.9 product line — \`${CART_TOKEN}…)\` (label = product title, fallback "Ticket", NEVER the company) — must be inside the call span`,
  );
});

// ─── W-6 — the Google Pay analog ───────────────────────────────────────────

test("W-6: call span threads a googlePay block carrying merchantCountryCode", () => {
  const span = callSpan(stripComments(read(B)));
  const gpIdx = span.indexOf("googlePay");
  assert.notEqual(gpIdx, -1, "googlePay config block must be inside the call span");
  const block = braceBlock(span, gpIdx);
  assert.ok(block !== null, "googlePay block must be brace-matchable");
  assert.ok(block.includes("merchantCountryCode"), "googlePay block must carry its own merchantCountryCode");
});

// ─── W-10 — the hook forwards, never rebuilds ──────────────────────────────

test("W-10: useStripePaymentSheet forwards the WHOLE input object", () => {
  const stripped = stripComments(read(H));
  assert.ok(
    stripped.includes("initPaymentSheet(input)"),
    `${H} must call initPaymentSheet(input) — whole-object forward, no destructure/pick/rebuild`,
  );
});

test("W-10: the hook never mentions applePay or merchantDisplayName", () => {
  const stripped = stripComments(read(H));
  assert.ok(!stripped.includes("applePay"), "the hook must not rebuild/pick wallet config");
  assert.ok(!stripped.includes("merchantDisplayName"), "the hook must not rebuild sheet config");
});

// ─── W-11 — the type contract stays first-class + vendor-typed ─────────────

test("W-11: PaymentSheetInitInput declares vendor-typed applePay + googlePay", () => {
  const stripped = stripComments(read(T));
  assert.match(
    stripped,
    /applePay\?\s*:\s*PaymentSheet\.ApplePayParams/,
    `${T} must declare applePay?: PaymentSheet.ApplePayParams (ORCH-1387 first-class wallet key)`,
  );
  assert.match(
    stripped,
    /googlePay\?\s*:\s*PaymentSheet\.GooglePayParams/,
    `${T} must declare googlePay?: PaymentSheet.GooglePayParams (ORCH-1387 first-class wallet key)`,
  );
});
