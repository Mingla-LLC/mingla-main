import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

const repoRoot = path.resolve(__dirname, "../../..");
const migrationPath = path.join(repoRoot, "supabase/migrations/20270614002986_issue_2986_public_search_documents.sql");
const migration = readFileSync(migrationPath, "utf8");
const allowlist = readFileSync(path.join(repoRoot, "supabase/security/anon_executable_definer_allowlist.txt"), "utf8");
const workflow = readFileSync(path.join(repoRoot, ".github/workflows/issue-2117-offering-visibility-gate-tests.yml"), "utf8");
const fullSchemaWorkflow = readFileSync(path.join(repoRoot, ".github/workflows/supabase-migrations-and-stripe-deno.yml"), "utf8");
const legacyPreview = readFileSync(path.join(repoRoot, "mingla-business/server/socialPreview.js"), "utf8");
const platformUrl = readFileSync(path.join(repoRoot, "mingla-business/src/constants/platformUrl.ts"), "utf8");
const config = JSON.parse(readFileSync(path.join(repoRoot, "mingla-business/vercel.json"), "utf8")) as {
  redirects: Array<{ source: string; destination: string; permanent: boolean; has?: Array<{ type: string; value: string }> }>;
  rewrites: Array<{ source: string; destination: string; has?: unknown }>;
};

