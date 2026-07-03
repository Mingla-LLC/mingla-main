#!/usr/bin/env node
/**
 * ORCH-1283 — I-PROPOSED-1283-NO-RCS-TAB (DRAFT until CLOSE).
 *
 * Rule: the marketing composer channel selector exposes exactly {email, sms}.
 *   (1) ChannelTabs.tsx: the TABS array + MarketingChannelKind carry NO `rcs`
 *       (email + sms literals kept), AND
 *   (2) the ORCH-0815-B gate (orch-0815-b-composer-and-send.mjs) contains NO
 *       assertion requiring the `rcs` literal (its email + sms assertions kept).
 *
 * Mirrors the modular self-testing gate pattern (sibling:
 * i-proposed-1270-send-idempotent.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CHANNEL_TABS = "mingla-business/src/components/marketing/ChannelTabs.tsx";
const GATE = ".github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs";

const stripLineComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const evaluateTabs = (rawCode) => {
  const code = stripLineComments(rawCode);
  const failures = [];
  if (/kind:\s*["']rcs["']/.test(code)) {
    failures.push(
      `${CHANNEL_TABS}: a TABS entry with kind: "rcs" is back — the dead RCS tab must stay removed. I-PROPOSED-1283-NO-RCS-TAB.`,
    );
  }
  if (/MarketingChannelKind[^;]*["']rcs["']/.test(code)) {
    failures.push(
      `${CHANNEL_TABS}: MarketingChannelKind must be "email" | "sms" — no "rcs". I-PROPOSED-1283-NO-RCS-TAB.`,
    );
  }
  if (!/kind:\s*["']email["']/.test(code)) {
    failures.push(`${CHANNEL_TABS}: the email tab literal must remain. I-PROPOSED-1283-NO-RCS-TAB.`);
  }
  if (!/kind:\s*["']sms["']/.test(code)) {
    failures.push(`${CHANNEL_TABS}: the sms tab literal must remain. I-PROPOSED-1283-NO-RCS-TAB.`);
  }
  return failures;
};

const evaluateGate = (rawCode) => {
  const code = stripLineComments(rawCode);
  const failures = [];
  // The two removed rcs assertions must not reappear (fail-message substrings
  // only exist inside the active fail() calls).
  if (/missing rcs case/.test(code)) {
    failures.push(
      `${GATE}: the "missing rcs case" assertion is back — the 2-channel gate must not require the rcs literal. I-PROPOSED-1283-NO-RCS-TAB.`,
    );
  }
  if (/literal `?rcs`? tab missing/.test(code)) {
    failures.push(
      `${GATE}: the "literal rcs tab missing" assertion is back — the 2-channel gate must not require the rcs literal. I-PROPOSED-1283-NO-RCS-TAB.`,
    );
  }
  // The email + sms assertions MUST be kept.
  if (!/missing email case/.test(code)) {
    failures.push(`${GATE}: the email-case assertion must be kept. I-PROPOSED-1283-NO-RCS-TAB.`);
  }
  if (!/missing sms case/.test(code)) {
    failures.push(`${GATE}: the sms-case assertion must be kept. I-PROPOSED-1283-NO-RCS-TAB.`);
  }
  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  const TABS_GOOD = `
    export type MarketingChannelKind = "email" | "sms";
    const TABS = [
      { kind: "email", label: "Email", enabled: true, caption: "" },
      { kind: "sms", label: "SMS", enabled: true, caption: "" },
    ];
  `;
  // BAD_A: the rcs tab is re-added.
  const TABS_BAD_A = `
    export type MarketingChannelKind = "email" | "sms" | "rcs";
    const TABS = [
      { kind: "email", label: "Email", enabled: true, caption: "" },
      { kind: "sms", label: "SMS", enabled: true, caption: "" },
      { kind: "rcs", label: "RCS", enabled: false, caption: "pending" },
    ];
  `;
  const GATE_GOOD = `
    if (!/case\\s+["']email["']/.test(src)) fail("check-1", X, "missing email case");
    if (!/case\\s+["']sms["']/.test(src)) fail("check-1", X, "missing sms case");
    if (!/kind:\\s*["']email["']/.test(src)) fail("check-2", Y, "literal email tab missing");
    if (!/kind:\\s*["']sms["']/.test(src)) fail("check-2", Y, "literal sms tab missing");
  `;
  // BAD_B: the rcs assertions are re-added.
  const GATE_BAD_B = GATE_GOOD +
    '\n    if (!/case\\s+["\']rcs["\']/.test(src)) fail("check-1", X, "missing rcs case");' +
    '\n    if (!/kind:\\s*["\']rcs["\']/.test(src)) fail("check-2", Y, "literal rcs tab missing");';

  const tg = evaluateTabs(TABS_GOOD), ta = evaluateTabs(TABS_BAD_A);
  const gg = evaluateGate(GATE_GOOD), gb = evaluateGate(GATE_BAD_B);
  const ok = tg.length === 0 && ta.length >= 1 && gg.length === 0 && gb.length >= 1;
  if (!ok) {
    console.error("ORCH-1283 no-rcs-tab SELF-TEST failed:", { tg, ta, gg, gb });
    process.exit(1);
  }
  console.log("ORCH-1283 no-rcs-tab gate self-test passed.");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];
const tabsAbs = join(root, CHANNEL_TABS);
const gateAbs = join(root, GATE);
if (!existsSync(tabsAbs)) failures.push(`${CHANNEL_TABS}: not found.`);
else failures.push(...evaluateTabs(readFileSync(tabsAbs, "utf8")));
if (!existsSync(gateAbs)) failures.push(`${GATE}: not found.`);
else failures.push(...evaluateGate(readFileSync(gateAbs, "utf8")));

if (failures.length > 0) {
  console.error("ORCH-1283 no-rcs-tab gate FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ORCH-1283 no-rcs-tab gate passed.");
