/**
 * issue #3645 bundle 4 — every function 20280602003645 re-emits changed by
 * its authorised hunks only (issue_3645_ledger_followup_reemit_hunks.ts).
 *
 *   (a) the source migration holds the latest definition before the target;
 *   (b) the target body equals the source body with exactly those hunks;
 *   (c) the target defines nothing else except its new functions, and
 *       those are new (no earlier migration defines them);
 *   (d) the target is still the latest definition of everything it defines,
 *       except what a later migration re-emits through its own declared
 *       hunks (issue_3645_ledger_followup_round3_reemit_hunks.ts);
 *   (e) maturity books no recredit of its own: matured value it cannot hand
 *       back through net is always carried.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applyHunks, definitions } from "./issue_3645_reemit_hunks.ts";
import {
  LEDGER_FOLLOWUP_NEW_FUNCTIONS,
  LEDGER_FOLLOWUP_PRIVATE_REEMITS,
  LEDGER_FOLLOWUP_REEMITS,
  TARGET,
} from "./issue_3645_ledger_followup_reemit_hunks.ts";
import {
  ROUND3_PRIVATE_REEMITS,
  ROUND3_REEMITS,
} from "./issue_3645_ledger_followup_round3_reemit_hunks.ts";

const DIR = "supabase/migrations";
const TARGET_FILE = TARGET.slice(DIR.length + 1);

function files(): string[] {
  return [...Deno.readDirSync(DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
}

for (const reemit of LEDGER_FOLLOWUP_REEMITS) {
  Deno.test(`#3645 bundle 4 ${reemit.fn}: source is the latest earlier definition`, () => {
    let latest: string | null = null;
    for (const file of files().filter((f) => f < TARGET_FILE)) {
      if (definitions(Deno.readTextFileSync(`${DIR}/${file}`)).has(reemit.fn)) latest = `${DIR}/${file}`;
    }
    assertEquals(latest, reemit.source);
  });

  Deno.test(`#3645 bundle 4 ${reemit.fn}: re-emit differs from its source by the authorised hunks only`, () => {
    const source = definitions(Deno.readTextFileSync(reemit.source)).get(reemit.fn);
    const target = definitions(Deno.readTextFileSync(reemit.target)).get(reemit.fn);
    assert(source !== undefined, `${reemit.fn} missing from ${reemit.source}`);
    assert(target !== undefined, `${reemit.fn} missing from ${reemit.target}`);
    assertEquals(target, applyHunks(source, reemit.hunks));
  });
}

Deno.test("#3645 bundle 4 the target defines only its declared re-emits and new functions", () => {
  const declared = new Set([
    ...LEDGER_FOLLOWUP_REEMITS.map((r) => r.fn),
    ...LEDGER_FOLLOWUP_NEW_FUNCTIONS,
  ]);
  const defined = [...definitions(Deno.readTextFileSync(TARGET)).keys()];
  for (const name of defined) {
    assert(declared.has(name), `${TARGET} defines ${name} without declaring it`);
  }
  assertEquals(defined.length, declared.size);
  for (const file of files().filter((f) => f < TARGET_FILE)) {
    const earlier = definitions(Deno.readTextFileSync(`${DIR}/${file}`));
    for (const name of LEDGER_FOLLOWUP_NEW_FUNCTIONS) {
      assert(!earlier.has(name), `${file} already defines ${name}, so bundle 4 re-emits it`);
    }
  }
});

Deno.test("#3645 bundle 4 the target is still the latest definition of what it defines", () => {
  const mine = [...definitions(Deno.readTextFileSync(TARGET)).keys()];
  for (const file of files().filter((f) => f > TARGET_FILE)) {
    const later = definitions(Deno.readTextFileSync(`${DIR}/${file}`));
    for (const name of mine) {
      const superseded = ROUND3_REEMITS.some((r) =>
        r.fn === name && r.target === `${DIR}/${file}`
      );
      assert(
        superseded || !later.has(name),
        `${file} redefines ${name}; declare its hunks against ${TARGET_FILE} in its own guard`,
      );
    }
  }
});

Deno.test("#3645 bundle 4 maturity carries only off a paid release, and its new steps never stop the sweep", () => {
  const body = definitions(Deno.readTextFileSync(TARGET)).get("mature_postponement_debts");
  assert(body !== undefined);
  // v_carry starts at 0 and is only raised inside the paid-release branch;
  // the carryover is written only when it is positive, and only the rest is
  // booked as 2d's recredit.
  const zero = body.indexOf("v_carry:=0;");
  const paid = body.indexOf("IF v_source.status IN ('released','fee_unreconciled') THEN");
  const raise = body.indexOf("v_carry:=greatest(");
  const paidEnd = body.indexOf("END IF;", raise);
  const carryIf = body.indexOf("IF v_carry>0 THEN");
  const carry = body.indexOf("INSERT INTO public.payout_maturity_carryovers(");
  const restIf = body.indexOf("IF v_recredit-v_carry>0 THEN");
  const recredit = body.indexOf("'postpone-recredit:'");
  assert(zero > 0 && paid > zero && raise > paid && paidEnd > raise, "the carry is not limited to a paid release");
  assertEquals(body.split("v_carry:=").length - 1, 2, "v_carry is set outside the paid branch");
  assert(carryIf > paidEnd && carry > carryIf && restIf > carry && recredit > restIf, "carry and recredit are not split");
  assertEquals(body.split("'postpone-recredit:'").length - 1, 1);
  assert(
    body.indexOf("public.issue_3645_return_closed_release_debt(") <
      body.indexOf("FOR v_debt IN"),
    "closed releases must hand back before maturity reads what is withheld",
  );
  assert(
    !body.includes("issue_3645_place_maturity_carryovers"),
    "maturity must not place carried value: only the claims do, under their lock",
  );
  // Each new step runs in its own exception block, so a failure in it never
  // aborts maturity or the dark sweep that calls it.
  for (const fn of ["issue_3645_return_closed_release_debt"]) {
    const at = body.indexOf(`PERFORM public.${fn}(`);
    const block = body.lastIndexOf("BEGIN\n", at);
    const handler = body.indexOf("EXCEPTION WHEN OTHERS THEN", at);
    assert(block > 0 && handler > at && handler - at < 120, `${fn} is not isolated`);
  }
});

Deno.test("#3645 bundle 4 each claim locks, places its own provider's carried value, then reads recredits", () => {
  const defs = definitions(Deno.readTextFileSync(TARGET));
  for (const [fn, provider] of [
    ["claim_paystack_payout_releases", "paystack"],
    ["claim_stripe_payout_releases", "stripe"],
  ]) {
    const body = defs.get(fn);
    assert(body !== undefined, `${fn} missing`);
    const lock = body.indexOf(`pg_advisory_xact_lock(hashtextextended('issue_3645_claim:${provider}', 0))`);
    const place = body.indexOf(`PERFORM public.issue_3645_place_maturity_carryovers(p_now, '${provider}');`);
    const handler = body.indexOf("EXCEPTION WHEN OTHERS THEN", place);
    const read = body.indexOf("RETURN QUERY");
    assert(lock > 0 && place > lock && handler > place && read > handler, `${fn}: lock, place, then read`);
    assertEquals(body.split("issue_3645_place_maturity_carryovers(").length - 1, 1);
  }
});

function privateDefinition(sql: string, fn: string): string | undefined {
  const head = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+private\\.${fn}\\s*\\(`);
  const match = head.exec(sql);
  if (match === null) return undefined;
  const tag = /\bAS\s+(\$[A-Za-z0-9_]*\$)/g;
  tag.lastIndex = match.index;
  const t = tag.exec(sql);
  if (t === null) return undefined;
  const end = sql.indexOf(t[1], t.index + t[0].length);
  return sql.slice(match.index, end + t[1].length);
}

for (const reemit of LEDGER_FOLLOWUP_PRIVATE_REEMITS) {
  Deno.test(`#3645 bundle 4 private.${reemit.fn}: latest earlier definition, re-emitted by its hunks only, not redefined later`, () => {
    let latest: string | null = null;
    for (const file of files()) {
      const defined = privateDefinition(Deno.readTextFileSync(`${DIR}/${file}`), reemit.fn) !== undefined;
      if (file < TARGET_FILE && defined) latest = `${DIR}/${file}`;
      const superseded = ROUND3_PRIVATE_REEMITS.some((r) =>
        r.fn === reemit.fn && r.target === `${DIR}/${file}`
      );
      if (file > TARGET_FILE) assert(superseded || !defined, `${file} redefines private.${reemit.fn}`);
    }
    assertEquals(latest, reemit.source);
    const source = privateDefinition(Deno.readTextFileSync(reemit.source), reemit.fn);
    const target = privateDefinition(Deno.readTextFileSync(reemit.target), reemit.fn);
    assert(source !== undefined && target !== undefined);
    assertEquals(target, applyHunks(source, reemit.hunks));
  });
}
