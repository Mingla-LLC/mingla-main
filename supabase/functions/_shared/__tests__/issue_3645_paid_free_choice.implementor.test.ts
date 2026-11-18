/**
 * issue #3645 bundle 2C — the host's paid/free choice is stored apart from
 * the ticket.
 *
 *   - Ari's flow row reads it with the server's rule
 *     (issue_3645_experience_is_free): a priced option means paid; else the
 *     stored choice; else the first option (rows saved before the choice).
 *   - 20280806003645 patches exactly the declared live lines
 *     (issue_3645_paid_free_choice_patches.ts), re-creates no existing
 *     public function, and adds only its two helpers.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFlowProbeDeps } from "../ariFlows/edge.ts";
import { definitions } from "../../../migrations/__tests__/issue_3645_reemit_hunks.ts";
import {
  dollarQuoted,
  PAID_FREE_CHOICE_PATCHES,
  TARGET,
} from "../../../migrations/__tests__/issue_3645_paid_free_choice_patches.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

const BRAND = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";

function fakeClient(tables: Record<string, Json[]>) {
  return {
    from(table: string) {
      let rows = tables[table] ?? [];
      const builder: Json = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        limit: (n: number) => {
          rows = rows.slice(0, n);
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: Json) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return builder;
    },
  };
}

async function rowFor(
  theme: Json,
  tickets: Json[],
  wholePriceCents: number | null,
) {
  const client = fakeClient({
    events: [{
      id: EVENT,
      title: "Walk",
      status: "draft",
      updated_at: "2026-11-18T00:00:00.000000+00:00",
      timezone: "Africa/Lagos",
      description: "A long enough description.",
      experience_intents: ["romantic"],
      whole_price_cents: wholePriceCents,
      theme,
    }],
    experience_stops: [],
    ticket_types: tickets,
  });
  const row = await buildFlowProbeDeps(client as Json, BRAND).experienceRow!(
    EVENT,
  );
  assert(row);
  return row;
}

const freeTicket = { is_free: true, price_cents: 0, display_order: 0 };
const paidTicket = { is_free: false, price_cents: 500_000, display_order: 1 };
const meta = (isFree: boolean) => ({ experience_meta: { is_free: isFree } });

// The shared case table: Ari's row here, the Host's experienceIsFree (Jest)
// and the SQL helper (PG17) answer the same.
const CASES: Array<[string, Json, Json[], number | null, boolean]> = [
  ["a paid draft saved at 0 stays paid", meta(false), [freeTicket], 0, false],
  ["an explicit free choice is free", meta(true), [freeTicket], 0, true],
  [
    "a priced option beats a stale free choice",
    meta(true),
    [{ ...paidTicket, display_order: 0 }],
    500_000,
    false,
  ],
  [
    "free first + paid second is paid",
    meta(true),
    [freeTicket, paidTicket],
    500_000,
    false,
  ],
  ["legacy: no stored choice, free ticket", {}, [freeTicket], 0, true],
  [
    "legacy: no stored choice, priced ticket",
    {},
    [{ ...paidTicket, display_order: 0 }],
    500_000,
    false,
  ],
  ["legacy: no stored choice, no ticket, whole 0", {}, [], 0, true],
  ["a non-boolean \"false\" is ignored", { experience_meta: { is_free: "false" } }, [freeTicket], 0, true],
  ["a non-boolean \"true\" is ignored", { experience_meta: { is_free: "true" } }, [], 500_000, false],
];

for (const [name, theme, tickets, whole, want] of CASES) {
  Deno.test(`#3645 2C Ari row: ${name}`, async () => {
    assertEquals((await rowFor(theme, tickets, whole)).is_free, want);
  });
}

// ── The migration ──────────────────────────────────────────────────────────

const SQL = Deno.readTextFileSync(TARGET);

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

Deno.test("#3645 2C the migration applies exactly the declared live patches", () => {
  assertEquals(
    count(SQL, "SELECT pg_temp.issue_3645_2c_patch("),
    PAID_FREE_CHOICE_PATCHES.length,
  );
  for (const p of PAID_FREE_CHOICE_PATCHES) {
    const call = `SELECT pg_temp.issue_3645_2c_patch(\n  '${p.signature}',\n  ${
      dollarQuoted("old", p.old)
    },\n  ${dollarQuoted("new", p.new)},\n  1\n);`;
    assertEquals(count(SQL, call), 1, p.fn);
  }
  assertEquals(
    count(SQL, "EXECUTE replace("),
    1,
    "only the patch helper executes SQL",
  );
});

Deno.test("#3645 2C every patch is a no-op on re-apply (its new text never contains its old)", () => {
  // The helper treats "0 old, p_expected new" as applied. A `new` that
  // contains its `old` keeps 1 old match after the first apply, so a re-apply
  // would patch again (an earlier draft of the create patch did).
  for (const p of PAID_FREE_CHOICE_PATCHES) {
    assert(!p.new.includes(p.old), `${p.fn}: new contains old`);
    assertEquals(count(p.new, p.old), 0, p.fn);
  }
});

Deno.test("#3645 2C the migration re-creates no existing function and adds only its helpers", () => {
  assertEquals([...definitions(SQL).keys()].sort(), [
    "issue_3645_experience_is_free",
    "issue_3645_theme_with_is_free",
  ]);
  const dir = "supabase/migrations";
  const target = TARGET.slice(dir.length + 1);
  for (
    const file of [...Deno.readDirSync(dir)].map((e) => e.name).filter((f) =>
      f.endsWith(".sql")
    )
  ) {
    if (file === target) continue;
    const defs = definitions(Deno.readTextFileSync(`${dir}/${file}`));
    assert(
      !defs.has("issue_3645_experience_is_free"),
      `${file} defines the helper too`,
    );
    assert(
      !defs.has("issue_3645_theme_with_is_free"),
      `${file} defines the helper too`,
    );
  }
});

Deno.test("#3645 2C refuses to apply before bundle 2A, and the helpers are not callable by clients", () => {
  const guard = SQL.indexOf("DO $precondition$");
  assert(
    guard > 0 &&
      guard <
        SQL.indexOf(
          "CREATE OR REPLACE FUNCTION public.issue_3645_theme_with_is_free",
        ),
  );
  assert(
    SQL.includes("RAISE EXCEPTION 'issue_3645_2c_requires_20280801003645'"),
  );
  for (
    const fn of [
      "issue_3645_theme_with_is_free(jsonb, boolean)",
      "issue_3645_experience_is_free(uuid)",
    ]
  ) {
    assert(
      SQL.includes(
        `REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`,
      ),
      fn,
    );
  }
  assert(
    SQL.includes(
      "IF v_old_count = 0 AND v_new_count = p_expected THEN\n    RETURN;",
    ),
  );
});
