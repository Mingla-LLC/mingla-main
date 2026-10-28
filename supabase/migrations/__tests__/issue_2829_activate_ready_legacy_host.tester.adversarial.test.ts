// MINGLA-INVARIANT: I-2829-LEGACY-HOST-CONVERGENCE | issue #2829 | This repair may activate at most one pending primary Mingla subdomain, and only when its brand entitlement, tenant, published site, current/last-good publication, artifact and canonical hostname are all mutually consistent.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const path =
  "supabase/migrations/20280205002829_issue_2829_activate_ready_legacy_host.sql";
const source = await Deno.readTextFile(path);

Deno.test("#2829 activation is generic, singular, fail-closed and fully readiness-bound", () => {
  assertEquals(source.toLowerCase().includes("gogi"), false);
  for (
    const forbidden of [
      "733bc470-45e1-4684-8896-acd7e26074ff",
      "90f19f28-42e2-4eb9-b88b-02829bfcb045",
      "gogi.sites.usemingla.com",
      "brand_site_activate_gogi_pilot",
    ]
  ) {
    assertEquals(source.includes(forbidden), false, forbidden);
  }
  for (
    const required of [
      "LOCK TABLE public.brands",
      "v_candidate_count > 1",
      "issue_2829_legacy_host_ambiguous",
      "host.kind = 'mingla_subdomain'",
      "host.status = 'pending'",
      "host.activated_at IS NULL",
      "host.is_primary",
      "site.status = 'published'",
      "site.payload_tenant_id IS NOT NULL",
      "site.owner_offline_at IS NULL",
      "site.active_publication_id = site.last_successful_publication_id",
      "publication.status = 'published'",
      "publication.artifact_key IS NOT NULL",
      "publication.artifact_digest IS NOT NULL",
      "entitlement.status = 'granted'",
      "brand.deleted_at IS NULL",
      "active_host.status = 'active'",
      "AND status = 'pending'",
      "v_updated <> 1",
      "LEGACY_HOST_ACTIVATION",
    ]
  ) {
    assertStringIncludes(source, required);
  }
  assert(
    /UPDATE public\.brand_site_hosts[\s\S]*WHERE id = v_host_id/.test(source),
  );
});
