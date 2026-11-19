#!/usr/bin/env node
/**
 * #3645 — a checkout never guesses a brand's payout-hold stamp.
 *
 * brands.payout_hold_cutover_at decides who is paid at charge time: an
 * unstamped brand with a subaccount splits the charge to the organiser, a
 * stamped brand settles to Mingla and the payout sweep pays the organiser
 * later. Treating a failed read as "unstamped" split a stamped brand's sale at
 * charge time AND left it for the sweep, which paid the organiser again.
 *
 * Every edge-function file that reads the stamp must:
 *   R1 read it only inside a `.select(...)` (no property reads such as
 *      `row?.payout_hold_cutover_at` that turn a failed read into null);
 *   R2 hand that read to payoutHoldStampFromRead (or use
 *      readBrandPayoutHoldStamp, which does both);
 *   R3 refuse (`if (!stamp.ok) ... return`) right after every stamp decision.
 * Reviewed exceptions are listed in ALLOWED with the reason.
 */
// MINGLA-INVARIANT: I-3645-STAMP-FAIL-CLOSED | issue #3645 | A failed payout-hold stamp read refuses the checkout; it is never read as unstamped.

import fs from "node:fs";
import path from "node:path";

const FIELD = "payout_hold_cutover_at";

export const ALLOWED = new Map([
  ["supabase/functions/_shared/payoutHoldStamp.ts", "the one stamp reader"],
  ["supabase/functions/_shared/partnerSplits.ts", "throws on a read error"],
  ["supabase/functions/_shared/paystackPartnerSplits.ts", "throws on a read error"],
  ["supabase/functions/admin-payout-hold-migrate/index.ts", "the admin tool that sets the stamp; never charges"],
  [
    "supabase/functions/_shared/installments/chargePaystackInstallment.ts",
    "reads the stamp inside the instalment load; any read error fails the whole charge",
  ],
]);

/** Blanks comments so prose never counts as a read. Keeps offsets. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));
}

export function stampFailures(name, rawSource) {
  const source = stripComments(rawSource);
  const failures = [];
  // R1 + R2: every mention is a select argument handed to the stamp reader.
  let at = source.indexOf(FIELD);
  while (at >= 0) {
    const before = source.slice(Math.max(0, at - 120), at);
    const select = before.lastIndexOf(".select(");
    const inSelect = select >= 0 && !/[);]/.test(before.slice(select + ".select(".length));
    if (!inSelect) {
      failures.push(`${name}: reads ${FIELD} outside a .select() (R1) near offset ${at}`);
    } else {
      const window = source.slice(Math.max(0, at - 400), at + 400);
      if (!window.includes("payoutHoldStampFromRead(")) {
        failures.push(`${name}: a ${FIELD} read is not handed to payoutHoldStampFromRead (R2) near offset ${at}`);
      }
    }
    at = source.indexOf(FIELD, at + FIELD.length);
  }
  // R3: every stamp decision refuses on a failed read.
  const call = /const\s+(\w+)\s*=\s*(?:await\s+)?(?:readBrandPayoutHoldStamp|payoutHoldStampFromRead)\(/g;
  let match;
  while ((match = call.exec(source)) !== null) {
    const after = source.slice(match.index, match.index + 900);
    const guard = after.indexOf(`if (!${match[1]}.ok)`);
    if (guard < 0 || !/\breturn\b/.test(after.slice(guard, guard + 260))) {
      failures.push(`${name}: ${match[1]} is used without refusing on a failed read (R3)`);
    }
  }
  return failures;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

if (process.argv.includes("--self-test")) {
  const good = stampFailures("good.ts", `
    const stamp = await readBrandPayoutHoldStamp(supabase, brandId, "x");
    if (!stamp.ok) return fail("payout_settings_unavailable");
    const read = await supabase.from("brands").select("payout_hold_cutover_at").eq("id", id).maybeSingle();
    const s2 = payoutHoldStampFromRead(read, "x");
    if (!s2.ok) {
      return jsonResponse({ error: "payout_settings_unavailable" }, 503);
    }
    // a comment naming payout_hold_cutover_at is fine
  `);
  const failOpen = stampFailures("fail-open.ts", `
    const { data: cutoverRow, error: cutoverErr } = await supabase
      .from("brands").select("payout_hold_cutover_at").eq("id", brandId).maybeSingle();
    if (cutoverErr) console.error("treating as unstamped", cutoverErr);
    const isCutover = (cutoverRow?.payout_hold_cutover_at ?? null) !== null;
  `);
  const ignored = stampFailures("ignored.ts", `
    const { data: cutoverRow } = await supabase.from("brands").select("payout_hold_cutover_at").maybeSingle();
  `);
  const noRefusal = stampFailures("no-refusal.ts", `
    const stamp = await readBrandPayoutHoldStamp(supabase, brandId, "x");
    const isCutover = stamp.ok && stamp.isCutover;
  `);
  const cases = [
    ["guarded reads pass", good.length === 0],
    ["a fail-open raw read fails R1 and R2", failOpen.length >= 2],
    ["an ignored read error fails R2", ignored.length === 1],
    ["a stamp without a refusal fails R3", noRefusal.length === 1],
  ];
  const bad = cases.filter(([, ok]) => !ok);
  if (bad.length) {
    console.error("#3645 payout-hold-stamp-fail-closed self-test FAILED: " + bad.map(([n]) => n).join(", "));
    process.exit(1);
  }
  console.log(`#3645 payout-hold-stamp-fail-closed self-test PASS (${cases.length}/${cases.length} cases).`);
  process.exit(0);
}

const root = process.cwd();
const failures = [];
let checked = 0;
for (const file of walk(path.join(root, "supabase/functions"), [])) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes(FIELD) && !/readBrandPayoutHoldStamp|payoutHoldStampFromRead/.test(source)) continue;
  if (ALLOWED.has(rel)) continue;
  checked++;
  failures.push(...stampFailures(rel, source));
}
if (failures.length) {
  console.error("#3645 payout-hold-stamp-fail-closed gate FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log(`#3645 payout-hold-stamp-fail-closed gate PASS (${checked} files).`);
