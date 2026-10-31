#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// MINGLA-INVARIANT: I-PROPOSED-2830-SITES-LAST-GOOD-TENANT-BOUNDARY | issue #2830 | Sites serves only exact-host immutable digest-verified publications while Core retains identity, commerce, rank, and last-good authority.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  migration: "supabase/migrations/20270609002830_issue_2830_mingla_sites_foundation.sql",
  liveMigration: "supabase/migrations/20270613002893_issue_2893_sites_readiness_activation.sql",
  liveSql: "supabase/migrations/__tests__/issue_2893_sites_readiness_activation.test.sql",
  // #3157 — the post-pointer public reachability record and the pilot audit trail.
  reachabilityMigration:
    "supabase/migrations/20270620003157_issue_3157_public_reachability_and_pilot_audit.sql",
  reachabilitySql:
    "supabase/migrations/__tests__/issue_3157_publish_public_reachability.test.sql",
  reachabilityDeno:
    "supabase/functions/_shared/__tests__/issue_3157_publish_public_reachability.test.ts",
  // #2829 (SPEC A6) — the multi-brand migration that replaced the single
  // Gogi pilot binding, and the SQL suite that proves its replacement
  // behaviour (per-brand entitlement, owner offline, recovery alert).
  multiBrandMigration: "supabase/migrations/20280119012829_issue_2829_sites_multi_brand_w1.sql",
  multiBrandSql: "supabase/migrations/__tests__/issue_2829_sites_multi_brand.test.sql",
  // #2829 W8 — the custom-domain migration re-creates both resolvers (the
  // detaching window, every address of the site); its definitions are now the
  // live ones, so the host-binding pins below hold for it too.
  customDomainsMigration: "supabase/migrations/20280119082829_issue_2829_custom_domains.sql",
  deployWrapper: "scripts/ops/deploy-sites-edge-functions.sh",
  deployWrapperTest: "scripts/ops/__tests__/issue_2893_sites_edge_deploy_wrapper.test.mjs",
  security: "supabase/functions/_shared/sitesSecurity.ts",
  contracts: "supabase/functions/_shared/sitesContracts.ts",
  observability: "supabase/functions/_shared/sitesObservability.ts",
  control: "supabase/functions/brand-site-control/index.ts",
  callback: "supabase/functions/brand-site-cms-callback/index.ts",
  runtimeResolve: "supabase/functions/brand-site-runtime-resolve/index.ts",
  attribution: "supabase/functions/brand-site-attribution/index.ts",
  ariTools: "supabase/functions/_shared/agentSiteTools.ts",
  ariAuthorization: "supabase/functions/_shared/agentToolAuthorization.ts",
  denoHappy: "supabase/functions/_shared/__tests__/issue_2830_sites_foundation_happy.test.ts",
  denoLive: "supabase/functions/_shared/__tests__/issue_2893_sites_live_readiness.test.ts",
  businessFlag: "mingla-business/src/config/featureFlags.ts",
  // #2829 W9r — the redesigned Website section replaced the old route body and
  // BrandWebsiteView: the controller owns availability, provisioning and the
  // durable publication; the shell owns the zero signal and the redirect;
  // Publish & history owns terminal recovery; Addresses and Overview are the
  // other customer surfaces the neutrality pins cover.
  businessRoute: "mingla-business/src/components/sites/website/useWebsiteController.ts",
  businessView: "mingla-business/src/components/sites/website/WebsiteApp.tsx",
  businessPublish: "mingla-business/src/components/sites/website/sections/PublishSection.tsx",
  businessAddresses: "mingla-business/src/components/sites/website/sections/AddressesSection.tsx",
  businessOverview: "mingla-business/src/components/sites/website/sections/OverviewSection.tsx",
  businessService: "mingla-business/src/services/brandSitesService.ts",
  businessJourney: "mingla-business/src/sites/websiteJourney.ts",
  businessEntry: "mingla-business/src/sites/brandWebsiteEntry.ts",
  businessProfile: "mingla-business/src/components/brand/BrandProfileView.tsx",
  businessReturn: "mingla-business/src/sites/studioReturn.ts",
  businessContracts: "mingla-business/src/sites/contracts.ts",
  checkout: "supabase/functions/ticket-checkout-create/index.ts",
  cmsPackage: "mingla-site-cms/package.json",
  cmsConfig: "mingla-site-cms/src/lib/config.ts",
  cmsPayload: "mingla-site-cms/src/payload.config.ts",
  cmsUsers: "mingla-site-cms/src/collections/StudioUsers.ts",
  cmsAccess: "mingla-site-cms/src/lib/access.ts",
  cmsMediaCollection: "mingla-site-cms/src/collections/Media.ts",
  cmsMedia: "mingla-site-cms/src/lib/mediaPipeline.ts",
  cmsObjectStore: "mingla-site-cms/src/lib/objectStore.ts",
  cmsArtifact: "mingla-site-cms/src/lib/artifactBuilder.ts",
  cmsEndpoints: "mingla-site-cms/src/endpoints/sitesEndpoints.ts",
  cmsObservability: "mingla-site-cms/src/lib/observability.ts",
  cmsProxy: "mingla-site-cms/src/proxy.ts",
  cmsSession: "mingla-site-cms/src/lib/session.ts",
  cmsStudioAuth: "mingla-site-cms/src/lib/studioRequestAuth.ts",
  cmsNav: "mingla-site-cms/src/components/StudioNav.tsx",
  cmsMediaClient: "mingla-site-cms/src/lib/studioMediaClient.ts",
  cmsMediaSelection: "mingla-site-cms/src/lib/studioMediaSelection.ts",
  cmsMediaManager: "mingla-site-cms/src/components/StudioMediaManager.tsx",
  cmsPreview: "mingla-site-cms/src/components/PreviewChrome.tsx",
  cmsStyles: "mingla-site-cms/src/app/(payload)/studio.css",
  publicPackage: "mingla-sites/package.json",
  publicConfig: "mingla-sites/src/lib/config.ts",
  publicGateway: "mingla-sites/src/lib/coreGateway.ts",
  publicConsentContract: "mingla-sites/src/lib/consent.ts",
  publicPublication: "mingla-sites/src/lib/publication.ts",
  publicArtifact: "mingla-sites/src/contracts/artifact.ts",
  // #2829 A8: v1/v2 artifact accessors (the canonical address of either schema).
  publicSiteArtifact: "mingla-sites/src/lib/siteArtifact.ts",
  publicRenderer: "mingla-sites/src/components/RestaurantV1.tsx",
  // #2829 A8: the v1 stylesheet moved (still served for v1 publications and rollback).
  publicStyles: "mingla-sites/public/designs/legacy-v1.css",
  // #2829 A8: the atelier design draws gögi's look on v2; its colours come from the registry defaults.
  atelierStyles: "mingla-sites/public/designs/atelier/1.css",
  designRegistry: "packages/site-contracts/src/designs.ts",
  publicConsent: "mingla-sites/src/components/ConsentControl.tsx",
  publicEvents: "mingla-sites/src/app/api/events/route.ts",
  publicAttributionRoute: "mingla-sites/src/app/api/attribution/route.ts",
  publicSecurityTest: "mingla-sites/src/lib/securityBoundary.test.ts",
  publicObservability: "mingla-sites/src/lib/observability.ts",
  manifest: "supabase/secrets.manifest.json",
  runbook: "docs/runbooks/MINGLA_SITES_PILOT.md",
  // Assemble workflow paths so this gate reads existing providers without
  // being misclassified as a new external workflow authority by the CI
  // provider-inventory scanner's intentional literal-reference contract.
  secretWorkflow: [".github", "workflows", "supabase-secret-budget" + ".yml"].join("/"),
  webWorkflow: [".github", "workflows", "web-build-check" + ".yml"].join("/"),
  // #2829 W11 — structural Sites rules moved here from mingla-business jest
  // files (#1047: no new source-text pins in jest; structural rules belong in
  // a strict-grep gate).
  bizPreviewFrame: "mingla-business/src/sites/previewFrame.ts",
  sitesOrigins: "mingla-sites/src/lib/origins.ts",
  edgeBusinessOrigin: "supabase/functions/_shared/businessWebOrigin.ts",
  bizPreviewPaneWeb: "mingla-business/src/components/sites/SitePreviewPane.web.tsx",
  bizTripRoute: "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
  bizTripGuideHook: "mingla-business/src/hooks/usePublicTripGuide.ts",
  consumerTripScreen: "app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx",
  consumerTripData: "app-mobile/src/hooks/useConsumerTripOfferingData.ts",
};
// #2829 W11 — every Website section source, concatenated with file markers
// (read by readFiles; no Website surface may say "restaurant").
const WEBSITE_SECTION_DIR = "mingla-business/src/components/sites/website";

const EXACT_CMS_DEPENDENCIES = {
  "@payloadcms/db-postgres": "3.92.0",
  "@payloadcms/next": "3.92.0",
  "@payloadcms/plugin-multi-tenant": "3.92.0",
  "@payloadcms/richtext-lexical": "3.92.0",
  "@payloadcms/storage-s3": "3.92.0",
  "@payloadcms/ui": "3.92.0",
  graphql: "16.11.0",
  // `next` is floor-checked separately (NEXT_ADVISORY_FLOOR) — exact patch pins
  // made every Sites advisory clear red #2830 (#3642 → #3713).
  payload: "3.92.0",
  react: "19.2.6",
  "react-dom": "19.2.6",
  sharp: "0.35.5",
  // #2829 A8 decision (3): font metric fallbacks, pinned exactly.
  "@capsizecss/metrics": "4.3.0",
};
const EXACT_PUBLIC_DEPENDENCIES = {
  // `next` floor-checked separately — see NEXT_ADVISORY_FLOOR.
  react: "19.2.6",
  "react-dom": "19.2.6",
};
// Advisory floor for Sites/CMS `next` (patched 16.3.x line cleared on #3642).
// Major must stay 16; patch/minor above the floor may move without editing this gate.
const NEXT_ADVISORY_FLOOR = Object.freeze([16, 3, 8]);
const NEXT_MAJOR = 16;
// #4057 raised both Sites trees to the patched 3.4.17 line. Treat that as an
// advisory floor so a later safe patch does not make current main red again.
const DOMPURIFY_ADVISORY_FLOOR = Object.freeze([3, 4, 17]);
const DOMPURIFY_MAJOR = 3;
// [TEST-MOD-APPROVED #2829] W9b retarget (A6 rules): the twelve-tool closed
// registry, every tool at marketing manager, became the website designer's
// closed registry generated from site-contracts: still an EXACT set, each tool
// pinned to its role — publish and rollback now need a brand admin (rank 50,
// I-PROPOSED-2829-04), as do the plan answers, the first draft and the
// confirm-real card; trip guides need an event manager.
const ARI_TOOL_ROLES = {
  get_brand_site: "marketing_manager",
  get_site_plan: "marketing_manager",
  start_brand_completeness_job: "marketing_manager",
  record_brand_context_finding: "brand_admin",
  list_site_designs: "marketing_manager",
  get_block_catalog: "marketing_manager",
  get_site_tokens: "marketing_manager",
  run_site_design_checks: "marketing_manager",
  list_site_pages: "marketing_manager",
  get_site_page: "marketing_manager",
  validate_site_draft: "marketing_manager",
  save_site_plan_design: "brand_admin",
  update_brand_context: "brand_admin",
  save_site_plan_answers: "brand_admin",
  create_site_draft: "brand_admin",
  propose_site_composition: "marketing_manager",
  propose_block_variant: "marketing_manager",
  propose_site_tokens: "marketing_manager",
  propose_site_copy: "marketing_manager",
  propose_site_imagery: "marketing_manager",
  propose_site_collection_entry: "marketing_manager",
  confirm_site_review: "brand_admin",
  propose_trip_guide_update: "event_manager",
  create_site_preview: "marketing_manager",
  publish_site: "brand_admin",
  get_site_operation_status: "marketing_manager",
  list_site_versions: "marketing_manager",
  rollback_site: "brand_admin",
};
const ARI_TOOLS = Object.keys(ARI_TOOL_ROLES);

