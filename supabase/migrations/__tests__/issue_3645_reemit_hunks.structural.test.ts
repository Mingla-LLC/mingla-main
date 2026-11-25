/**
 * issue #3645 — Paystack payment plans: every money function the migrations
 * re-emit from its latest definition changed by its authorised hunks only.
 *
 * For each entry in issue_3645_reemit_hunks.ts:
 *   (a) the source migration really holds the latest pre-#3645 definition
 *       (no later migration before the #3645 files redefines the function);
 *   (b) the #3645 body equals the source body with exactly those hunks applied.
 * Reverting or widening any hunk in a migration fails (b).
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applyHunks, definitions, REEMITS } from "./issue_3645_reemit_hunks.ts";
import {
  LATE_REFUND_DEBT_REEMITS,
  LATE_REFUND_DEBT_TARGET,
  PROVIDER_REFUND_TRUTH_REEMITS,
  PROVIDER_REFUND_TRUTH_TARGET,
} from "./issue_3645_late_refund_debt_reemit_hunks.ts";

const DIR = "supabase/migrations";
const FIRST_3645 = "20280201003645";
// Bundle 2b's migration carries its own guard, whose sources are the latest
// definitions before it (issue_3645_sell_publish_reemit_hunks.ts). Every other
// #3645 migration, later ones included, must still declare its hunks here.
const SELL_PUBLISH_TARGET = "20280428003645_issue_3645_sell_publish_integrity.sql";
// Bundle 2c's migration likewise carries its own guard
// (issue_3645_float_forecast_reemit_hunks.ts).
const FLOAT_FORECAST_TARGET = "20280503003645_issue_3645_float_forecast_alerts.sql";
// Bundle 2d's migration likewise carries its own guard
// (issue_3645_debt_return_reemit_hunks.ts).
const DEBT_RETURN_TARGET = "20280508003645_issue_3645_payout_debt_returns.sql";
// Bundle 4's migration likewise carries its own guard
// (issue_3645_ledger_followup_reemit_hunks.ts).
const LEDGER_FOLLOWUP_TARGET = "20280602003645_issue_3645_payout_ledger_followups.sql";
// The payout-gaps migration likewise carries its own guard
// (issue_3645_payout_gaps_reemit_hunks.ts).
const PAYOUT_GAPS_TARGET = "20280809003645_issue_3645_payout_gaps.sql";
const REFUND_REEMITS = new Map([
  [PROVIDER_REFUND_TRUTH_TARGET, PROVIDER_REFUND_TRUTH_REEMITS],
  [LATE_REFUND_DEBT_TARGET, LATE_REFUND_DEBT_REEMITS],
]);

function migrationFiles(): string[] {
  return [...Deno.readDirSync(DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
}

for (const reemit of REEMITS) {
  Deno.test(`#3645 ${reemit.fn}: source is the latest pre-#3645 definition`, () => {
    const sourceName = reemit.sourceFn ?? reemit.fn;
    let latest: string | null = null;
    let renamedIn: string | null = null;
    for (const file of migrationFiles()) {
      if (file >= FIRST_3645) break;
      const text = Deno.readTextFileSync(`${DIR}/${file}`);
      const defs = definitions(text);
      if (reemit.sourceFn !== undefined) {
        // A renamed function: its body is the last definition under the old
        // name before the rename; nothing may define the new name afterwards.
        assert(!defs.has(reemit.fn), `${file} redefines ${reemit.fn}`);
        // The renaming migration re-creates the old name as a new wrapper, so
        // its own definitions come after the rename and do not count.
        if (new RegExp(`RENAME\\s+TO\\s+${reemit.fn}\\b`).test(text)) renamedIn = file;
        if (renamedIn === null && defs.has(sourceName)) latest = `${DIR}/${file}`;
      } else if (defs.has(sourceName)) {
        latest = `${DIR}/${file}`;
      }
    }
    if (reemit.sourceFn !== undefined) assert(renamedIn !== null, `${reemit.fn} rename not found`);
    assertEquals(latest, reemit.source);
  });

  Deno.test(`#3645 ${reemit.fn}: re-emit differs from its source by the authorised hunks only`, () => {
    const source = definitions(Deno.readTextFileSync(reemit.source)).get(reemit.sourceFn ?? reemit.fn);
    const target = definitions(Deno.readTextFileSync(reemit.target)).get(reemit.fn);
    assert(source !== undefined, `${reemit.fn} missing from ${reemit.source}`);
    assert(target !== undefined, `${reemit.fn} missing from ${reemit.target}`);
    assertEquals(target, applyHunks(source, reemit.hunks));
  });
}

Deno.test("#3645 every #3645 re-emit is declared (no undeclared money-function rewrite)", () => {
  const declared = new Set(REEMITS.map((r) => r.fn));
  const before = new Set<string>();
  for (const file of migrationFiles()) {
    if (file >= FIRST_3645) break;
    for (const name of definitions(Deno.readTextFileSync(`${DIR}/${file}`)).keys()) before.add(name);
  }
  for (const file of migrationFiles().filter((f) =>
    (f.startsWith("2028020") || (f >= "20280407003645" && f !== SELL_PUBLISH_TARGET && f !== FLOAT_FORECAST_TARGET &&
      f !== DEBT_RETURN_TARGET && f !== LEDGER_FOLLOWUP_TARGET && f !== PAYOUT_GAPS_TARGET)) &&
    f.includes("_issue_3645_")
  )) {
    const path = `${DIR}/${file}`;
    const refundReemits = REFUND_REEMITS.get(path);
    const allowed = refundReemits ? new Set(refundReemits.map((r) => r.fn)) : declared;
    for (const name of definitions(Deno.readTextFileSync(path)).keys()) {
      if (before.has(name)) {
        assert(allowed.has(name), `${file} re-emits ${name} without declared hunks`);
      }
    }
  }
});

for (const [targetPath, reemits] of REFUND_REEMITS) {
  const targetFile = targetPath.slice(DIR.length + 1);
  Deno.test(`#3645 ${targetFile} re-emits its declared hunks against the latest bodies`, () => {
    const latest = new Map<string, string>();
    for (const file of migrationFiles()) {
      if (file >= targetFile) break;
      const path = `${DIR}/${file}`;
      for (const name of definitions(Deno.readTextFileSync(path)).keys()) latest.set(name, path);
    }

    const target = definitions(Deno.readTextFileSync(targetPath));
    assertEquals(
      [...target.keys()].filter((name) => latest.has(name)).sort(),
      reemits.map(({ fn }) => fn).sort(),
    );
    for (const { fn, source, hunks } of reemits) {
      assertEquals(latest.get(fn), source, `${fn} must use its latest earlier definition`);
      const body = definitions(Deno.readTextFileSync(source)).get(fn);
      assert(body !== undefined, `${fn} missing from ${source}`);
      assertEquals(target.get(fn), applyHunks(body, hunks), `${fn} must match its declared hunks`);
    }
  });
}

Deno.test("#3645 pending dashboard settlement locks the referral share before the order", () => {
  const body = definitions(Deno.readTextFileSync(PROVIDER_REFUND_TRUTH_TARGET))
    .get("biz_refund_order_commit_from_webhook");
  assert(body !== undefined, "missing dashboard refund settlement function");
  const pending = body.match(
    /metadata \? 'provider_pending_dashboard' INTO v_allocate[\s\S]*?IF v_allocate THEN([\s\S]*?)END IF;/,
  )?.[1];
  assert(pending !== undefined, "missing pending dashboard allocation branch");
  const shareLock = pending.search(
    /FROM public\.payee_shares\s+WHERE order_kind = 'ticket' AND order_id = p_order_id AND payee_kind = 'referral'\s+FOR UPDATE;/,
  );
  const orderLock = pending.search(/FROM public\.orders\s+WHERE id = p_order_id FOR NO KEY UPDATE;/);
  assert(shareLock >= 0 && orderLock > shareLock, "referral lock must precede the order lock");
});
