#!/usr/bin/env node
/**
 * ORCH-0852 [Buyer-web confirmation QR clipped + wallet passes inert +
 * in-app-browser stuck after payment] — strict-grep gate.
 *
 * Enforces I-WALLET-PASS-HIDDEN-UNTIL-IMPLEMENTED — Apple Wallet / Google
 * Wallet "Add to" affordances MUST NOT render in `mingla-business/` until
 * the wallet-pass infrastructure (`.pkpass` generation + Google Wallet
 * JWT issuance) ships under a future ORCH. The ORCH-0852 close removed
 * the placeholder buttons from `app/checkout/[eventId]/confirm.tsx` and
 * `app/o/[orderId].tsx`; this gate prevents accidental resurrection.
 *
 * Scope: all `mingla-business/**` source files (.tsx, .ts, .js, .jsx).
 *        Migrations, edge functions, archives, and comments are exempt.
 *
 * Exit codes:
 *   0 — clean
 *   1 — violation
 *
 * Per SPEC_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md §"Regression Prevention".
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const SCAN_ROOT = join(ROOT, "mingla-business");

const BANNED_LITERALS = [
  /"Add to Apple Wallet"/,
  /'Add to Apple Wallet'/,
  /"Add to Google Wallet"/,
  /'Add to Google Wallet'/,
];

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const violations = [];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (
      name === "node_modules" ||
      name === "dist" ||
      name === "build" ||
      name === ".expo" ||
      name === ".next" ||
      name === "ios" ||
      name === "android" ||
      name.startsWith(".")
    ) {
      continue;
    }
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walk(p));
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(SCAN_ROOT);
for (const abs of files) {
  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    continue;
  }
  const stripped = stripComments(raw);
  for (const pattern of BANNED_LITERALS) {
    if (pattern.test(stripped)) {
      violations.push({
        file: relative(ROOT, abs),
        msg: `Banned wallet-pass affordance literal ${pattern} — until ORCH-XXXX [Wallet pass issuance] ships real .pkpass + Google Wallet JWT infrastructure, these buttons MUST NOT render. Per I-WALLET-PASS-HIDDEN-UNTIL-IMPLEMENTED.`,
      });
    }
  }
}

if (violations.length > 0) {
  console.error("\n[ORCH-0852 — i-wallet-stubs-removed] VIOLATIONS:\n");
  for (const v of violations) {
    console.error(`  • ${v.file}\n    ${v.msg}\n`);
  }
  console.error(
    "Wallet pass buttons require Apple Developer Wallet cert + Google Wallet Issuer ID + edge-function pass generation. Until that ships, the buttons stay deleted.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-0852 — i-wallet-stubs-removed] PASS — no wallet-pass affordance strings present in mingla-business/.",
);
process.exit(0);
