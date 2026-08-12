import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../../../../supabase/migrations/20270326001858_issue_1858_explicit_brand_export.sql",
  import.meta.url,
);

test("#1858 exact requested brand outranks actor ownership fallback", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.match(
    migration,
    /SELECT b\.id INTO v_brand FROM public\.brands b WHERE b\.id=p_brand_id AND b\.deleted_at IS NULL/,
    "brand_book must resolve only its requested active brand",
  );
  assert.doesNotMatch(
    migration,
    /account_id\s*=\s*v_actor|ORDER BY\s+b\.created_at[\s\S]*LIMIT 1/i,
    "actor ownership must never select or replace the requested brand",
  );
  assert.match(
    migration,
    /biz_brand_effective_rank\(v_brand,v_actor\)<public\.biz_role_rank\('brand_admin'\)/,
    "the exact resolved brand must use membership-aware rank-50 authorization",
  );
  assert.match(
    migration,
    /DROP FUNCTION public\.biz_export_brand_people\(text,uuid,text,text,text,jsonb,uuid\);/,
    "the brandless function identity must remain absent",
  );
});
