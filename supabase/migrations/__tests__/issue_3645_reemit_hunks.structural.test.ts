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

const DIR = "supabase/migrations";
const FIRST_3645 = "20280201003645";

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
  for (const file of migrationFiles().filter((f) => f.startsWith("2028020") && f.includes("_issue_3645_"))) {
    for (const name of definitions(Deno.readTextFileSync(`${DIR}/${file}`)).keys()) {
      if (before.has(name)) assert(declared.has(name), `${file} re-emits ${name} without declared hunks`);
    }
  }
});
