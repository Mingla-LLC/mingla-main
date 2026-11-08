/**
 * issue #3645 bundle 2c — every function 20280503003645 re-emits changed by
 * its authorised hunks only (issue_3645_float_forecast_reemit_hunks.ts).
 *
 *   (a) the source migration holds the latest definition before the target;
 *   (b) the target body equals the source body with exactly those hunks;
 *   (c) the target defines nothing else except its two new functions, and
 *       those are new (no earlier migration defines them);
 *   (d) the target is still the latest definition of everything it defines,
 *       so a later migration cannot silently replace a 2c body.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applyHunks, definitions } from "./issue_3645_reemit_hunks.ts";
import {
  FLOAT_FORECAST_NEW_FUNCTIONS,
  FLOAT_FORECAST_REEMITS,
  TARGET,
} from "./issue_3645_float_forecast_reemit_hunks.ts";

const DIR = "supabase/migrations";
const TARGET_FILE = TARGET.slice(DIR.length + 1);

function files(): string[] {
  return [...Deno.readDirSync(DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
}

for (const reemit of FLOAT_FORECAST_REEMITS) {
  Deno.test(`#3645 2c ${reemit.fn}: source is the latest earlier definition`, () => {
    let latest: string | null = null;
    for (const file of files().filter((f) => f < TARGET_FILE)) {
      if (definitions(Deno.readTextFileSync(`${DIR}/${file}`)).has(reemit.fn)) latest = `${DIR}/${file}`;
    }
    assertEquals(latest, reemit.source);
  });

  Deno.test(`#3645 2c ${reemit.fn}: re-emit differs from its source by the authorised hunks only`, () => {
    const source = definitions(Deno.readTextFileSync(reemit.source)).get(reemit.fn);
    const target = definitions(Deno.readTextFileSync(reemit.target)).get(reemit.fn);
    assert(source !== undefined, `${reemit.fn} missing from ${reemit.source}`);
    assert(target !== undefined, `${reemit.fn} missing from ${reemit.target}`);
    assertEquals(target, applyHunks(source, reemit.hunks));
  });
}

Deno.test("#3645 2c the target defines only its declared re-emits and new functions", () => {
  const declared = new Set([
    ...FLOAT_FORECAST_REEMITS.map((r) => r.fn),
    ...FLOAT_FORECAST_NEW_FUNCTIONS,
  ]);
  const defined = [...definitions(Deno.readTextFileSync(TARGET)).keys()];
  for (const name of defined) {
    assert(declared.has(name), `${TARGET} defines ${name} without declaring it`);
  }
  assertEquals(defined.length, declared.size);
  for (const file of files().filter((f) => f < TARGET_FILE)) {
    const earlier = definitions(Deno.readTextFileSync(`${DIR}/${file}`));
    for (const name of FLOAT_FORECAST_NEW_FUNCTIONS) {
      assert(!earlier.has(name), `${file} already defines ${name}, so 2c re-emits it`);
    }
  }
});

Deno.test("#3645 2c the target is still the latest definition of what it defines", () => {
  const mine = [...definitions(Deno.readTextFileSync(TARGET)).keys()];
  for (const file of files().filter((f) => f > TARGET_FILE)) {
    const later = definitions(Deno.readTextFileSync(`${DIR}/${file}`));
    for (const name of mine) {
      assert(
        !later.has(name),
        `${file} redefines ${name}; declare its hunks against ${TARGET_FILE} in its own guard`,
      );
    }
  }
});
