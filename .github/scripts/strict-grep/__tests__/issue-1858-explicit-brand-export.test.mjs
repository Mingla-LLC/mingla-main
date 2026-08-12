import test from "node:test";
import assert from "node:assert/strict";
import { inspect } from "../issue-1858-explicit-brand-export.mjs";

const valid = {
  migration: "DROP FUNCTION public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid); p_brand_id uuid DEFAULT NULL WHERE b.id=p_brand_id AND b.deleted_at IS NULL biz_brand_effective_rank(v_brand,v_actor)<public.biz_role_rank('brand_admin') [[:space:]]+",
  edge: 'if (input.scope === "brand_book") brand_id_required brand_id_invalid input.scope === "offering_guest_roster" p_brand_id: input.brandId ?? null',
  workflow: "issue_1858_explicit_brand_export.test.sql issue_1858_explicit_brand_export.test.ts issue-1858-explicit-brand-export.mjs --self-test",
  invariant: "I-PROPOSED-BRAND-EXPORT-EXPLICIT-TARGET-1 (DRAFT)",
};

test("#1858 guard accepts the binding contract", () => assert.deepEqual(inspect(valid), []));
test("#1858 guard rejects ownership fallback and overload resurrection", () => {
  const drift = { ...valid, migration: valid.migration.replace("WHERE b.id=p_brand_id AND b.deleted_at IS NULL", "WHERE b.account_id=v_actor ORDER BY b.created_at LIMIT 1").replace("DROP FUNCTION public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid);", "") };
  assert.ok(inspect(drift).length >= 2);
});