const occurrences = (source: string, literal: string) => source.split(literal).length - 1;
const functionBody = (name: string) => {
  const start = migration.indexOf(`CREATE FUNCTION public.${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = migration.indexOf("\nCREATE FUNCTION public.", start + 1);
  return migration.slice(start, next < 0 ? migration.length : next);
};

describe("#2986 migration lifecycle and privacy boundary", () => {
  it("creates one empty opt-in overlay with the exact seven-state lifecycle", () => {
    const beforeMutationOwner = migration.slice(0, migration.indexOf("CREATE FUNCTION public.upsert_public_search_document"));
    expect(migration).toContain("CREATE TABLE public.public_search_documents");
    expect(migration).toContain("'draft','public_noindex','search_ready','stale','expired_archived','redirected','gone'");
    expect(beforeMutationOwner).not.toContain("INSERT INTO public.public_search_documents");
    expect(migration).toContain("migration must seed zero search documents");
    expect(migration).toContain("public_search_documents_live_entity_uniq");
    expect(migration).toContain("WHERE lifecycle_state <> 'redirected'");
  });

  it("forces RLS, denies ordinary table access and exposes exactly two anonymous definers", () => {
    expect(migration).toContain("ALTER TABLE public.public_search_documents ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE public.public_search_documents FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON TABLE public.public_search_documents FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("ALTER TABLE public.public_search_document_audit FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON TABLE public.public_search_document_audit FROM PUBLIC, anon, authenticated");
    expect(migration.match(/GRANT EXECUTE ON FUNCTION public\.(resolve_public_search_document\(text\)|list_public_search_sitemap\(\)) TO anon, authenticated, service_role;/g)).toHaveLength(2);
    expect(migration.match(/TO anon, authenticated, service_role;/g)).toHaveLength(2);
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*TO\s+(?:anon|authenticated)/i);
  });

  it("keeps the resolver exact-path, address-safe and subordinate to product visibility", () => {
    const resolver = functionBody("resolve_public_search_document");
    const source = functionBody("public_search_source_facts");
    expect(resolver).toContain("public.public_search_path_kind(p_path)");
    expect(resolver).toContain("public_noindex");
    expect(resolver).toContain("dependency_failure");
    expect(resolver).toContain("v_doc.entity_id=(v_facts->>'id')::uuid");
    expect(source).toContain("public.pg_offering_visibility_gate(e.visibility,e.deleted_at,'direct')");
    expect(source).toContain("public.issue_2489_address_withheld(e.theme)");
    expect(source).not.toMatch(/contact_email|contact_phone|online_url|location_geo|\blat\b|\blng\b|organiser_contact|created_by/);
  });

  it("rejects alternate hosts, queries, fragments, encodings, traversal and redirect chains", () => {
    const pathOwner = functionBody("public_search_path_kind");
    const trigger = functionBody("tg_validate_public_search_document");
    expect(pathOwner).toContain("p_path ~ '[?#%\\\\]' ");
    expect(pathOwner).toContain("p_path ~ '//' ");
    expect(pathOwner).toContain("p_path <> lower(p_path)");
    expect(pathOwner).toContain("p_path !~ '^[\\x00-\\x7F]+$'");
    expect(trigger).toContain("public_search_redirect_chain_or_cycle");
    expect(trigger).toContain("NEW.redirect_target_path=NEW.canonical_path");
    expect(trigger).toContain("d.lifecycle_state='redirected'");
  });

  it("makes search promotion privileged, evidence-complete, source-current and audited", () => {
    const upsert = functionBody("upsert_public_search_document");
    const validation = functionBody("public_search_validation_complete");
    const readiness = functionBody("public_search_source_is_search_ready");
    expect(upsert).toMatch(/BEGIN\s+-- Authorization is intentionally the first executable guard\.\s+IF auth\.role\(\) IS DISTINCT FROM 'service_role' AND NOT public\.is_admin_user\(\)/);
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.upsert_public_search_document");
    expect(validation).toContain('"facts_verified":true');
    expect(validation).toContain('"image_rights_verified":true');
    expect(validation).toContain('"schema_verified":true');
    expect(readiness).toContain("pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')");
    expect(migration).toContain("AFTER INSERT OR UPDATE OR DELETE ON public.public_search_documents");
    expect(migration).toContain("before_row jsonb");
    expect(migration).toContain("after_row jsonb");
  });

  it("sitemap enumeration is independently constrained to current validated non-test rows", () => {
    const sitemap = functionBody("list_public_search_sitemap");
    expect(sitemap).toContain("d.lifecycle_state='search_ready'");
    expect(sitemap).toContain("d.is_test_record=false");
    expect(sitemap).toContain("d.review_due_at > now()");
    expect(sitemap).toContain("public.public_search_validation_complete");
    expect(sitemap).toContain("public.public_search_source_is_search_ready");
    expect(sitemap).toContain("public.public_search_source_facts(d.canonical_path,d.entity_kind)");
    expect(sitemap).toContain("d.source_updated_at >=");
    expect(sitemap).not.toMatch(/title|description|imageUrl|location/);
  });
});

describe("#2986 exact intended-public amendment is closed and self-defending", () => {
  it("registers exactly the two approved identities once", () => {
    for (const signature of ["resolve_public_search_document(p_path text)", "list_public_search_sitemap()"]) {
      expect(occurrences(allowlist, signature)).toBe(1);
    }
    expect(allowlist).toContain("# Signature count: 196 (intended-public 27");
    expect(allowlist).toContain("# #2986: exact Host-relative path only;");
    expect(allowlist).toContain("# #2986: enumerable only by design;");
  });

  it("runs the fail-on-forged self-test and preserves the live ORCH-1392 gate", () => {
    expect(workflow.match(/run: bash scripts\/ci\/security_definer_anon_gate\.sh/g)).toHaveLength(1);
    expect(workflow).toContain("node scripts/ci/issue_2986_allowlist_delta_gate.mjs --self-test");
    expect(workflow).toContain('node scripts/ci/issue_2986_allowlist_delta_gate.mjs --base-sha "$BASE_SHA"');
    expect(execFileSync(process.execPath, [path.join(repoRoot, "scripts/ci/issue_2986_allowlist_delta_gate.mjs"), "--self-test"], { encoding: "utf8" })).toContain("PASS");
  });

  it("registers only the two exact SQL files in the existing full-schema provider", () => {
    for (const filename of [
      "issue_2986_public_search_documents.implementor.happy.pg17.test.sql",
      "issue_2986_public_search_documents.tester.adversarial.pg17.test.sql",
    ]) {
      const exact = `-f supabase/migrations/__tests__/${filename}`;
      expect(occurrences(fullSchemaWorkflow, exact)).toBe(1);
    }
    expect(fullSchemaWorkflow).not.toMatch(/issue_2986[^\n]*\*/);
  });
});

describe("#2986 Business retirement compatibility remains public-route-only", () => {
  const publicSources = [
    "/e/:brandSlug/:eventSlug",
    "/t/:brandSlug/:tripSlug",
    "/exp/:brandSlug/:experienceSlug",
    "/b/:brandSlug/v/:venueSlug",
    "/b/:brandSlug",
  ];

  it("has exactly five permanent host-conditioned path-preserving redirects", () => {
    expect(config.redirects).toHaveLength(5);
    expect(config.redirects.map((redirect) => redirect.source)).toEqual(publicSources);
    for (const redirect of config.redirects) {
      expect(redirect.permanent).toBe(true);
      expect(redirect.has).toEqual([{ type: "host", value: "business\\.usemingla\\.com" }]);
      expect(redirect.destination).toBe(`https://host.usemingla.com${redirect.source}`);
      expect(redirect.destination).not.toContain("?");
    }
  });

  it("does not redirect auth, pay, checkout, callback, API, OG, root or native-association paths", () => {
    const sources = config.redirects.map((redirect) => redirect.source).join("\n");
    expect(sources).not.toMatch(/auth|pay|checkout|callback|api|og|well-known/);
    expect(sources).not.toContain("/(.*)");
    expect(sources).not.toContain("/:path");
  });

  it("cannot resurrect the retired Business hostname through stale public URL configuration", () => {
    expect(legacyPreview).toContain('CONFIGURED_PUBLIC_ORIGIN === "https://business.usemingla.com"');
    expect(legacyPreview).toContain('? "https://host.usemingla.com"');
    expect(platformUrl).toContain("RETIRED_BUSINESS_ORIGIN.test(CONFIGURED.trim())");
    expect(platformUrl).toContain("? HOST_PUBLIC_ORIGIN");
  });
});
