import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(new URL("../20270324001929_issue_1929_hidden_direct_checkout.sql", import.meta.url));

Deno.test("#1929 emits one hardened bundle and preserves the checkout seam", () => {
  assertEquals((sql.match(/CREATE FUNCTION public\.pg_direct_event_checkout_bundle\(/g) ?? []).length, 1);
  assert(sql.includes("SET search_path = ''"));
  assert(sql.includes("e.visibility IN ('public'::text, 'hidden'::text)"));
  assert(sql.includes("v_event.visibility NOT IN ('public', 'hidden')"));
  assert(!sql.includes("tt.is_hidden IS NOT TRUE"));
  assert(!sql.includes("tt.is_disabled IS NOT TRUE"));
  assert(sql.indexOf("WHERE idempotency_key = p_idempotency_key") < sql.indexOf("SELECT e.id, e.brand_id, e.visibility"));
});
