import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const migration = fs.readFileSync(
  process.env.ISSUE_1424_MIGRATION_PATH ??
    path.join(
      root,
      "supabase/migrations/20270131014240_issue_1424_stay_authoring_publish.sql",
    ),
  "utf8",
);
const shell = fs.readFileSync(
  path.join(root, "mingla-business/src/components/stay/StaySuiteShell.tsx"),
  "utf8",
);
const readiness = fs.readFileSync(
  path.join(
    root,
    "mingla-business/src/components/stay/staySettingsReadiness.ts",
  ),
  "utf8",
);
const sqlProof = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/__tests__/issue_1424_stay_authoring.tester_adversarial.test.sql",
  ),
  "utf8",
);
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/supabase-migrations-and-stripe-deno.yml"),
  "utf8",
);

function functionBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = migration.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${escaped}\\([\\s\\S]*?\\$function\\$;`,
    ),
  );
  assert.ok(match, `${name} must exist in the issue #1424 migration`);
  return match[0];
}

test("Stay inventory reads reject users outside the exact brand", () => {
  const body = functionBody("issue_1387_stay_inventory_snapshot");
  assert.match(
    body,
    /issue_1387_has_brand_capability\(\s*v_venue\.brand_id,\s*v_uid,\s*'read'\s*\)/,
  );
  assert.ok(
    body.indexOf("issue_1387_has_brand_capability") <
      body.indexOf("RETURN jsonb_build_object"),
    "the tenancy check must run before inventory is returned",
  );
});

test("Stay settings reject users outside the exact brand before any write", () => {
  const body = functionBody("biz_save_stay_settings_v2");
  assert.match(
    body,
    /issue_1387_has_brand_capability\(\s*v_venue\.brand_id,\s*v_uid,\s*'inventory'\s*\)/,
  );
  assert.ok(
    body.indexOf("issue_1387_has_brand_capability") <
      body.indexOf("INSERT INTO public.stay_settings"),
    "the tenancy check must run before settings are inserted or updated",
  );
});

test("Stay publishing rejects users outside the exact brand before activation", () => {
  const body = functionBody("biz_publish_stay");
  assert.match(
    body,
    /issue_1387_has_brand_capability\(\s*v_venue\.brand_id,\s*v_uid,\s*'inventory'\s*\)/,
  );
  assert.ok(
    body.indexOf("issue_1387_has_brand_capability") <
      body.indexOf("UPDATE public.stay_settings"),
    "the tenancy check must run before settings or offerings go live",
  );
});

test("the tester-owned live SQL proof attacks all three tenancy boundaries in blocking CI", () => {
  assert.match(sqlProof, /outsider-1424-adversarial@example\.test/);
  assert.match(sqlProof, /issue_1387_stay_inventory_snapshot\(v_stay_id\)/);
  assert.match(sqlProof, /biz_save_stay_settings_v2\(/);
  assert.match(sqlProof, /biz_publish_stay\(v_stay_id/);
  assert.equal((sqlProof.match(/SQLERRM <> 'forbidden'/g) ?? []).length, 3);
  assert.match(
    workflow,
    /-f supabase\/migrations\/__tests__\/issue_1424_stay_authoring\.tester_adversarial\.test\.sql/,
  );
});

test("descriptive property kind cannot become a save or publish requirement", () => {
  assert.match(shell, /Property type \(optional\)/);
  assert.doesNotMatch(readiness, /settings\.property_kind !== null/);
  assert.doesNotMatch(readiness, /propertyKind !== null &&/);
  assert.doesNotMatch(migration, /OR v_settings\.property_kind IS NULL/);
  assert.match(
    sqlProof,
    /TA-0 PASS: null property kind saves as optional metadata/,
  );
});