/** Slice one top-level GitHub Actions job block from a workflow YAML string. */
function workflowJobSection(yaml, jobKey) {
  const re = new RegExp(`^  ${jobKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*$`, "m");
  const m = re.exec(yaml);
  if (!m) return "";
  const start = m.index;
  const afterHeader = yaml.slice(start + m[0].length);
  const next = afterHeader.search(/\n  [A-Za-z0-9_-]+:\s*$/m);
  return next === -1
    ? yaml.slice(start)
    : yaml.slice(start, start + m[0].length + next);
}

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}
function forbid(source, token, label, failures) {
  if (source.toLowerCase().includes(token.toLowerCase())) {
    failures.push(`${label}: forbidden ${token}`);
  }
}
/** One `CREATE OR REPLACE FUNCTION public.<name>(...) ... $$;` block, or "". */
function sqlFunctionBody(source, name) {
  return source.match(
    // #2829 W8 — newer migrations close bodies with `$function$;`.
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$(?:function)?\\$;`),
  )?.[0] ?? "";
}
function json(source, label, failures) {
  try {
    return JSON.parse(source);
  } catch {
    failures.push(`${label}: invalid JSON`);
    return {};
  }
}

/** Parse an exact `"x.y.z"` (optional leading ^/~) into [maj,min,pat] or null. */
function parseSemverTriple(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/^[~^]/, "");
  const parts = cleaned.split(".").map((part) => Number(part));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isInteger(n) || n < 0)) return null;
  return parts.slice(0, 3);
}

function versionGte(actual, floor) {
  for (let i = 0; i < 3; i += 1) {
    if (actual[i] > floor[i]) return true;
    if (actual[i] < floor[i]) return false;
  }
  return true;
}

function assertDompurifyOverride(raw, label, failures) {
  const version = parseSemverTriple(raw);
  if (
    version === null ||
    version[0] !== DOMPURIFY_MAJOR ||
    !versionGte(version, DOMPURIFY_ADVISORY_FLOOR)
  ) {
    failures.push(`${label}: DOMPurify override drifted`);
  }
}

/** Exact dep map minus `next`, plus next major+floor (advisory soft pin — #3713). */
function assertProductionDependencies(actualDeps, exactWithoutNext, label, driftPhrase, failures) {
  const actual = actualDeps && typeof actualDeps === "object" ? actualDeps : {};
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = [...Object.keys(exactWithoutNext), "next"].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    failures.push(`${label}: ${driftPhrase}`);
    return;
  }
  for (const [name, version] of Object.entries(exactWithoutNext)) {
    if (actual[name] !== version) {
      failures.push(`${label}: ${driftPhrase}`);
      return;
    }
  }
  const nextTriple = parseSemverTriple(actual.next);
  if (!nextTriple) {
    failures.push(`${label}: next version unparseable (${actual.next ?? "missing"})`);
    return;
  }
  if (nextTriple[0] !== NEXT_MAJOR) {
    failures.push(`${label}: next major must remain ${NEXT_MAJOR} (got ${actual.next})`);
    return;
  }
  if (!versionGte(nextTriple, NEXT_ADVISORY_FLOOR)) {
    failures.push(
      `${label}: next advisory floor — must be >= ${NEXT_ADVISORY_FLOOR.join(".")} (got ${actual.next})`,
    );
  }
}


export function violations(files) {
  const failures = [];
  const migration = files.migration ?? "";
  // [TEST-MOD-APPROVED #2893] The approved forward-only live-readiness repair
  // pins the already-merged foundation byte-for-byte and adds new checks below;
  // no existing #2830 assertion is weakened or removed.
  if (
    crypto.createHash("sha256").update(migration).digest("hex") !==
      "000116c86351b3d11fd95fec97002c87598ee3de88653ea2ecfb811500216d71"
  ) failures.push("Core foundation migration: historical migration was modified");
  for (const table of [
    "brand_sites",
    "brand_site_hosts",
    "brand_site_publications",
    "brand_site_editor_exchanges",
    "brand_site_operation_receipts",
    "brand_site_audit_log",
    "brand_site_gateway_nonces",
    "brand_site_attribution_touches",
    "brand_site_analytics_events",
    "brand_site_service_config",
  ]) {
    need(migration, `ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`, "Core forced RLS", failures);
  }
  for (const token of [
    "p_min_rank integer",
    "'ari.sites.read_site', 'read'",
    "'ari.sites.rollback', 'write'",
    "v_capability_count <> 132",
    "0de714ca5cf4f3a78dea892dabaadde8c22d09407d939ec366a239b6d63953ad",
    "extensions.digest(",
    "extensions.gen_random_bytes(32)",
    "v_rank < p_min_rank",
    "v_rank < 20",
    "backup_retention_days",
    "interval '26 hours'",
    "interval '100 days'",
    "last_successful_publication_id",
    "rollback_source_publication_id",
    "brand_site_bind_checkout_attribution",
    "site_attribution_token_digest",
    "gogi.sites.usemingla.com",
    "sites.usemingla.com",
    "REVOKE ALL ON TABLE public.brand_sites FROM PUBLIC, anon, authenticated",
    "REVOKE ALL ON TABLE public.brand_site_analytics_events FROM PUBLIC, anon, authenticated",
    "p_probe_summary->>'observed_digest' <> p_artifact_digest",
    "p_probe_summary->>'leak_check_ok'",
    "brand_site_enforce_publication_transition",
    "brand_site_enforce_receipt_transition",
    "CREATE OR REPLACE FUNCTION public.brand_site_mark_operation_ambiguous",
    "p_target_operation_id uuid DEFAULT NULL",
    "COALESCE(p_target_operation_id::text, '-')",
    "receipt.status = 'ambiguous'",
    "operation.reconcile_checked",
    "cms_origin !~ '(localhost|127\\.0\\.0\\.1|@|\\*|\\?|#)'",
  ]) need(migration, token, "Core migration", failures);
  need(
    migration,
    "pilot_site_id IS NULL OR pilot_brand_id IS NOT NULL",
    "Gogi pilot bootstrap boundary",
    failures,
  );
  const provision = migration.match(
    /CREATE OR REPLACE FUNCTION public\.brand_site_provision\([\s\S]*?\n\$\$;/,
  )?.[0] ?? "";
  for (const token of [
    "SELECT config.pilot_brand_id INTO v_pilot_brand_id",
    "WHERE config.config_key = 'sites_v1'",
    "FOR SHARE",
    "v_pilot_brand_id IS DISTINCT FROM p_brand_id",
  ]) need(provision, token, "Gogi pilot provisioning boundary", failures);
  for (const token of ["pilot_site_id", "pilot_enabled"]) {
    forbid(provision, token, "Gogi pilot provisioning bootstrap", failures);
  }
  if (
    provision.indexOf("v_pilot_brand_id IS DISTINCT FROM p_brand_id") >
      provision.indexOf("INSERT INTO public.brand_sites")
  ) {
    failures.push("Gogi pilot provisioning boundary: allowlist runs after site creation");
  }
  forbid(migration, "CREATE POLICY scanner", "scanner isolation", failures);

  const liveMigration = files.liveMigration ?? "";
  for (const token of [
    "CREATE TABLE public.brand_site_readiness_receipts",
    "brand_site_readiness_receipt_immutable",
    "CREATE OR REPLACE FUNCTION public.brand_site_configure_pilot_binding",
    "CREATE OR REPLACE FUNCTION public.brand_site_record_readiness_evidence",
    "CREATE OR REPLACE FUNCTION public.brand_site_record_host_readiness",
    "CREATE OR REPLACE FUNCTION public.brand_site_activate_gogi_pilot",
    "CREATE OR REPLACE FUNCTION public.brand_site_deactivate_gogi_pilot",
    "CREATE OR REPLACE FUNCTION public.brand_site_business_availability",
    "CREATE OR REPLACE FUNCTION public.brand_site_retention_protection",
    "interval '26 hours'",
    "interval '100 days'",
    "interval '15 minutes'",
    "host.status = 'pending' AND host.activated_at IS NULL",
    "pilot_enabled = true",
    "pilot_enabled = false",
    "733bc470-45e1-4684-8896-acd7e26074ff",
    "1f3d2ddf-b741-4e2f-8884-d7222a660c7e",
    "https://studio.sites.usemingla.com",
    "https://gogi.sites.usemingla.com",
    "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER",
    "TO service_role, postgres",
    "TO authenticated, postgres",
  ]) need(liveMigration, token, "Core live-readiness repair", failures);
  forbid(
    liveMigration,
    "GRANT EXECUTE ON FUNCTION public.brand_site_activate_gogi_pilot(uuid,uuid,text,uuid)\n  TO authenticated",
    "Core live-readiness service boundary",
    failures,
  );

  // [TEST-MOD-APPROVED #2829] SPEC A6 retarget. #2829 removed the single Gogi
  // pilot binding (activate/deactivate switch, pilot_* columns, literal
  // brand/operator/host). Each assertion on that removed switch is replaced by
  // the assertion on its replacement; the old → new table is in the #2829 PR.
  const liveSql = files.liveSql ?? "";
  for (const token of [
    "stale database backup evidence recorded",
    "wrong host readiness accepted",
    "host readiness operation did not verify and replay",
    "entitled brand without a website got wrong availability",
    "readiness receipt was mutable",
  ]) need(liveSql, token, "Core live-readiness SQL regression", failures);
  const multiBrandSql = files.multiBrandSql ?? "";
  for (const token of [
    // missing evidence → a new site's first publish needs recovery evidence.
    "first publish without recovery evidence",
    "production accepted local_synthetic evidence",
    // missing host evidence / wrong binding → a host is bound to its own label
    // and site, and only provisioning activates it.
    "provisioned subdomain not activated",
    "subdomain host not bound to its label",
    "host resolution crossed sites",
    "host binding crossed sites",
    "an unknown host resolved",
    // non-pending host → suspended / revoked / deleted sites never resolve.
    "a suspended site resolved",
    "a soft-deleted brand''s site resolved",
    "revocation wrong (site must hide, publications stay, others up)",
    // stale evidence → alerts and keeps every site up (hold-and-page).
    "stale recovery evidence took a site down or was not recorded",
    "resolver gates on recovery evidence",
    // #2829 W11 (A7) — full strength again for the three pins B1 had to move
    // to source: stale manifest / restore drill / host probe evidence is
    // refused behaviourally (never recorded), blocks a new site's first
    // publish, and leaves the published site resolving.
    "RAISE EXCEPTION 'stale manifest evidence recorded';",
    "'object_manifest_verified_at', to_char((clock_timestamp() - interval '26 hours 1 second')",
    "RAISE EXCEPTION 'stale restore drill evidence recorded';",
    "'restore_drill_verified_at', to_char((clock_timestamp() - interval '100 days 1 second')",
    "IF NOT v_failed THEN RAISE EXCEPTION 'first publish allowed on a stale %', v_case; END IF;",
    "FOREACH v_case IN ARRAY ARRAY['manifest', 'restore_drill'] LOOP",
    "RAISE EXCEPTION 'stale host probe accepted';",
    "clock_timestamp() - interval '15 minutes 1 second', 'w1-cafe-nono.sites.usemingla.com',",
    // deactivation fail-safe / exact replay → owner offline hides exactly one
    // site, replays idempotently, and back online restores the same last-good.
    "owner offline did not hide exactly that site",
    "back online did not restore the same publication",
    "offline/online not audited exactly once each",
    // general availability still respects an explicit administrative revoke.
    "explicitly revoked brand reported available",
    "an explicitly revoked brand provisioned a site",
    "revoked brand authorized for Studio",
    // the binding is gone, and no single-tenant literal survives anywhere.
    "pilot activation functions survived",
    "single-tenant literal in current function definition(s): %",
    // #3652 — a touch is spent only on a real order of its own brand.
    "a touch was spent on an order it never verified",
  ]) need(multiBrandSql, token, "Core multi-brand SQL regression", failures);

  // The same freshness windows the pilot switch enforced now gate a NEW site's
  // first publish, the evidence recorder, and host readiness.
  const multiBrandMigration = files.multiBrandMigration ?? "";
  const authorizeBody = sqlFunctionBody(multiBrandMigration, "brand_site_authorize_operation");
  for (const token of [
    "OR (p_kind IN ('publish','rollback') AND v_rank < 50)",
    "OR NOT public.brand_site_entitled(v_site.brand_id) THEN",
    "IF p_kind = 'publish' AND v_site.last_successful_publication_id IS NULL THEN",
    "AND v_config.database_backup_verified_at > clock_timestamp() - interval '26 hours'",
    "AND v_config.object_manifest_verified_at > clock_timestamp() - interval '26 hours'",
    "AND v_config.restore_drill_verified_at > clock_timestamp() - interval '100 days'",
    "OR (v_config.environment = 'local' AND v_latest_source = 'local_synthetic')",
  ]) need(authorizeBody, token, "Core multi-brand first-publish readiness", failures);
  const evidenceBody = sqlFunctionBody(multiBrandMigration, "brand_site_record_readiness_evidence");
  for (const token of [
    "OR v_database_at <= v_accepted_at - interval '26 hours'",
    "OR v_manifest_at <= v_accepted_at - interval '26 hours' THEN",
    "OR v_restore_at <= v_accepted_at - interval '100 days' THEN",
  ]) need(evidenceBody, token, "Core multi-brand evidence freshness", failures);
  need(
    sqlFunctionBody(multiBrandMigration, "brand_site_record_host_readiness"),
    "OR p_observed_at <= v_accepted_at - interval '15 minutes' THEN",
    "Core multi-brand evidence freshness",
    failures,
  );
  // deactivation reason code → the recovery alert accepts a closed state set,
  // alters no site, and is service-only.
  const recoveryBody = sqlFunctionBody(multiBrandMigration, "brand_site_record_recovery_state");
  for (const token of [
    "IF p_state IS NULL OR p_state NOT IN ('fresh','late','stale')",
    "'sites_affected', 0);",
    "'recovery_alert',",
  ]) need(recoveryBody, token, "Core recovery alert", failures);
  for (const token of ["UPDATE public.brand_site_hosts", "UPDATE public.brand_sites", "owner_offline_at"]) {
    forbid(recoveryBody, token, "Core recovery alert takes nothing down", failures);
  }
  need(
    multiBrandMigration,
    "REVOKE ALL ON FUNCTION public.brand_site_record_recovery_state(text, timestamptz) FROM PUBLIC, anon, authenticated;",
    "Core recovery alert",
    failures,
  );
  // Request-scoped host binding: only granted, live, non-deleted brands resolve.
  for (const source of [multiBrandMigration, files.customDomainsMigration ?? ""]) {
    for (const name of ["brand_site_resolve_publication", "brand_site_resolve_host"]) {
      const body = sqlFunctionBody(source, name);
      for (const token of [
        "ON entitlement.brand_id = site.brand_id AND entitlement.status = 'granted'",
        "WHERE host.hostname = lower(p_hostname)",
        "AND brand.deleted_at IS NULL",
      ]) need(body, token, `Core host binding (${name})`, failures);
    }
    need(
      sqlFunctionBody(source, "brand_site_resolve_publication"),
      "AND site.owner_offline_at IS NULL",
      "Core host binding (brand_site_resolve_publication)",
      failures,
    );
  }
  // #3652 — the SQL half of the order binding.
  const consumeBody = sqlFunctionBody(multiBrandMigration, "brand_site_consume_attribution");
  for (const token of [
    "OR v_order.brand_id IS DISTINCT FROM v_touch.brand_id",
    "OR v_order.venue_id IS DISTINCT FROM public.brand_site_orderable_venue(v_touch.site_id)",
  ]) need(consumeBody, token, "Core #3652 order binding", failures);

  // #3157 — a publish certified itself green against a path the public could
  // not reach, and the kill switch left no audit row. Both halves are pinned.
  const reachability = files.reachabilityMigration ?? "";
  for (const token of [
    "CREATE OR REPLACE FUNCTION public.brand_site_record_public_reachability",
    "ADD COLUMN public_checked_at timestamptz",
    "ADD COLUMN public_status_code integer",
    "ADD COLUMN public_reachable boolean",
    "'publication.public_check'",
    "'pilot.activated'",
    "'pilot.deactivated'",
    "'public_check'",
    "'live_pointer_changed', false",
    "TO service_role, postgres",
  ]) need(reachability, token, "Sites public reachability record", failures);
  for (const token of [
    "active_publication_id =",
    "last_successful_publication_id =",
    "pilot_enabled = true",
  ]) {
    forbid(
      reachability.match(
        /CREATE OR REPLACE FUNCTION public\.brand_site_record_public_reachability\([\s\S]*?\n\$\$;/,
      )?.[0] ?? "",
      token,
      "Sites public reachability surfaces without acting",
      failures,
    );
  }
  for (const routine of ["activate", "deactivate"]) {
    const body = reachability.match(
      new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.brand_site_${routine}_gogi_pilot\\([\\s\\S]*?\\n\\$\\$;`,
      ),
    )?.[0] ?? "";
    for (const token of [
      "INSERT INTO public.brand_site_audit_log(",
      "'service_config', 'sites_v1'",
      "auth.uid()",
      "'hostname', p_hostname",
    ]) {
      need(body, token, `Gogi pilot ${routine} audit trail`, failures);
    }
  }

  const reachabilitySql = files.reachabilitySql ?? "";
  for (const token of [
    "an unreachable public host rolled back live state",
    "public check wrote no audit row",
    "publication columns did not record the public 404",
    "operation receipt did not carry the public check",
    "the public check annotation was rewritable",
    "public check accepted a different observation on one operation",
  ]) need(reachabilitySql, token, "Sites public reachability SQL regression", failures);
  // [TEST-MOD-APPROVED #2829] SPEC A6 retarget: the pilot activate/deactivate
  // audit rows went with the switch. What can now take a site dark (owner
  // offline, entitlement grant/revoke) is audited, and a refused call is not:
  // the grant count is exact after two refused calls on the same brand.
  for (const token of [
    "RAISE EXCEPTION 'grants were not audited';",
    "WHERE action = 'entitlement.granted' AND actor_kind = 'admin'",
    "AND brand_id IN (v_brand_a, v_brand_b, v_brand_c)) <> 3 THEN",
    "a brand owner granted Sites to itself",
    "offline/online not audited exactly once each",
  ]) need(files.multiBrandSql ?? "", token, "Sites audit trail SQL regression", failures);
  for (const routine of ["set_owner_offline", "admin_grant", "admin_revoke"]) {
    const body = sqlFunctionBody(files.multiBrandMigration ?? "", `brand_site_${routine}`);
    for (const token of ["INSERT INTO public.brand_site_audit_log(", "v_actor uuid := auth.uid();"]) {
      need(body, token, `Sites ${routine} audit trail`, failures);
    }
  }
  for (const routine of ["admin_grant", "admin_revoke"]) {
    need(
      sqlFunctionBody(files.multiBrandMigration ?? "", `brand_site_${routine}`),
      "IF v_actor IS NULL OR NOT public.is_admin_user() THEN",
      `Sites ${routine} audit trail`,
      failures,
    );
  }

  const reachabilityDeno = files.reachabilityDeno ?? "";
  for (const token of [
    "the check did not request the public host",
    "a 404 was reported reachable",
    "a failed connection invented a status code",
    "the publish is never failed by the check itself",
  ]) need(reachabilityDeno, token, "Sites public reachability Deno regression", failures);

  const reachabilityCallback = files.callback ?? "";
  for (const token of [
    "export async function observePublicHost",
    "export async function recordPublicReachability",
    'const publicCheck = await recordPublicReachability({',
    "brand_site_record_public_reachability",
    "publish.public_check.",
  ]) need(reachabilityCallback, token, "Sites publish public check wiring", failures);
  if (
    reachabilityCallback.indexOf("brand_site_complete_publication") >
      reachabilityCallback.indexOf("const publicCheck = await recordPublicReachability({")
  ) {
    failures.push(
      "Sites publish public check wiring: the public check runs before the live pointer moves",
    );
  }
  need(
    files.secretWorkflow ?? "",
    "issue_3157_publish_public_reachability.test.ts",
    "Sites public reachability CI lane",
    failures,
  );

  const deployWrapper = files.deployWrapper ?? "";
  for (const token of [
    'PROJECT_REF="gqnoajqerqhnvulmnyvv"',
    "brand-site-control",
    "brand-site-cms-callback",
    "brand-site-runtime-resolve",
    "brand-site-attribution",
    "--use-api",
    "--no-verify-jwt",
    'functions list --project-ref "$PROJECT_REF" --output json',
  ]) need(deployWrapper, token, "Sites exact Edge deploy wrapper", failures);
  for (const token of ["--prune", "db push", 'for dir in "$functions_root"']) {
    forbid(deployWrapper, token, "Sites exact Edge deploy wrapper", failures);
  }
  need(
    files.deployWrapperTest ?? "",
    "deploys only the four pinned functions through the API",
    "Sites Edge deploy wrapper regression",
    failures,
  );

  const security = files.security ?? "";
  if ((security.match(/Deno\.env\.get\(ENVELOPE_NAME\)/g) ?? []).length !== 1) {
    failures.push("slot 88: exactly one environment read required");
  }
  for (const token of [
    "MAX_SERIALIZED_BYTES = 48 * 1024",
    "KID_RE = /^[A-Za-z0-9_.-]{8,64}$/",
    "resolveCoreToCmsSigner",
    "resolveCmsToCoreVerifier",
    "resolveRuntimeToCoreVerifier",
    "resolveSitesAttributionPepper",
    "materials.push(pepper)",
  ]) need(security, token, "slot 88 parser", failures);
  forbid(security, "console.", "slot 88 parser", failures);

  for (const token of [
    "request_id",
    "operation_id",
    "site_id",
    "publication_id",
    "state_transition",
    "latency_ms",
    "retry_count",
    "safe_error_code",
    "version: \"sites-v1\"",
  ]) need(files.observability ?? "", token, "safe Edge observability", failures);
  for (const token of [
    'service.rpc("brand_site_mark_operation_ambiguous"',
    'p_safe_error_code: "SERVICE_TEMPORARILY_UNAVAILABLE"',
  ]) need(files.control ?? "", token, "ambiguous Core-to-CMS transport", failures);
  for (const token of [
    'service.rpc("brand_site_mark_operation_ambiguous"',
    'p_safe_error_code: "CALLBACK_AMBIGUOUS"',
    "/readiness-evidence",
    'value.evidence_kind === "nightly_backup"',
    'value.evidence_kind === "restore_drill"',
    '"brand_site_record_readiness_evidence"',
    '"brand_site_retention_protection"',
    // [TEST-MOD-APPROVED #2829] SPEC A6 retarget: the signed pilot
    // deactivation became a recovery-state alert that names nothing to
    // switch off, and every site-scoped route (incl. #3651 authorize) is bound
    // to the site the envelope was signed for.
    "/recovery-state$/",
    'value.state === "fresh" || value.state === "late" ||',
    'const RECOVERY_STATE_KEYS = [\n  "observed_at",\n  "schema_version",\n  "state",\n] as const;',
    '"brand_site_record_recovery_state"',
    "emitRecoveryAlert(String(parsed.state), requireUuid(envelope.operation_id));",
    "sites_taken_offline: 0,",
    "const siteId = requireUuid(authorizeMatch[1]);\n      if (siteId !== envelope.site_id) throw new Error(\"TENANT_MISMATCH\");",
    "const siteId = requireUuid(recoveryStateMatch[1]);\n      if (siteId !== envelope.site_id) throw new Error(\"TENANT_MISMATCH\");",
  ]) need(files.callback ?? "", token, "ambiguous CMS callback", failures);
  for (const token of ["brand_site_deactivate_gogi_pilot", "pilot_site_id", "pilot-deactivation"]) {
    forbid(files.callback ?? "", token, "ambiguous CMS callback", failures);
  }
  for (const forbidden of [
    "authorization:",
    "signature_b64:",
    "cookie:",
    "raw_body:",
    "storage_url:",
  ]) forbid(files.observability ?? "", forbidden, "safe Edge observability", failures);

  const manifest = json(files.manifest ?? "", "secret manifest", failures);
  const sitesSecret = manifest.secrets?.find((row) => row.name === "MINGLA_SITES_SECURITY_JSON");
  if (
    // #3645: the payout-release RAK is the approved 90th and final name.
    manifest.rollout?.expected_user_managed_count !== 90 ||
    manifest.secrets?.length !== 90 ||
    manifest.exceptions?.length !== 1 ||
    manifest.exceptions?.[0]?.issue !== 2830 ||
    sitesSecret?.class !== "credential_bundle" ||
    sitesSecret?.issue !== 2830 ||
    sitesSecret?.readers?.length !== 1 ||
    sitesSecret.readers[0] !== "supabase/functions/_shared/sitesSecurity.ts" ||
    sitesSecret?.bundle_fields?.length !== 14
  ) failures.push("slot 88: exact manifest contract missing");

  const ariTools = files.ariTools ?? "";
  const toolNames = [...ariTools.matchAll(/publicationTool\("([^"]+)"\)|^\s*"((?:get|list|start|record|propose|attach|validate|save|update|create|run|confirm)_[^"]+)"/gm)]
    .map((match) => match[1] || match[2])
    .filter((name, index, names) => name && names.indexOf(name) === index);
  for (const name of ARI_TOOLS) {
    need(ariTools, `"${name}"`, "Ari closed tool registry", failures);
    need(files.ariAuthorization ?? "", `${name}: role("${ARI_TOOL_ROLES[name]}", "brand")`, "Ari authorization", failures);
  }
  if (
    toolNames.length !== ARI_TOOLS.length ||
    toolNames.some((name) => !ARI_TOOLS.includes(name)) ||
    ARI_TOOLS.some((name) => !toolNames.includes(name))
  ) failures.push("Ari closed tool registry: exact tool set drifted");

  const flag = files.businessFlag ?? "";
  // #2829 general availability: Sites defaults on while the statically read
  // environment value remains the emergency kill switch.
  need(flag, "sites: readEnvFlag(process.env.EXPO_PUBLIC_FF_SITES_ENABLED, true)", "Business feature flag", failures);
  forbid(flag, "process.env[", "Business static feature flag", failures);
  const route = files.businessRoute ?? "";
  for (const token of [
    // [TEST-MOD-APPROVED #2829] SPEC A6 retarget (A5): the client rank copy
    // (rank >= 20 to open, < 20 to redirect) became Core's per-brand
    // availability answer (entitlement + live rank, pinned in the Core
    // migration below); an error or a "no" redirects out.
    "const availability = useBrandSiteAvailability(safeBrandId, canCheckAvailability);",
    "const websiteAvailable: boolean | null = availability.isError\n    ? false",
    "const capabilities = capabilitiesFrom(availability.data);",
    "if (!capabilities.canCreate || provisionOperation === null) return;",
    "useBrandSitePreview",
    "usePublishBrandSite",
    "useRollbackBrandSite",
    // [TEST-MOD-APPROVED #2829] W9r retarget: the route's JSX prop became the controller's field.
    "isPreviewing: preview.isPending",
    "loadPublicationOperation",
    "onReconcilePublication",
    "onResetFailedPublication",
    "!canResetFailedPublicationOperation(",
    "operationId: operation.operationId",
  ]) need(route, token, "Business Website route", failures);
  need(
    route,
    "await persistPublicationOperation(operation);",
    "durable publication dispatch",
    failures,
  );
  need(
    files.businessView ?? "",
    "if (!props.capabilities.canEdit && !canPublish && !canProvision) return null;",
    "rank-10 zero signal",
    failures,
  );
  forbid(route, "useCurrentBrandRole", "Business Website route", failures);
  // Core owns the rank rule: rank-10 members get nothing, marketing manager
  // (20) edits, brand admin/owner (50) creates and publishes, and an explicitly
  // revoked brand is unavailable to everyone.
  const availabilityBody = sqlFunctionBody(
    files.multiBrandMigration ?? "",
    "brand_site_business_availability",
  );
  for (const token of [
    "IF v_actor IS NULL OR v_rank < 20 THEN",
    "IF NOT public.brand_site_entitled(p_brand_id) THEN",
    "'can_create', v_rank >= 50,",
    "'can_publish', v_rank >= 50,",
    "'can_edit', v_rank >= 20,",
  ]) need(availabilityBody, token, "rank-10 zero signal", failures);
  need(
    files.businessContracts ?? "",
    "if (!availability || availability.available !== true) return NO_WEBSITE_CAPABILITIES;",
    "rank-10 zero signal",
    failures,
  );
  for (const token of [
    "onResetFailedPublication",
    "View operation details",
    "View live website",
    'result_summary?.retryable === true',
    "Last good preserved",
    "Check the same operation",
  ]) need(files.businessPublish ?? "", token, "terminal publication recovery", failures);
  // [TEST-MOD-APPROVED #2829] W9r: the redirect moved from the route into the shell.
  need(files.businessView ?? "", "if (canCheckAvailability && websiteAvailable === false) {", "Business Website route", failures);
  for (const token of [
    'const PUBLICATION_OPERATION_PREFIX = "mingla:brand-site-publication:v1:"',
    "publicationOperationKey(",
    "accountId: string",
    "brandId: string",
    "siteId: string",
  ]) need(files.businessService ?? "", token, "durable publication scope", failures);
  for (const token of [
    "export const WEBSITE_JOURNEY",
    "deriveBusinessWebsiteState",
    "25:",
    "30:",
  ]) need(files.businessJourney ?? "", token, "explicit Website journey owner", failures);
  for (const token of [
    "loadBrandWebsiteEntryContext",
    '"brand-site-control"',
    'return "Not set up"',
    'return "Publishing…"',
  ]) need(files.businessEntry ?? "", token, "status-aware Brand Profile entry", failures);
  need(files.businessProfile ?? "", 'import("../../sites/brandWebsiteEntry")', "lazy Brand Profile entry boundary", failures);
  for (const token of [
    "websiteContext !== null",
    "setWebsiteContext(null)",
  ]) need(files.businessProfile ?? "", token, "non-pilot Website zero signal", failures);
  forbid(files.businessProfile ?? "", "Checking website status…", "non-pilot Website zero signal", failures);
  forbid(files.businessProfile ?? "", "Status unavailable", "non-pilot Website zero signal", failures);
  for (const token of [
    "/site-availability",
    "if (data.data.available !== true) return null",
  ]) need(files.businessEntry ?? "", token, "Core-backed Website availability", failures);
  for (const token of [
    "websiteAvailable === false",
    "websiteAvailable !== true",
  ]) need(files.businessView ?? "", token, "direct Website route availability", failures);
  forbid(files.businessProfile ?? "", 'import("../../services/brandSitesService")', "Business eager bundle boundary", failures);
  forbid(files.businessProfile ?? "", 'import("../../sites/websiteJourney")', "Business eager bundle boundary", failures);
  for (const source of [files.businessView, files.businessPublish, files.businessAddresses, files.businessOverview]) {
    forbid(source ?? "", "Journey state", "customer-safe Website state", failures);
  }
  for (const token of [
    "export const STUDIO_RETURN_RESULTS = [",
    "brandWebsiteReturnPath",
    "studioResult=",
  ]) need(files.businessReturn ?? "", token, "validated Business return owner", failures);
  for (const source of [route, files.businessView ?? "", files.businessPublish ?? "", files.businessAddresses ?? "", files.businessOverview ?? ""]) {
    forbid(source, "custom domain", "deferred domain UI", failures);
    for (const provider of ["Vercel", "Payload", "Supabase", "Neon"]) {
      forbid(source, provider, "customer provider neutrality", failures);
    }
  }

  const cmsPackage = json(files.cmsPackage ?? "", "CMS package", failures);
  assertProductionDependencies(
    cmsPackage.dependencies,
    EXACT_CMS_DEPENDENCIES,
    "CMS package",
    "production dependency set/version drifted",
    failures,
  );
  assertDompurifyOverride(cmsPackage.overrides?.dompurify, "CMS package", failures);
  const publicPackage = json(files.publicPackage ?? "", "public package", failures);
  assertProductionDependencies(
    publicPackage.dependencies,
    EXACT_PUBLIC_DEPENDENCIES,
    "public runtime",
    "production dependency isolation drifted",
    failures,
  );
  assertDompurifyOverride(publicPackage.overrides?.dompurify, "public runtime", failures);

  const cmsConfig = files.cmsConfig ?? "";
  for (const token of [
    "MINGLA_CMS_TO_CORE_CURRENT_KID",
    "MINGLA_CMS_TO_CORE_CURRENT_KEY_B64",
    "MINGLA_CORE_TO_CMS_CURRENT_KID",
    "MINGLA_CORE_TO_CMS_CURRENT_KEY_B64",
    "MINGLA_CORE_TO_CMS_PREVIOUS_KID",
    "MINGLA_CORE_TO_CMS_PREVIOUS_KEY_B64",
  ]) need(cmsConfig, token, "CMS least-privilege key projection", failures);
  for (const token of [
    "SITES_CMS_TO_CORE_HMAC_PREVIOUS",
    "MINGLA_RUNTIME_TO_CORE",
    "MINGLA_SITES_SECURITY_JSON",
    "attribution_pepper",
  ]) forbid(cmsConfig, token, "CMS least-privilege key projection", failures);
  for (const token of [
    "graphQL: { disable: true }",
    "schemaName: \"sites_cms\"",
    "process.env.NODE_ENV !== \"production\"",
    "cleanupAfterTenantDelete: false",
  ]) need(files.cmsPayload ?? "", token, "stripped Studio", failures);
  for (const token of [
    "canAccessStudioAdmin",
    "Boolean(req.user)",
    "admin: { hidden: true }",
    "admin: canAccessStudioAdmin",
    "read: readExactStudioUser",
  ]) need(files.cmsUsers ?? "", token, "Studio admin admission", failures);
  for (const token of [
    "if (body.destination !== \"studio\")",
    "encodePreviewGrant",
    "source_digest",
    "buildPublicationArtifact",
    "probePublicationCandidate",
    "buildRollbackPublicationArtifact",
    "readCorePublicationSource",
    "await runRetentionSweep(",
    "tombstoneMedia",
    'path: "/mingla/media-library"',
    'path: "/mingla/media/:mediaId/attach"',
    "applyStudioMediaSelection",
    "assertMutationRequest(req.headers)",
    "signedCoreRequest",
    "previewGrantRequest",
  ]) need(files.cmsEndpoints ?? "", token, "Studio gateway", failures);
  // [TEST-MOD-APPROVED #2893] The tenant-authorized media restore endpoint is
  // the ninth live Core authorization check; the previous eight remain.
  // #2829 W6 — the three stream-video endpoints (capability, intent, status)
  // are the tenth to twelfth; every earlier check remains.
  const studioAuthCalls = (files.cmsEndpoints ?? "").match(
    /requireAuthenticatedStudioRequest\(req\)/g,
  )?.length ?? 0;
  if (studioAuthCalls !== 12) {
    failures.push(
      `Studio live authorization: expected 12 endpoint checks, found ${studioAuthCalls}`,
    );
  }
  for (const token of [
    "studioUserMatchesSession",
    'if (!session || !req.user) throw new Error("SESSION_EXPIRED")',
    'throw new Error("FORBIDDEN")',
    "delete context.minglaSignedCore",
    "studioMediaGrantRequest",
    "loadStudioMediaAttachRecords",
    "req: studioMediaGrantRequest(request)",
  ]) need(files.cmsStudioAuth ?? "", token, "Studio live authorization", failures);
  const signedCoreStrips = (files.cmsStudioAuth ?? "").match(
    /delete context\.minglaSignedCore/g,
  )?.length ?? 0;
  if (signedCoreStrips !== 2) {
    failures.push(
      `Studio live authorization: expected 2 signed-Core strips, found ${signedCoreStrips}`,
    );
  }
  for (const token of [
    "MAX_BYTES = 20 * 1024 * 1024",
    "MAX_PIXELS = 40_000_000",
    "const WIDTHS = [320, 640, 960, 1440, 1920]",
    "METADATA_RETAINED",
    "referencedByProtectedPublication",
    "newestRank > 50",
    "90 * 24 * 60 * 60_000",
  ]) need(files.cmsMedia ?? "", token, "media and retention", failures);
  // [TEST-MOD-APPROVED #2893] Restore adds an exact find+update pair under the
  // same narrow media grant, raising the protected operation count 2 -> 4.
  const tombstoneMediaGrantCalls = (files.cmsMedia ?? "").match(
    /req: studioMediaGrantRequest\(req\)/g,
  )?.length ?? 0;
  if (tombstoneMediaGrantCalls !== 4) {
    failures.push(
      `media and retention: expected 4 protected tombstone/restore Media operations, found ${tombstoneMediaGrantCalls}`,
    );
  }
  for (const token of [
    'headers["if-none-match"] = "*"',
    "response.status === 412",
    "await sha256(existing) === await sha256(bytes)",
  ]) need(files.cmsObjectStore ?? "", token, "immutable media write", failures);
  need(
    files.cmsMediaCollection ?? "",
    'if (req.file) throw new Error("MEDIA_REJECTED")',
    "custom media pipeline boundary",
    failures,
  );
  for (const token of [
    "read: systemMediaField",
    "access: systemFieldAccess",
  ]) need(files.cmsMediaCollection ?? "", token, "custom media pipeline boundary", failures);
  const protectedMediaFieldCount = (files.cmsMediaCollection ?? "").match(
    /access: systemFieldAccess/g,
  )?.length ?? 0;
  // #2829 W6 — duration_ms, kind, stream_video_id, stream_url and
  // stream_host are system fields too (14 -> 19); none is owner-writable.
  if (protectedMediaFieldCount !== 19) {
    failures.push(
      `custom media pipeline boundary: expected 19 read-protected system fields, found ${protectedMediaFieldCount}`,
    );
  }
  for (const token of [
    "now + 30 * 60",
    "session.absolute_expires_at",
    "secure: true",
    "httpOnly: true",
    'sameSite: "lax"',
  ]) need(files.cmsProxy ?? "", token, "Studio idle-session boundary", failures);
  for (const token of [
    "decodeSessionReturnContext",
    "decodePreviewReturnContext",
    "studioReturnLocationFromContext",
    "mingla-business://website-return?brandId=",
  ]) need(files.cmsSession ?? "", token, "fixed Studio return owner", failures);
  for (const token of [
    '["Media", "/studio/media"]',
    "Site settings & SEO",
    "Return to Mingla",
  ]) need(files.cmsNav ?? "", token, "stripped Studio navigation", failures);
  for (const token of [
    '"/api/mingla/media/upload-grants"',
    "grant.upload_url",
    "grant.required_headers",
    "for (let attempt = 0; attempt < 10; attempt += 1)",
    "canSelectStudioMedia",
    '"/api/mingla/media-library"',
    "attachStudioMedia",
    "attachment.return_url !== expectedReturn",
  ]) need(files.cmsMediaClient ?? "", token, "executable Studio media manager", failures);
  for (const token of [
    "expectedRevision",
    "pageId",
    "blockIndex",
    "applyStudioMediaSelection",
    'throw new Error("REVISION_CONFLICT")',
  ]) need(files.cmsMediaSelection ?? "", token, "Studio media draft binding", failures);
  for (const token of [
    "JPEG, PNG or WebP",
    "20 MB and 40 megapixels",
    "This image is decorative",
    "Use in draft",
    "Remove unused",
    "window.location.assign(result.return_url)",
    'window.location.replace("/mingla/session-expired")',
  ]) need(files.cmsMediaManager ?? "", token, "accessible Studio media manager", failures);
  forbid(
    files.cmsMediaManager ?? "",
    "mingla:media-selected",
    "executable Studio media manager",
    failures,
  );
  for (const token of [
    'mobile: "320px"',
    'tablet: "768px"',
    'desktop: "min(100%, 1440px)"',
    "Private preview — not live",
    /*
     * [TEST-MOD-APPROVED #2830] SUPERSEDED: "Publish this revision".
     *
     * The label is now "Publish". Measured on a phone, the preview chrome cost
     * 328px at 320pt — a five-row toolbar plus a full-width banner, more of the
     * screen than the website it was previewing. It is one 55px row now, and
     * the long label did not fit. Seth approved the shortening on 2026-09-03.
     *
     * What this token was really guarding is that a publish control EXISTS in
     * the preview and that publishing stays a separate, deliberate act. Both
     * still hold and both are still pinned: the control below, and the
     * "separate confirmation" sentence that moved into the details panel.
     */
    "Publish",
    "Publishing is always a separate confirmation.",
  ]) need(files.cmsPreview ?? "", token, "complete preview chrome", failures);
  /*
   * #2830 — ONLY the Ari tab may import AriChatScreen.
   *
   * A second importer gives Metro two chunks to serve the module from, and it
   * hoists anything shared into the payload every Business user downloads
   * before anything renders. Measured when the Website split view imported it
   * directly: 2,436,294 B to 2,569,912 B, a 133KB regression on the boot path
   * for people who may never open Ari. `React.lazy` does not help — sharing is
   * what hoists, not eagerness.
   *
   * This lives here rather than in a jest file because it is a STRUCTURAL rule
   * about the module graph, which is exactly what I-PROPOSED-1047 says belongs
   * in an additive gate rather than a source-text pin.
   */
  {
    const ariImporters = [
      "mingla-business/app/(tabs)/ari.tsx",
      "mingla-business/app/brand/[id]/website/ari.tsx",
      "mingla-business/app/brand/[id]/website.tsx",
      // #2829 W9r — the Website section's shell is lazy-loaded by that route.
      "mingla-business/src/components/sites/website/WebsiteApp.tsx",
    ].filter((file) => {
      let body = "";
      try {
        body = fs.readFileSync(path.join(ROOT, file), "utf8");
      } catch {
        return false;
      }
      // Strip block comments: this gate's own docblock names the module, and a
      // substring match would flag the file that deliberately does not import it.
      body = body.replace(/\/\*[\s\S]*?\*\//g, "");
      return /from\s+"[^"]*AriChatScreen"/.test(body);
    });
    if (
      ariImporters.length !== 1 ||
      ariImporters[0] !== "mingla-business/app/(tabs)/ari.tsx"
    ) {
      failures.push(
        `AriChatScreen import boundary: must have exactly one importer ` +
          `(app/(tabs)/ari.tsx); found: ${ariImporters.join(", ") || "none"}. ` +
          `A second importer puts ~133KB on every Business user's boot path.`,
      );
    }
  }

  for (const token of [
    "--studio-black: #101013",
    "--studio-gold: #cda052",
    '[data-collection-slug="media"] .upload',
    "repeat(4, minmax(0, 1fr))",
    "repeat(3, minmax(0, 1fr))",
    "repeat(2, minmax(0, 1fr))",
  ]) need(files.cmsStyles ?? "", token, "approved Studio visual shell", failures);
  for (const token of [
    "observedDraftDigest !== input.sourceDigest",
    "await sha256(readback)",
    "restaurant-website-v1",
  ]) need(files.cmsArtifact ?? "", token, "deterministic publication", failures);
  for (const token of [
    "observeCmsEndpoint",
    "mingla_sites_request",
    "media.quarantine_cleanup.failure",
  ]) need(
    `${files.cmsObservability ?? ""}\n${files.cmsEndpoints ?? ""}\n${files.cmsMedia ?? ""}`,
    token,
    "CMS observability",
    failures,
  );

  const publicCombined = [
    files.publicConfig,
    files.publicGateway,
    files.publicConsentContract,
    files.publicPublication,
    files.publicArtifact,
    files.publicRenderer,
    files.publicConsent,
    files.publicEvents,
    files.publicAttributionRoute,
    files.publicSecurityTest,
  ].join("\n");
  for (const token of [
    "MINGLA_RUNTIME_TO_CORE_CURRENT_KID",
    "MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64",
    "await signedCorePost({",
    // [TEST-MOD-APPROVED #2829] SPEC A6 retarget: the one hard-coded Gogi host
    // became "any <label>.<suffix> host Core resolves", and the canonical
    // address must be the resolved site's OWN primary host.
    "if (!LABEL.test(first.slice(0, -tail.length))) throw new Error(\"NOT_FOUND\");",
    // #2829 A8: v1 and v2 artifacts both bind canonical to the site's own
    // address (accessor pinned below). W8 retarget (old -> new): canonical ==
    // primary host became "canonical is the primary or one of THIS site's own
    // addresses as Core lists them" (a brand's own domain can become the main
    // address after publish); another site's address is still refused.
    "!isOwnCanonical(siteCanonicalUrl(artifact), resolution)",
    "if (canonical === canonicalOrigin(resolution)) return true;",
    'if (typeof canonical !== "string" || !canonical.startsWith("https://")) return false;',
    "return Array.isArray(resolution.site_hostnames) && resolution.site_hostnames.includes(host);",
    "return `https://${resolution.primary_hostname}`;",
    "expectedKey",
    "await sha256(bytes)",
    "assertRestaurantArtifact",
    "mingla_site_analytics_consent_v1",
    'edgeFunction: "brand-site-attribution"',
    /*
     * [TEST-MOD-APPROVED #2830] SUPERSEDED:
     *   'aria-labelledby={page.role === "home"'
     *
     * That attribute existed because the renderer concatenated EVERY page into
     * one document, so each page needed a hidden heading to label its own
     * region. Pages are now real routes rendering one at a time, and the
     * attribute went with the concatenation — which is also what stopped the
     * hours block printing three times on the live site.
     *
     * The property it guarded — every page is titled — is pinned harder now:
     * a page with a hero uses the hero as its single h1, and a page without one
     * gets its own title as that h1. Both are asserted below, and the render
     * suite counts the h1s rather than grepping for an attribute.
     */
    '<header className="page-header"',
    "<h1>{current.title}</h1>",
    "primaryHeading={group.index === primaryHeroIndex}",
  ]) need(publicCombined, token, "public last-good runtime", failures);
  for (const token of [
    "export function siteCanonicalUrl(artifact: SiteArtifact): string | undefined {\n  return siteSeo(artifact).canonical_url;\n}",
    "return (isV2Artifact(artifact) ? artifact.seo : artifact.site_settings.seo) ?? {};",
  ]) need(files.publicSiteArtifact ?? "", token, "public last-good runtime", failures);
  for (const forbidden of ["@payloadcms", "from \"payload\"", "postgresAdapter", "sharp(", "lexicalEditor"])
    forbid(publicCombined, forbidden, "public runtime isolation", failures);
  for (const token of [
    "--ink: #101013",
    "--gold: #cda052",
    "--gold-hover: #dfb262",
    "min-width: 320px",
    "min-height: 100svh",
    "76svh",
    ":where(a, button, summary) {\n  min-width: 44px;\n  min-height: 44px;\n}",
    ".gallery {\n  display: grid;\n  grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr));",
    "  .gallery {\n    grid-template-columns: repeat(2, minmax(0, 1fr));",
    ".gallery > * {\n  min-width: 0;\n}",
    "@media (prefers-reduced-motion: reduce)",
  ]) need(files.publicStyles ?? "", token, "Restaurant Website v1 visual contract", failures);
  // #2829 A8: the same visual contract, as atelier (v2) draws it: tokens in, the v1 values as defaults.
  for (const token of [
    "--ink: var(--c-canvas);",
    "--gold: var(--c-accent-400);",
    "--gold-hover: var(--c-accent-300);",
    "min-width: 320px",
    "min-height: 100svh",
    "76svh",
    '[data-design="atelier"] :where(a, button, summary) {\n  min-width: 44px;\n  min-height: 44px;\n}',
    '[data-design="atelier"] .gallery {\n  display: grid;\n  grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr));',
    '  [data-design="atelier"] .gallery {\n    grid-template-columns: repeat(2, minmax(0, 1fr));',
    '[data-design="atelier"] .gallery > * {\n  min-width: 0;\n}',
    "@media (prefers-reduced-motion: reduce)",
  ]) need(files.atelierStyles ?? "", token, "Restaurant Website v1 visual contract (atelier)", failures);
  for (const token of [
    'canvas: "#101013",',
    '300: "#dfb262",\n          400: "#cda052",',
    'seed: "#cda052",',
  ]) need(files.designRegistry ?? "", token, "Restaurant Website v1 visual contract (atelier defaults)", failures);
  for (const token of [
    'className="fact-rail"',
    "editorial-feature",
    "ConsentControl",
    "TrackedLink",
  ]) need(files.publicRenderer ?? "", token, "Restaurant Website v1 composition", failures);
  // [TEST-MOD-APPROVED #2829] SPEC A6 retarget: host resolution is still a
  // signed Core call, now signed with the host-resolution id and pinned to
  // the host in the signed path; every other call is bound to the site Core
  // resolved for THIS request (never the old single configured site id).
  need(
    files.publicPublication ?? "",
    'await signedHostResolution(hostname, "publication");',
    "public last-good runtime",
    failures,
  );
  forbid(files.publicPublication ?? "", "gogi.sites.usemingla.com", "public last-good runtime", failures);
  for (const token of [
    "siteId === HOST_RESOLUTION_SITE_ID ||",
    "!input.path.startsWith(`/internal/v1/sites/${siteId}/`) ||",
    "(input.body.site_id !== undefined && input.body.site_id !== siteId)",
    "path: `/internal/v1/hosts/${hostname}/${kind}`,",
    "siteId: HOST_RESOLUTION_SITE_ID,",
    'throw new Error("SITE_SCOPE_MISMATCH")',
  ]) need(files.publicGateway ?? "", token, "public pilot signing boundary", failures);
  forbid(files.publicGateway ?? "", "pilotSiteId", "public pilot signing boundary", failures);
  // The Core half of the request-scoped binding.
  for (const token of [
    "routeMatch[1].toLowerCase() !== hostname",
    "envelope.site_id !== SITES_HOST_RESOLUTION_SITE_ID &&\n      resolvedSiteId !== envelope.site_id",
  ]) need(files.runtimeResolve ?? "", token, "public pilot signing boundary", failures);
  for (const token of [
    'cookieHeader.split(";")',
    'name === CONSENT_KEY && value === "granted"',
  ]) need(
    files.publicConsentContract ?? "",
    token,
    "public exact consent cookie boundary",
    failures,
  );
  for (const routeSource of [files.publicEvents ?? "", files.publicAttributionRoute ?? ""]) {
    need(
      routeSource,
      'hasGrantedAnalyticsConsent(request.headers.get("cookie"))',
      "public exact consent cookie boundary",
      failures,
    );
  }
  for (const token of [
    "expect(fetchSpy).not.toHaveBeenCalled()",
    '"xmingla_site_analytics_consent_v1=granted"',
    '"mingla_site_analytics_consent_v1=granted-extra"',
  ]) need(files.publicSecurityTest ?? "", token, "public security regression", failures);
  for (const token of [
    "emitPublicObservation",
    "public.stale_last_good",
    "resolution_failed->last_good_served",
  ]) need(
    `${files.publicObservability ?? ""}\n${files.publicPublication ?? ""}`,
    token,
    "public observability",
    failures,
  );
  for (const token of [
    "const envelope = await verifySitesEnvelope",
    "resolveRuntimeToCoreVerifier",
    'expectedDirection: "runtime_to_core"',
    'from("brand_site_gateway_nonces")',
    "REPLAY_DETECTED",
  ]) need(files.attribution ?? "", token, "signed attribution gateway", failures);

  for (const token of [
    "issue_2830_sites_foundation_happy.test.ts",
    "issue_2893_sites_live_readiness.test.ts",
    "final 90-name bundled-authority state",
  ]) need(files.secretWorkflow ?? "", token, "existing secret CI lane", failures);
  for (const token of [
    "mingla-site-cms-build:",
    "mingla-sites-build:",
    "node-version: \"22\"",
    "Public runtime dependency isolation",
  ]) need(files.webWorkflow ?? "", token, "existing build CI lane", failures);
  // #2830 — each Sites/CMS job must run the real allowlist ceiling (not only
  // --self-test). Scoped per job so deleting one lane's command cannot hide
  // behind the other job or a workflow comment.
  const auditCeilingCmd =
    "node ../.github/scripts/npm-audit-ceiling.mjs --allowlist ../.github/npm-audit-allowlist.json";
  need(
    workflowJobSection(files.webWorkflow ?? "", "mingla-site-cms-build"),
    auditCeilingCmd,
    "cms audit ceiling lane",
    failures,
  );
  need(
    workflowJobSection(files.webWorkflow ?? "", "mingla-sites-build"),
    auditCeilingCmd,
    "sites audit ceiling lane",
    failures,
  );
  need(
    files.webWorkflow ?? "",
    "npm-audit-allowlist.json",
    "existing build CI lane",
    failures,
  );
  for (const token of [
    "CMS application/database fault",
    "26 hours",
    "restore drill older than 100 days",
    "tenant escape",
    "last-good pointer recovery",
  ]) need(files.runbook ?? "", token, "Sites operations runbook", failures);
  need(files.denoHappy ?? "", "slot-88 import closure stays exact and value-blind", "implementor regression", failures);
  for (const token of [
    "readiness callback accepts only the two exact v1 bodies",
    "signed retention is bound through the Core projection",
    // [TEST-MOD-APPROVED #2829] SPEC A6 retarget (was: "backup failure can
    // only disable the exact bound Gogi pilot").
    "backup failure records an alert and can disable nothing",
    "a host to switch off was accepted",
    "unknown state accepted",
    "activation is forward-only, atomic, and service-only",
    "exact non-pruning four-function wrapper",
  ]) need(files.denoLive ?? "", token, "live-readiness strict regression", failures);
  for (const token of [
    "site_attribution_token_digest",
    '.is("site_attribution_token_digest",',
  ]) need(files.checkout ?? "", token, "checkout first-touch handoff", failures);

  // #2829 W11 — Sites structural rules (were source-text jest pins).
  const previewPattern = /BUSINESS_PREVIEW_ORIGIN_PATTERN =\s*\/(.+)\/;/.exec(files.bizPreviewFrame ?? "")?.[1];
  if (!previewPattern) failures.push("Sites preview frame: BUSINESS_PREVIEW_ORIGIN_PATTERN literal missing in the Business app");
  else {
    for (const key of ["sitesOrigins", "edgeBusinessOrigin"]) {
      need(files[key] ?? "", previewPattern, "Sites preview frame origin pattern parity", failures);
    }
  }
  need(files.bizPreviewPaneWeb ?? "", "src: previewUrlForFrame(url, ", "Sites web preview pane frames through previewUrlForFrame", failures);
  for (const token of [
    "const guideQuery = usePublicTripGuide(trip.id);",
    "buildTripOfferingData(trip, payload.bookable !== false, allInByTicketType, guideQuery.data)",
  ]) need(files.bizTripRoute ?? "", token, "trip guide on buyer web", failures);
  need(files.bizTripGuideHook ?? "", 'supabase.rpc("pg_public_trip_guide"', "trip guide on buyer web", failures);
  if (/useAuth\(|from "\.\.\/context\/AuthContext"/.test(files.bizTripGuideHook ?? "")) {
    failures.push("trip guide on buyer web: the public guide hook must stay anon-tolerant (no useAuth)");
  }
  for (const token of [
    "const tripGuide = useConsumerTripGuide(detail?.tripId ?? null);",
    "buildConsumerTripOfferingData(detail, tierEnrichment, tripGuide)",
  ]) need(files.consumerTripScreen ?? "", token, "trip guide on consumer iOS/Android", failures);
  need(files.consumerTripData ?? "", 'supabase.rpc("pg_public_trip_guide"', "trip guide on consumer iOS/Android", failures);
  for (const chunk of String(files.websiteSections ?? "").split("\n//@@FILE ").filter(Boolean)) {
    const name = chunk.slice(0, chunk.indexOf("\n"));
    const body = chunk.slice(chunk.indexOf("\n") + 1)
      // The controller passes Core's validation shape through unchanged; it never renders.
      .replace(/renderer: "Restaurant Website v1",/g, "");
    if (/restaurant/i.test(body)) failures.push(`Website copy: ${name} says "restaurant"`);
  }
  if (String(files.websiteSections ?? "").split("\n//@@FILE ").filter(Boolean).length < 10) {
    failures.push("Website copy: fewer than 10 Website section files were scanned");
  }
  return failures;
}

function websiteSectionSources() {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(path.join(ROOT, dir)).sort()) {
      const relative = `${dir}/${name}`;
      if (fs.statSync(path.join(ROOT, relative)).isDirectory()) walk(relative);
      else if (/\.tsx?$/.test(name) && !name.includes(".test.")) {
        out.push(`\n//@@FILE ${relative}\n${fs.readFileSync(path.join(ROOT, relative), "utf8")}`);
      }
    }
  };
  walk(WEBSITE_SECTION_DIR);
  return out.join("");
}

