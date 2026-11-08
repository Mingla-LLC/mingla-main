/**
 * issue #3645 bundle 2b — every function 20280428003645 re-emits changed by
 * its authorised hunks only (issue_3645_sell_publish_reemit_hunks.ts).
 *
 *   (a) the source migration holds the latest definition before the target;
 *   (b) the target body equals the source body with exactly those hunks;
 *   (c) the target re-emits nothing that is not declared.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applyHunks, definitions } from "./issue_3645_reemit_hunks.ts";
import { SELL_PUBLISH_REEMITS, TARGET } from "./issue_3645_sell_publish_reemit_hunks.ts";

const DIR = "supabase/migrations";
const TARGET_FILE = TARGET.slice(DIR.length + 1);

function before(): string[] {
  return [...Deno.readDirSync(DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".sql") && e.name < TARGET_FILE)
    .map((e) => e.name)
    .sort();
}

for (const reemit of SELL_PUBLISH_REEMITS) {
  Deno.test(`#3645 2b ${reemit.fn}: source is the latest earlier definition`, () => {
    let latest: string | null = null;
    for (const file of before()) {
      if (definitions(Deno.readTextFileSync(`${DIR}/${file}`)).has(reemit.fn)) latest = `${DIR}/${file}`;
    }
    assertEquals(latest, reemit.source);
  });

  Deno.test(`#3645 2b ${reemit.fn}: re-emit differs from its source by the authorised hunks only`, () => {
    const source = definitions(Deno.readTextFileSync(reemit.source)).get(reemit.fn);
    const target = definitions(Deno.readTextFileSync(reemit.target)).get(reemit.fn);
    assert(source !== undefined, `${reemit.fn} missing from ${reemit.source}`);
    assert(target !== undefined, `${reemit.fn} missing from ${reemit.target}`);
    assertEquals(target, applyHunks(source, reemit.hunks));
  });
}

Deno.test("#3645 2b every re-emit in the target is declared", () => {
  const declared = new Set(SELL_PUBLISH_REEMITS.map((r) => r.fn));
  for (const name of definitions(Deno.readTextFileSync(TARGET)).keys()) {
    assert(declared.has(name), `${TARGET} re-emits ${name} without declared hunks`);
  }
  assertEquals(definitions(Deno.readTextFileSync(TARGET)).size, declared.size);
});
