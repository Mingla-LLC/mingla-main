// Issue #679 [follow-a-brand] — static pin of the brand_follows migration
// (orch_1359 house pattern: Deno reads the migration file and pins its
// load-bearing clauses; append-only).
//
// Pins (spec §3 on #679, I-PROPOSED-679-FOLLOW-OWNER-ONLY-RLS):
//   * table + unique(user_id, brand_id) + both cascading FKs
//   * RLS enabled + EXACTLY three owner-scoped policies (insert/select/delete)
//   * anon fully revoked; authenticated granted select/insert/delete ONLY
//   * NO update path (no UPDATE grant, no UPDATE policy — no mutable columns)
//   * NO brand-side read, NO view, NO trigger, NO count exposure — the Ring-2
//     privacy boundary (#876) is enforced structurally by policy ABSENCE, so
//     any 4th policy or widened grant fails this suite.
//
// FAILS-ON-REVERT: deleting the migration file makes the top-level
// Deno.readTextFile throw; loosening any clause above (dropping a policy,
// widening the grant, adding a brand-owner read / view / trigger) fails the
// matching assertion.
//
// Run locally (repo root):
//   deno test --allow-read supabase/migrations/__tests__/issue_679_brand_follows.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION_PATH =
  "supabase/migrations/20270305000679_issue_679_brand_follows.sql";

const migration = await Deno.readTextFile(MIGRATION_PATH);
const lower = migration.toLowerCase();

const countOf = (hay: string, needle: string): number =>
  hay.split(needle).length - 1;

Deno.test("T-1 table shape — unique (user_id, brand_id) + cascading FKs to profiles and brands", () => {
  assert(
    lower.includes("create table if not exists public.brand_follows"),
    "brand_follows table is created idempotently",
  );
  assert(
    lower.includes(
      "constraint brand_follows_user_brand_key unique (user_id, brand_id)",
    ),
    "the user+brand unique key backs the idempotent upsert (SC-7)",
  );
  assert(
    lower.includes(
      "user_id uuid not null references public.profiles(id) on delete cascade",
    ),
    "FK -> profiles(id) ON DELETE CASCADE (account erasure cascades)",
  );
  assert(
    lower.includes(
      "brand_id uuid not null references public.brands(id) on delete cascade",
    ),
    "FK -> brands(id) ON DELETE CASCADE",
  );
  assert(
    lower.includes("source text not null default 'brand_page'"),
    "source column seeded 'brand_page' (deferred-link sources arrive in leg 5)",
  );
});

Deno.test("T-2 RLS — enabled, with EXACTLY the three owner policies", () => {
  assert(
    lower.includes(
      "alter table public.brand_follows enable row level security",
    ),
    "RLS enabled",
  );
  assert(
    lower.includes("create policy bf_owner_insert on public.brand_follows"),
    "owner insert policy exists",
  );
  assert(
    lower.includes("for insert with check (auth.uid() = user_id)"),
    "insert is owner-scoped",
  );
  assert(
    lower.includes("create policy bf_owner_select on public.brand_follows"),
    "owner select policy exists",
  );
  assert(
    lower.includes("for select using (auth.uid() = user_id)"),
    "select is owner-scoped",
  );
  assert(
    lower.includes("create policy bf_owner_delete on public.brand_follows"),
    "owner delete policy exists",
  );
  assert(
    lower.includes("for delete using (auth.uid() = user_id)"),
    "delete is owner-scoped",
  );
  assertEquals(
    countOf(lower, "create policy"),
    3,
    "EXACTLY three policies — any 4th (e.g. a brand-side read) is a widening " +
      "and needs a new reviewed policy per I-PROPOSED-679-FOLLOW-OWNER-ONLY-RLS",
  );
});

Deno.test("T-3 grants — anon revoked; authenticated select/insert/delete ONLY; no update path", () => {
  assert(
    lower.includes("revoke all on table public.brand_follows from anon"),
    "anon has zero access (SC-6)",
  );
  assert(
    lower.includes(
      "grant select, insert, delete on table public.brand_follows to authenticated",
    ),
    "authenticated grant is exactly select/insert/delete",
  );
  assert(
    !lower.includes("for update"),
    "no UPDATE policy — no mutable columns",
  );
  assert(
    !/grant[^;]*\bupdate\b/.test(lower),
    "no UPDATE grant anywhere in the migration",
  );
});

Deno.test("T-4 privacy boundary — no brand-side read, no view, no trigger, no counts", () => {
  assert(
    !lower.includes("create view") && !lower.includes("create or replace view"),
    "no view over brand_follows",
  );
  assert(!lower.includes("create trigger"), "no triggers");
  assert(!lower.includes("security definer"), "no definer bypass of the RLS");
  assert(
    !lower.includes("count("),
    "no count exposure (counts leg is deferred)",
  );
  assert(
    !lower.includes("brand_owner") && !lower.includes("biz_role"),
    "no brand-facing policy — a brand cannot read its follow rows in v1",
  );
});
