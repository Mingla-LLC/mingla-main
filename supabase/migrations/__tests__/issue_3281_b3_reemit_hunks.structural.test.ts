/**
 * issue #3281 bundle 3 — every function 20280523003281 re-emits changed by
 * its authorised hunks only (issue_3281_b3_reemit_hunks.ts).
 *
 *   (a) the source migration holds the latest definition before the target;
 *   (b) the target body equals the source body with exactly those hunks;
 *   (c) the target re-emits nothing that is not declared;
 *   (d) the target's drift guard pins each source body's md5.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { applyHunks, definitions } from "./issue_3645_reemit_hunks.ts";
import { B3_REEMITS, TARGET } from "./issue_3281_b3_reemit_hunks.ts";

const DIR = "supabase/migrations";
const TARGET_FILE = TARGET.slice(DIR.length + 1);

function before(): string[] {
  return [...Deno.readDirSync(DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".sql") && e.name < TARGET_FILE)
    .map((e) => e.name)
    .sort();
}

async function md5(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("MD5", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function prosrc(definition: string): string {
  const tag = /\bAS\s+(\$[A-Za-z0-9_]*\$)/.exec(definition);
  assert(tag !== null);
  return definition.slice(tag.index + tag[0].length, definition.lastIndexOf(tag[1]));
}

for (const reemit of B3_REEMITS) {
  Deno.test(`#3281 b3 ${reemit.fn}: source is the latest earlier definition`, () => {
    let latest: string | null = null;
    for (const file of before()) {
      if (definitions(Deno.readTextFileSync(`${DIR}/${file}`)).has(reemit.fn)) latest = `${DIR}/${file}`;
    }
    assertEquals(latest, reemit.source);
  });

  Deno.test(`#3281 b3 ${reemit.fn}: re-emit differs from its source by the authorised hunks only`, () => {
    const source = definitions(Deno.readTextFileSync(reemit.source)).get(reemit.fn);
    const target = definitions(Deno.readTextFileSync(reemit.target)).get(reemit.fn);
    assert(source !== undefined, `${reemit.fn} missing from ${reemit.source}`);
    assert(target !== undefined, `${reemit.fn} missing from ${reemit.target}`);
    assertEquals(target, applyHunks(source, reemit.hunks));
  });

  Deno.test(`#3281 b3 ${reemit.fn}: the drift guard pins the source body`, async () => {
    const source = definitions(Deno.readTextFileSync(reemit.source)).get(reemit.fn);
    assert(source !== undefined);
    const sql = Deno.readTextFileSync(TARGET);
    const pin = new RegExp(`\\('public\\.${reemit.fn}\\([^)]*\\)', '([0-9a-f]{32})'\\)`).exec(sql);
    assert(pin !== null, `${reemit.fn} has no drift-guard row`);
    assertEquals(pin[1], await md5(prosrc(source)));
  });
}

Deno.test("#3281 b3 every re-emit in the target is declared", () => {
  const declared = new Set(B3_REEMITS.map((r) => r.fn));
  for (const name of definitions(Deno.readTextFileSync(TARGET)).keys()) {
    assert(declared.has(name), `${TARGET} re-emits ${name} without declared hunks`);
  }
  assertEquals(definitions(Deno.readTextFileSync(TARGET)).size, declared.size);
});
