/**
 * issue #3645 bundle 2d — every function 20280508003645 re-emits changed by
 * its authorised hunks only (issue_3645_debt_return_reemit_hunks.ts).
 *
 *   (a) the source migration holds the latest definition before the target;
 *   (b) the target body equals the source body with exactly those hunks;
 *   (c) the target defines nothing else except its new functions, and
 *       those are new (no earlier migration defines them);
 *   (d) the target is still the latest definition of everything it defines,
 *       so a later migration cannot silently replace a 2d body;
 *   (e) every 2d caller that writes a release's net goes through settle
 *       (return the unrecovered debt, then project); only the planner's
 *       failure fallback may call the plain projection.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applyHunks, definitions } from "./issue_3645_reemit_hunks.ts";
import { LEDGER_FOLLOWUP_REEMITS } from "./issue_3645_ledger_followup_reemit_hunks.ts";
import {
  DEBT_RETURN_NEW_FUNCTIONS,
  DEBT_RETURN_REEMITS,
  TARGET,
} from "./issue_3645_debt_return_reemit_hunks.ts";

const DIR = "supabase/migrations";
const TARGET_FILE = TARGET.slice(DIR.length + 1);

function files(): string[] {
  return [...Deno.readDirSync(DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
}

for (const reemit of DEBT_RETURN_REEMITS) {
  Deno.test(`#3645 2d ${reemit.fn}: source is the latest earlier definition`, () => {
    let latest: string | null = null;
    for (const file of files().filter((f) => f < TARGET_FILE)) {
      if (definitions(Deno.readTextFileSync(`${DIR}/${file}`)).has(reemit.fn)) latest = `${DIR}/${file}`;
    }
    assertEquals(latest, reemit.source);
  });

  Deno.test(`#3645 2d ${reemit.fn}: re-emit differs from its source by the authorised hunks only`, () => {
    const source = definitions(Deno.readTextFileSync(reemit.source)).get(reemit.fn);
    const target = definitions(Deno.readTextFileSync(reemit.target)).get(reemit.fn);
    assert(source !== undefined, `${reemit.fn} missing from ${reemit.source}`);
    assert(target !== undefined, `${reemit.fn} missing from ${reemit.target}`);
    assertEquals(target, applyHunks(source, reemit.hunks));
  });
}

Deno.test("#3645 2d the target defines only its declared re-emits and new functions", () => {
  const declared = new Set([
    ...DEBT_RETURN_REEMITS.map((r) => r.fn),
    ...DEBT_RETURN_NEW_FUNCTIONS,
  ]);
  const defined = [...definitions(Deno.readTextFileSync(TARGET)).keys()];
  for (const name of defined) {
    assert(declared.has(name), `${TARGET} defines ${name} without declaring it`);
  }
  assertEquals(defined.length, declared.size);
  for (const file of files().filter((f) => f < TARGET_FILE)) {
    const earlier = definitions(Deno.readTextFileSync(`${DIR}/${file}`));
    for (const name of DEBT_RETURN_NEW_FUNCTIONS) {
      assert(!earlier.has(name), `${file} already defines ${name}, so 2d re-emits it`);
    }
  }
});

Deno.test("#3645 2d the target is still the latest definition of what it defines", () => {
  const mine = [...definitions(Deno.readTextFileSync(TARGET)).keys()];
  for (const file of files().filter((f) => f > TARGET_FILE)) {
    const later = definitions(Deno.readTextFileSync(`${DIR}/${file}`));
    for (const name of mine) {
      // A later bundle may supersede a 2d body only through its own guard,
      // which declares its hunks against this target.
      const superseded = LEDGER_FOLLOWUP_REEMITS.some((r) =>
        r.target === `${DIR}/${file}` && r.fn === name && r.source === TARGET
      );
      assert(
        !later.has(name) || superseded,
        `${file} redefines ${name}; declare its hunks against ${TARGET_FILE} in its own guard`,
      );
    }
  }
});

Deno.test("#3645 2d every caller that writes a release's net settles first", () => {
  const defs = definitions(Deno.readTextFileSync(TARGET));
  for (const fn of [
    "issue_3645_refresh_stay_release_projection",
    "refresh_paystack_dispute_release_projection",
    "plan_pending_payout_partner_legs",
  ]) {
    const body = defs.get(fn);
    assert(body !== undefined, `${fn} missing from ${TARGET}`);
    const settles = body.split("public.issue_3645_settle_release_projection(").length - 1;
    const plain = body.split("public.issue_3645_release_projected_totals(").length - 1;
    assertEquals(settles, 1, `${fn} must settle exactly once`);
    if (fn === "plan_pending_payout_partner_legs") {
      // Only inside the EXCEPTION fallback, after the settle attempt.
      assertEquals(plain, 1, `${fn} plain projection outside its fallback`);
      assert(
        body.indexOf("EXCEPTION WHEN OTHERS") < body.indexOf("public.issue_3645_release_projected_totals("),
        `${fn} calls the plain projection before its settle`,
      );
    } else {
      assertEquals(plain, 0, `${fn} projects without settling`);
    }
  }
});
