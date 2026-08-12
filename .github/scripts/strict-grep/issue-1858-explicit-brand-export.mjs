#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  migration: "supabase/migrations/20270326001858_issue_1858_explicit_brand_export.sql",
  edge: "supabase/functions/brand-people-export/index.ts",
  workflow: ".github/workflows/issue-1858-explicit-brand-export-tests.yml",
  invariant: "docs/INVARIANT_REGISTRY.md",
};

export function inspect(source) {
  const failures = [];
  const need = (where, token, label) => { if (!source[where]?.includes(token)) failures.push(`missing ${label}`); };
  need("migration", "p_brand_id uuid DEFAULT NULL", "final brand parameter");
  need("migration", "IF p_scope IS NULL OR p_filter IS NULL OR p_sort IS NULL", "explicit null-selector guard");
  need("migration", "WHERE b.id=p_brand_id AND b.deleted_at IS NULL", "exact brand lookup");
  need("migration", "biz_brand_effective_rank(v_brand,v_actor)<public.biz_role_rank('brand_admin')", "effective-rank authorization");
  need("migration", "DROP FUNCTION public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid);", "old identity removal");
  need("migration", "[[:space:]]+", "portable whitespace normalization");
  if (/account_id\s*=\s*v_actor|ORDER BY\s+b\.created_at[\s\S]*LIMIT 1/i.test(source.migration ?? "")) failures.push("ownership fallback present");
  need("edge", "brand_id_required", "missing-brand response");
  need("edge", "brand_id_invalid", "invalid-brand response");
  need("edge", 'if (input.scope === "brand_book")', "brand-book conditional validation");
  need("edge", 'input.scope === "offering_guest_roster"', "roster conditional validation");
  need("edge", "p_brand_id: input.brandId ?? null", "brand forwarding");
  need("workflow", "issue_1858_explicit_brand_export.test.sql", "SQL workflow execution");
  need("workflow", "issue_1858_explicit_brand_export.test.ts", "Deno workflow execution");
  need("workflow", "issue-1858-explicit-brand-export.mjs --self-test", "guard self-test wiring");
  need("invariant", "I-PROPOSED-BRAND-EXPORT-EXPLICIT-TARGET-1 (ACTIVE)", "ACTIVE invariant");
  return failures;
}

function readSources() {
  return Object.fromEntries(Object.entries(files).map(([key, value]) => [key, fs.readFileSync(path.join(root, value), "utf8")]));
}

function selfTest(source) {
  const mutations = [
    ["brand parameter", { ...source, migration: source.migration.replace("p_brand_id uuid DEFAULT NULL", "p_brand_id uuid") }],
    ["null selectors", { ...source, migration: source.migration.replace("IF p_scope IS NULL OR p_filter IS NULL OR p_sort IS NULL", "IF") }],
    ["fallback", { ...source, migration: source.migration.replace("WHERE b.id=p_brand_id AND b.deleted_at IS NULL", "WHERE b.account_id=v_actor ORDER BY b.created_at LIMIT 1") }],
    ["rank", { ...source, migration: source.migration.replace("biz_brand_effective_rank(v_brand,v_actor)<public.biz_role_rank('brand_admin')", "false") }],
    ["edge forwarding", { ...source, edge: source.edge.replace("p_brand_id: input.brandId ?? null", "p_brand_id: null") }],
    ["workflow", { ...source, workflow: source.workflow.split("issue_1858_explicit_brand_export.test.sql").join("missing.sql") }],
    ["invariant lifecycle", { ...source, invariant: source.invariant.replace("I-PROPOSED-BRAND-EXPORT-EXPLICIT-TARGET-1 (ACTIVE)", "I-PROPOSED-BRAND-EXPORT-EXPLICIT-TARGET-1 (DRAFT)") }],
  ];
  for (const [label, mutation] of mutations) {
    if (inspect(mutation).length === 0) throw new Error(`self-test did not catch ${label}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = readSources();
  if (process.argv.includes("--self-test")) {
    selfTest(source);
    console.log("#1858 explicit brand export self-test PASS (7 true mutations)");
  } else {
    const failures = inspect(source);
    if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
    console.log("#1858 explicit brand export gate PASS");
  }
}
