/**
 * issue #3645 bundle 4 follow-up — 20280603003645 re-emits two functions from
 * 20280602003645 changed by its authorised hunks only
 * (issue_3645_ledger_followup_round3_reemit_hunks.ts).
 *
 *   (a) the source migration holds the latest definition before the target;
 *   (b) the target body equals the source body with exactly those hunks;
 *   (c) the target defines nothing else;
 *   (d) the target is still the latest definition of everything it defines.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applyHunks, definitions } from "./issue_3645_reemit_hunks.ts";
import {
  ROUND3_PRIVATE_REEMITS,
  ROUND3_REEMITS,
  TARGET,
} from "./issue_3645_ledger_followup_round3_reemit_hunks.ts";

const DIR = "supabase/migrations";
const TARGET_FILE = TARGET.slice(DIR.length + 1);

function files(): string[] {
  return [...Deno.readDirSync(DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
}

function privateDefinitions(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  const head = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+private\.([A-Za-z0-9_]+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = head.exec(sql)) !== null) {
    const tag = /\bAS\s+(\$[A-Za-z0-9_]*\$)/g;
    tag.lastIndex = match.index;
    const t = tag.exec(sql);
    if (t === null) continue;
    const end = sql.indexOf(t[1], t.index + t[0].length);
    if (end < 0) continue;
    out.set(match[1].toLowerCase(), sql.slice(match.index, end + t[1].length));
    head.lastIndex = end + t[1].length;
  }
  return out;
}

const KINDS = [
  { label: "", reemits: ROUND3_REEMITS, read: definitions },
  { label: "private.", reemits: ROUND3_PRIVATE_REEMITS, read: privateDefinitions },
];

for (const { label, reemits, read } of KINDS) {
  for (const reemit of reemits) {
    Deno.test(`#3645 bundle 4 follow-up ${label}${reemit.fn}: source is the latest earlier definition`, () => {
      let latest: string | null = null;
      for (const file of files().filter((f) => f < TARGET_FILE)) {
        if (read(Deno.readTextFileSync(`${DIR}/${file}`)).has(reemit.fn)) latest = `${DIR}/${file}`;
      }
      assertEquals(latest, reemit.source);
    });

    Deno.test(`#3645 bundle 4 follow-up ${label}${reemit.fn}: re-emit differs from its source by the authorised hunks only`, () => {
      const source = read(Deno.readTextFileSync(reemit.source)).get(reemit.fn);
      const target = read(Deno.readTextFileSync(reemit.target)).get(reemit.fn);
      assert(source !== undefined, `${reemit.fn} missing from ${reemit.source}`);
      assert(target !== undefined, `${reemit.fn} missing from ${reemit.target}`);
      assertEquals(target, applyHunks(source, reemit.hunks));
    });
  }

  Deno.test(`#3645 bundle 4 follow-up defines only its declared ${label || "public "}re-emits, and nothing later redefines them`, () => {
    const mine = [...read(Deno.readTextFileSync(TARGET)).keys()].sort();
    assertEquals(mine, reemits.map((r) => r.fn).sort());
    for (const file of files().filter((f) => f > TARGET_FILE)) {
      const later = read(Deno.readTextFileSync(`${DIR}/${file}`));
      for (const name of mine) {
        assert(!later.has(name), `${file} redefines ${label}${name}; declare its hunks against ${TARGET_FILE}`);
      }
    }
  });
}
