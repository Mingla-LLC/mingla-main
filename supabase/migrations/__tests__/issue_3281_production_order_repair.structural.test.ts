/**
 * issue #3281 — production applied these migrations out of file order, so every
 * function the pending files define must end on the same body in both orders.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const DIR = "supabase/migrations";
const REPAIR = "20280217003281";
const PENDING = [
  "20271026003801",
  "20271213003645",
  "20271217003281",
  "20271222003281",
  "20271224003281",
  "20280213003281",
  "20280214003281",
  "20280215003281",
  "20280216003281",
  "20280216003282",
  "20280216004203",
];

const files = [...Deno.readDirSync(DIR)]
  .map((entry) => entry.name)
  .filter((name) => name.endsWith(".sql"))
  .sort();

function definitions(name: string): Map<string, string> {
  const text = Deno.readTextFileSync(`${DIR}/${name}`);
  const found = new Map<string, string>();
  const header =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(public\.[a-z0-9_]+)\s*\(/gi;
  for (const match of text.matchAll(header)) {
    const start = match.index ?? 0;
    const tag = text.slice(start).match(/\bAS\s+(\$[a-zA-Z_]*\$)/)?.[1];
    if (tag === undefined) continue;
    const open = text.indexOf(tag, start);
    const close = text.indexOf(tag, open + tag.length);
    found.set(match[1].toLowerCase(), text.slice(start, close).trim());
  }
  return found;
}

function lastBodies(order: string[]): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const name of order) {
    for (const [fn, body] of definitions(name)) bodies.set(fn, body);
  }
  return bodies;
}

const isPending = (name: string) =>
  PENDING.some((version) => name.startsWith(version)) ||
  name.startsWith(REPAIR);
const productionOrder = (repair: boolean) => [
  ...files.filter((name) => !isPending(name)),
  ...files.filter((name) =>
    isPending(name) && (repair || !name.startsWith(REPAIR))
  ),
];

function differing(order: string[]): string[] {
  const inFileOrder = lastBodies(files);
  const inOrder = lastBodies(order);
  return [...inFileOrder.keys()]
    .filter((fn) => inFileOrder.get(fn) !== inOrder.get(fn))
    .sort();
}

Deno.test("every pending migration still exists", () => {
  for (const version of [...PENDING, REPAIR]) {
    assert(
      files.some((name) => name.startsWith(version)),
      `${version} is missing`,
    );
  }
});

Deno.test("production order reaches the same function bodies as file order", () => {
  assertEquals(differing(productionOrder(true)), []);
});

Deno.test("this repair is what closes the gap", () => {
  assertEquals(differing(productionOrder(false)), [
    "public.biz_update_live_experience",
    "public.issue_3872_ticket_quote",
    "public.pg_notify_reminders_enqueue",
  ]);
});