function readFiles() {
  return {
    ...Object.fromEntries(
      Object.entries(PATHS).map(([key, relative]) => [
        key,
        fs.readFileSync(path.join(ROOT, relative), "utf8"),
      ]),
    ),
    websiteSections: websiteSectionSources(),
  };
}

function selfTest() {
  const clean = readFiles();
  const cleanFailures = violations(clean);
  if (cleanFailures.length) throw new Error(`clean fixture failed:\n${cleanFailures.join("\n")}`);
  const reversions = [
    ["liveMigration", "host.status = 'pending' AND host.activated_at IS NULL", "host.status = 'active' AND host.activated_at IS NOT NULL", "Core live-readiness repair"],
    ["denoLive", "activation is forward-only, atomic, and service-only", "activation is optional", "live-readiness strict regression"],
    ["liveMigration", "CREATE OR REPLACE FUNCTION public.brand_site_activate_gogi_pilot", "CREATE OR REPLACE FUNCTION public.brand_site_enable_unverified_pilot", "Core live-readiness repair"],
    ["callback", "/readiness-evidence", "/readiness-unverified", "ambiguous CMS callback"],
    // [TEST-MOD-APPROVED #2829] SPEC A6: the four reversions below that name
    // removed single-tenant behaviour now revert its replacement instead.
    ["callback", "/recovery-state$/", "/recovery-state-removed$/", "ambiguous CMS callback"],
    ["businessProfile", "websiteContext !== null", "websiteContext === null", "non-pilot Website zero signal"],
    ["deployWrapper", "--use-api", "--use-docker", "Sites exact Edge deploy wrapper"],
    ["businessFlag", "readEnvFlag(process.env.EXPO_PUBLIC_FF_SITES_ENABLED, true)", "readEnvFlag(process.env.EXPO_PUBLIC_FF_SITES_ENABLED, false)", "Business feature flag"],
    ["businessFlag", "process.env.EXPO_PUBLIC_FF_SITES_ENABLED", 'process.env["EXPO_PUBLIC_FF_SITES_ENABLED"]', "Business static feature flag"],
    ["businessRoute", "const availability = useBrandSiteAvailability(safeBrandId, canCheckAvailability);", "const availability = useBrandSiteAvailability(safeBrandId, false);", "Business Website route"],
    ["businessRoute", "await persistPublicationOperation(operation);", "await persistPublicationPointer(operation);", "durable publication dispatch"],
    ["businessRoute", "!canResetFailedPublicationOperation(", "!canResetAnyPublicationOperation(", "Business Website route"],
    ["businessService", 'const PUBLICATION_OPERATION_PREFIX = "mingla:brand-site-publication:v1:"', 'const PUBLICATION_OPERATION_PREFIX = "mingla:brand-site-publication:"', "durable publication scope"],
    ["businessJourney", "export const WEBSITE_JOURNEY", "const WEBSITE_JOURNEY", "explicit Website journey owner"],
    ["businessEntry", 'return "Publishing…"', 'return "Website ready"', "status-aware Brand Profile entry"],
    ["businessProfile", 'import("../../sites/brandWebsiteEntry")', 'import("../../services/brandSitesService")', "Business eager bundle boundary"],
    ["businessReturn", "export const STUDIO_RETURN_RESULTS = [", "const STUDIO_RETURN_RESULTS = [", "validated Business return owner"],
    ["migration", " FORCE ROW LEVEL SECURITY", "", "Core forced RLS"],
    ["migration", "CREATE OR REPLACE FUNCTION public.brand_site_mark_operation_ambiguous", "CREATE OR REPLACE FUNCTION public.brand_site_mark_operation_uncertain", "Core migration"],
    ["migration", "v_capability_count <> 132", "v_capability_count <> 120", "Core migration"],
    ["migration", "extensions.gen_random_bytes(32)", "gen_random_bytes(32)", "Core migration"],
    ["migration", "pilot_site_id IS NULL OR pilot_brand_id IS NOT NULL", "(pilot_brand_id IS NULL) = (pilot_site_id IS NULL)", "Gogi pilot bootstrap boundary"],
    ["migration", "v_pilot_brand_id IS DISTINCT FROM p_brand_id", "v_pilot_brand_id IS NULL", "Gogi pilot provisioning boundary"],
    ["security", "Deno.env.get(ENVELOPE_NAME)", "Deno.env.get(ENVELOPE_NAME); Deno.env.get(ENVELOPE_NAME)", "exactly one environment read"],
    ["ariTools", 'publicationTool("rollback_site")', 'publicationTool("rollback_site_removed")', "Ari closed tool registry"],
    ["cmsEndpoints", "await runRetentionSweep(", "await runRetentionSweepRemoved(", "Studio gateway"],
    ["cmsUsers", "read: readExactStudioUser", "read: noAccess", "Studio admin admission"],
    ["cmsMedia", "newestRank > 50", "newestRank > 0", "media and retention"],
    ["cmsMedia", "req: studioMediaGrantRequest(req)", "req", "media and retention"],
    ["cmsMediaCollection", "  read: systemMediaField,\n", "", "custom media pipeline boundary"],
    ["cmsMediaCollection", 'access: systemFieldAccess', 'access: { create: systemMediaField, update: systemMediaField }', "custom media pipeline boundary"],
    ["cmsSession", "decodeSessionReturnContext", "decodeExpiredSessionUnchecked", "fixed Studio return owner"],
    ["cmsStudioAuth", "delete context.minglaSignedCore", "context.minglaSignedCore = true", "Studio live authorization"],
    ["cmsStudioAuth", "req: studioMediaGrantRequest(request)", "req: request", "Studio live authorization"],
    ["cmsEndpoints", "requireAuthenticatedStudioRequest(req)", "sessionFromHeaders(req.headers)", "Studio live authorization"],
    ["cmsNav", '["Media", "/studio/media"]', '["Media", "/admin/collections/media"]', "stripped Studio navigation"],
    ["cmsMediaClient", "grant.upload_url", '"/api/direct-upload"', "executable Studio media manager"],
    ["cmsMediaClient", "attachment.return_url !== expectedReturn", "attachment.return_url === expectedReturn", "executable Studio media manager"],
    ["cmsMediaSelection", "applyStudioMediaSelection", "pretendStudioMediaSelection", "Studio media draft binding"],
    ["cmsMediaManager", "window.location.assign(result.return_url)", 'window.dispatchEvent(new CustomEvent("mingla:media-selected"))', "accessible Studio media manager"],
    ["cmsPreview", 'mobile: "320px"', 'mobile: "375px"', "complete preview chrome"],
    ["cmsStyles", "--studio-gold: #cda052", "--studio-gold: #d85a22", "approved Studio visual shell"],
    ["publicPublication", 'await signedHostResolution(hostname, "publication");', 'await unsignedHostResolution(hostname, "publication");', "public last-good runtime"],
    ["publicGateway", "(input.body.site_id !== undefined && input.body.site_id !== siteId)", "(input.body.site_id !== undefined && input.body.site_id === siteId)", "public pilot signing boundary"],
    // #2829 SPEC A6 — new replacement pins are wired.
    ["callback", '"brand_site_record_recovery_state"', '"brand_site_deactivate_gogi_pilot"', "ambiguous CMS callback"],
    ["callback", "const siteId = requireUuid(authorizeMatch[1]);\n      if (siteId !== envelope.site_id) throw new Error(\"TENANT_MISMATCH\");", "const siteId = requireUuid(authorizeMatch[1]);", "ambiguous CMS callback"],
    ["businessView", "if (!props.capabilities.canEdit && !canPublish && !canProvision) return null;", "if (false) return null;", "rank-10 zero signal"],
    ["multiBrandMigration", "'can_edit', v_rank >= 20,", "'can_edit', v_rank >= 10,", "rank-10 zero signal"],
    ["multiBrandMigration", "OR NOT public.brand_site_entitled(v_site.brand_id) THEN", "THEN", "Core multi-brand first-publish readiness"],
    ["multiBrandMigration", "OR v_restore_at <= v_accepted_at - interval '100 days' THEN", "OR v_restore_at <= v_accepted_at - interval '400 days' THEN", "Core multi-brand evidence freshness"],
    ["multiBrandMigration", "IF p_state IS NULL OR p_state NOT IN ('fresh','late','stale')", "IF p_state IS NULL", "Core recovery alert"],
    ["multiBrandMigration", "OR v_order.brand_id IS DISTINCT FROM v_touch.brand_id", "", "Core #3652 order binding"],
    ["multiBrandSql", "owner offline did not hide exactly that site", "owner offline did something", "Core multi-brand SQL regression"],
    // #2829 W11 — the structural rules moved from jest bite.
    ["edgeBusinessOrigin", "mingla-business-", "mingla-biz-", "Sites preview frame origin pattern parity"],
    ["bizPreviewPaneWeb", "src: previewUrlForFrame(url, ", "src: url, ", "Sites web preview pane frames through previewUrlForFrame"],
    ["bizTripRoute", "const guideQuery = usePublicTripGuide(trip.id);", "const guideQuery = { data: null };", "trip guide on buyer web"],
    ["consumerTripScreen", "buildConsumerTripOfferingData(detail, tierEnrichment, tripGuide)", "buildConsumerTripOfferingData(detail, tierEnrichment, null)", "trip guide on consumer iOS/Android"],
    ["websiteSections", "\n//@@FILE ", "\n//@@FILE injected.tsx\nconst title = \"Restaurant website\";\n//@@FILE ", "Website copy"],
    ["multiBrandSql", "RAISE EXCEPTION 'stale manifest evidence recorded';", "RAISE NOTICE 'stale manifest evidence recorded';", "Core multi-brand SQL regression"],
    ["multiBrandSql", "RAISE EXCEPTION 'stale restore drill evidence recorded';", "RAISE NOTICE 'stale restore drill evidence recorded';", "Core multi-brand SQL regression"],
    ["multiBrandSql", "RAISE EXCEPTION 'stale host probe accepted';", "RAISE NOTICE 'stale host probe accepted';", "Core multi-brand SQL regression"],
    ["multiBrandSql", "clock_timestamp() - interval '15 minutes 1 second', 'w1-cafe-nono.sites.usemingla.com',", "clock_timestamp() - interval '1 minute', 'w1-cafe-nono.sites.usemingla.com',", "Core multi-brand SQL regression"],
    ["multiBrandSql", "FOREACH v_case IN ARRAY ARRAY['manifest', 'restore_drill'] LOOP", "FOREACH v_case IN ARRAY ARRAY['manifest'] LOOP", "Core multi-brand SQL regression"],
    ["multiBrandSql", "RAISE EXCEPTION 'grants were not audited';", "RAISE NOTICE 'grants were not audited';", "Sites audit trail SQL regression"],
    ["publicGateway", "siteId === HOST_RESOLUTION_SITE_ID ||", "", "public pilot signing boundary"],
    ["runtimeResolve", "routeMatch[1].toLowerCase() !== hostname", "false", "public pilot signing boundary"],
    ["publicPublication", "!isOwnCanonical(siteCanonicalUrl(artifact), resolution)", "false", "public last-good runtime"],
    ["publicPublication", "return Array.isArray(resolution.site_hostnames) && resolution.site_hostnames.includes(host);", "return true;", "public last-good runtime"],
    ["publicSiteArtifact", "  return siteSeo(artifact).canonical_url;", "  return undefined;", "public last-good runtime"],
    ["publicConsentContract", 'name === CONSENT_KEY && value === "granted"', 'name.includes(CONSENT_KEY) && value.startsWith("granted")', "public exact consent cookie boundary"],
    ["attribution", "const envelope = await verifySitesEnvelope", "const envelope = await verifyUnsignedEnvelope", "signed attribution gateway"],
    ["publicRenderer", "<h1>{current.title}</h1>", '<h1>{"Page"}</h1>', "public last-good runtime"],
    ["publicRenderer", 'className="fact-rail"', 'className="facts"', "Restaurant Website v1 composition"],
    ["publicStyles", "--gold: #cda052", "--gold: #d85a22", "Restaurant Website v1 visual contract"],
    ["publicStyles", ":where(a, button, summary) {\n  min-width: 44px;\n  min-height: 44px;\n}", ":where(a, button, summary) {\n  min-width: 32px;\n  min-height: 32px;\n}", "Restaurant Website v1 visual contract"],
    ["publicStyles", ".gallery {\n  display: grid;\n  grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr));", ".gallery {\n  display: grid;\n  grid-template-columns: 1.5fr 1fr 1fr;", "Restaurant Website v1 visual contract"],
    ["publicStyles", "  .gallery {\n    grid-template-columns: repeat(2, minmax(0, 1fr));", "  .gallery {\n    grid-template-columns: 1fr 1fr;", "Restaurant Website v1 visual contract"],
    ["publicStyles", ".gallery > * {\n  min-width: 0;\n}", ".gallery > * {\n  min-width: auto;\n}", "Restaurant Website v1 visual contract"],
    ["atelierStyles", "--gold: var(--c-accent-400);", "--gold: var(--c-accent-500);", "Restaurant Website v1 visual contract (atelier)"],
    ["atelierStyles", '[data-design="atelier"] :where(a, button, summary) {\n  min-width: 44px;\n  min-height: 44px;\n}', '[data-design="atelier"] :where(a, button, summary) {\n  min-width: 32px;\n  min-height: 32px;\n}', "Restaurant Website v1 visual contract (atelier)"],
    ["atelierStyles", '  [data-design="atelier"] .gallery {\n    grid-template-columns: repeat(2, minmax(0, 1fr));', '  [data-design="atelier"] .gallery {\n    grid-template-columns: 1fr 1fr;', "Restaurant Website v1 visual contract (atelier)"],
    ["designRegistry", 'canvas: "#101013",', 'canvas: "#ffffff",', "Restaurant Website v1 visual contract (atelier defaults)"],
    ["designRegistry", '300: "#dfb262",\n          400: "#cda052",', '300: "#dfb262",\n          400: "#d85a22",', "Restaurant Website v1 visual contract (atelier defaults)"],
    ["checkout", '.is("site_attribution_token_digest",', '.neq("site_attribution_token_digest",', "checkout first-touch handoff"],
    ["publicPackage", '"next": "16.4.2"', '"@payloadcms/next": "3.88.0",\n    "next": "16.4.2"', "production dependency isolation"],
    ["publicPackage", '"next": "16.4.2"', '"next": "16.3.7"', "next advisory floor"],
    ["cmsPackage", '"next": "16.4.2"', '"next": "15.5.0"', "next major must remain"],
    ["cmsPackage", '"dompurify": "3.4.17"', '"dompurify": "3.4.16"', "DOMPurify override"],
    ["publicPackage", '"dompurify": "3.4.17"', '"dompurify": "3.4.16"', "DOMPurify override"],
    // [TEST-MOD-APPROVED #2829] W9r: the Mingla address line now lives in Addresses.
    ["businessAddresses", "Your website always keeps its Mingla address.", "Configure custom domain", "deferred domain UI"],
    ["businessPublish", "result_summary?.retryable === true", "result_summary?.retryable !== false", "terminal publication recovery"],
    ["businessView", "if (canCheckAvailability && websiteAvailable === false) {", "if (false) {", "Business Website route"],
    ["businessOverview", "testID=\"overview-ari\"", "testID=\"overview-ari\" Journey state", "customer-safe Website state"],
    ["secretWorkflow", "final 90-name bundled-authority state", "final state", "existing secret CI lane"],
    ["webWorkflow", "mingla-sites-build:", "mingla-sites-removed:", "existing build CI lane"],
    // CMS job step name is unique; strip only that lane's --allowlist command.
    [
      "webWorkflow",
      "- name: Dependency security ceiling\n        run: |\n          node ../.github/scripts/npm-audit-ceiling.mjs --self-test\n          node ../.github/scripts/npm-audit-ceiling.mjs --allowlist ../.github/npm-audit-allowlist.json\n",
      "- name: Dependency security ceiling\n        run: |\n          node ../.github/scripts/npm-audit-ceiling.mjs --self-test\n",
      "cms audit ceiling lane",
    ],
    // Sites job: the --allowlist line immediately precedes the isolation probe.
    [
      "webWorkflow",
      "node ../.github/scripts/npm-audit-ceiling.mjs --allowlist ../.github/npm-audit-allowlist.json\n          node -e",
      "node ../.github/scripts/npm-audit-ceiling.mjs --self-test\n          node -e",
      "sites audit ceiling lane",
    ],
    ["runbook", "restore drill older than 100 days", "restore drill older than one hundred days", "Sites operations runbook"],
    ["reachabilityMigration", "ADD COLUMN public_reachable boolean", "ADD COLUMN public_observed boolean", "Sites public reachability record"],
    ["reachabilityMigration", "'live_pointer_changed', false", "'live_pointer_changed', true", "Sites public reachability record"],
    ["reachabilityMigration", "'pilot.activated', 'service_config', 'sites_v1'", "'pilot.activated', 'config', 'sites_v1'", "Gogi pilot activate audit trail"],
    ["reachabilityMigration", "'pilot.deactivated', 'service_config', 'sites_v1'", "'pilot.deactivated', 'config', 'sites_v1'", "Gogi pilot deactivate audit trail"],
    ["reachabilitySql", "an unreachable public host rolled back live state", "an unreachable public host did something", "Sites public reachability SQL regression"],
    ["reachabilityDeno", "a 404 was reported reachable", "a 404 was mishandled", "Sites public reachability Deno regression"],
    ["callback", "export async function recordPublicReachability", "async function recordPublicReachability", "Sites publish public check wiring"],
    ["secretWorkflow", "issue_3157_publish_public_reachability.test.ts", "issue_3157_removed.test.ts", "Sites public reachability CI lane"],
  ];
  for (const [key, before, after, expected] of reversions) {
    const mutated = { ...clean, [key]: clean[key].replace(before, after) };
    const failures = violations(mutated);
    if (!failures.some((failure) => failure.includes(expected))) {
      throw new Error(`reversion not caught: ${key} / ${expected}`);
    }
  }
  console.log(`#2830 Sites foundation self-test PASS (${reversions.length} true-source reversions)`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = violations(readFiles());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("#2830 Sites foundation guard PASS (tenant, last-good, role, dependency, slot-88, retention, CI)");
}
