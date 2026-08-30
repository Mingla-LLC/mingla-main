#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  migration: "supabase/migrations/20270609002830_issue_2830_mingla_sites_foundation.sql",
  security: "supabase/functions/_shared/sitesSecurity.ts",
  contracts: "supabase/functions/_shared/sitesContracts.ts",
  control: "supabase/functions/brand-site-control/index.ts",
  callback: "supabase/functions/brand-site-cms-callback/index.ts",
  runtimeResolve: "supabase/functions/brand-site-runtime-resolve/index.ts",
  attribution: "supabase/functions/brand-site-attribution/index.ts",
  ariTools: "supabase/functions/_shared/agentSiteTools.ts",
  ariAuthorization: "supabase/functions/_shared/agentToolAuthorization.ts",
  denoHappy: "supabase/functions/_shared/__tests__/issue_2830_sites_foundation_happy.test.ts",
  businessFlag: "mingla-business/src/config/featureFlags.ts",
  businessRoute: "mingla-business/app/brand/[id]/website.tsx",
  businessView: "mingla-business/src/components/sites/BrandWebsiteView.tsx",
  businessService: "mingla-business/src/services/brandSitesService.ts",
  checkout: "supabase/functions/ticket-checkout-create/index.ts",
  cmsPackage: "mingla-site-cms/package.json",
  cmsConfig: "mingla-site-cms/src/lib/config.ts",
  cmsPayload: "mingla-site-cms/src/payload.config.ts",
  cmsAccess: "mingla-site-cms/src/lib/access.ts",
  cmsMedia: "mingla-site-cms/src/lib/mediaPipeline.ts",
  cmsObjectStore: "mingla-site-cms/src/lib/objectStore.ts",
  cmsArtifact: "mingla-site-cms/src/lib/artifactBuilder.ts",
  cmsEndpoints: "mingla-site-cms/src/endpoints/sitesEndpoints.ts",
  publicPackage: "mingla-sites/package.json",
  publicConfig: "mingla-sites/src/lib/config.ts",
  publicGateway: "mingla-sites/src/lib/coreGateway.ts",
  publicPublication: "mingla-sites/src/lib/publication.ts",
  publicArtifact: "mingla-sites/src/contracts/artifact.ts",
  publicConsent: "mingla-sites/src/components/ConsentControl.tsx",
  publicEvents: "mingla-sites/src/app/api/events/route.ts",
  manifest: "supabase/secrets.manifest.json",
  runbook: "docs/runbooks/MINGLA_SITES_PILOT.md",
  invariant: "docs/INVARIANT_REGISTRY.md",
  secretWorkflow: ".github/workflows/supabase-secret-budget.yml",
  webWorkflow: ".github/workflows/web-build-check.yml",
};

const EXACT_CMS_DEPENDENCIES = {
  "@payloadcms/db-postgres": "3.88.0",
  "@payloadcms/next": "3.88.0",
  "@payloadcms/plugin-multi-tenant": "3.88.0",
  "@payloadcms/richtext-lexical": "3.88.0",
  "@payloadcms/storage-s3": "3.88.0",
  "@payloadcms/ui": "3.88.0",
  graphql: "16.11.0",
  next: "16.3.3",
  payload: "3.88.0",
  react: "19.2.6",
  "react-dom": "19.2.6",
  sharp: "0.35.4",
};
const EXACT_PUBLIC_DEPENDENCIES = {
  next: "16.3.3",
  react: "19.2.6",
  "react-dom": "19.2.6",
};
const ARI_TOOLS = [
  "get_brand_site",
  "list_site_pages",
  "get_site_page",
  "propose_site_content_update",
  "propose_site_settings_update",
  "attach_approved_site_media",
  "validate_site_draft",
  "create_site_preview",
  "publish_site",
  "get_site_operation_status",
  "list_site_versions",
  "rollback_site",
];

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}
function forbid(source, token, label, failures) {
  if (source.toLowerCase().includes(token.toLowerCase())) {
    failures.push(`${label}: forbidden ${token}`);
  }
}
function json(source, label, failures) {
  try {
    return JSON.parse(source);
  } catch {
    failures.push(`${label}: invalid JSON`);
    return {};
  }
}

export function violations(files) {
  const failures = [];
  const migration = files.migration ?? "";
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
  ]) need(migration, token, "Core migration", failures);
  forbid(migration, "CREATE POLICY scanner", "scanner isolation", failures);

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

  const manifest = json(files.manifest ?? "", "secret manifest", failures);
  const sitesSecret = manifest.secrets?.find((row) => row.name === "MINGLA_SITES_SECURITY_JSON");
  if (
    manifest.rollout?.expected_user_managed_count !== 88 ||
    manifest.secrets?.length !== 88 ||
    manifest.exceptions?.length !== 1 ||
    manifest.exceptions?.[0]?.issue !== 2830 ||
    sitesSecret?.class !== "credential_bundle" ||
    sitesSecret?.issue !== 2830 ||
    sitesSecret?.readers?.length !== 1 ||
    sitesSecret.readers[0] !== "supabase/functions/_shared/sitesSecurity.ts" ||
    sitesSecret?.bundle_fields?.length !== 14
  ) failures.push("slot 88: exact manifest contract missing");

  const ariTools = files.ariTools ?? "";
  const toolNames = [...ariTools.matchAll(/publicationTool\("([^"]+)"\)|^\s*"((?:get|list|propose|attach|validate)_[^"]+)"/gm)]
    .map((match) => match[1] || match[2])
    .filter((name, index, names) => name && names.indexOf(name) === index);
  for (const name of ARI_TOOLS) {
    need(ariTools, `"${name}"`, "Ari closed tool registry", failures);
    need(files.ariAuthorization ?? "", `${name}: role("marketing_manager", "brand")`, "Ari authorization", failures);
  }
  if (
    toolNames.length !== 12 ||
    toolNames.some((name) => !ARI_TOOLS.includes(name)) ||
    ARI_TOOLS.some((name) => !toolNames.includes(name))
  ) failures.push("Ari closed tool registry: exact twelve-tool set drifted");

  const flag = files.businessFlag ?? "";
  need(flag, 'sites: readEnvFlag("EXPO_PUBLIC_FF_SITES_ENABLED", false)', "Business feature flag", failures);
  const route = files.businessRoute ?? "";
  for (const token of [
    "role.rank >= 20",
    "role.rank < 20",
    "useBrandSitePreview",
    "usePublishBrandSite",
    "useRollbackBrandSite",
    "isPreviewing={preview.isPending}",
  ]) need(route, token, "Business Website route", failures);
  need(files.businessView ?? "", "if (!canWork) {\n    return null;", "rank-10 zero signal", failures);
  for (const source of [route, files.businessView ?? ""]) {
    forbid(source, "custom domain", "deferred domain UI", failures);
    for (const provider of ["Vercel", "Payload", "Supabase", "Neon"]) {
      forbid(source, provider, "customer provider neutrality", failures);
    }
  }

  const cmsPackage = json(files.cmsPackage ?? "", "CMS package", failures);
  if (JSON.stringify(cmsPackage.dependencies) !== JSON.stringify(EXACT_CMS_DEPENDENCIES)) {
    failures.push("CMS package: production dependency set/version drifted");
  }
  if (cmsPackage.overrides?.dompurify !== "3.4.14") failures.push("CMS package: DOMPurify override drifted");
  const publicPackage = json(files.publicPackage ?? "", "public package", failures);
  if (JSON.stringify(publicPackage.dependencies) !== JSON.stringify(EXACT_PUBLIC_DEPENDENCIES)) {
    failures.push("public runtime: production dependency isolation drifted");
  }
  if (publicPackage.overrides?.dompurify !== "3.4.14") failures.push("public runtime: DOMPurify override drifted");

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
    "if (body.destination !== \"studio\")",
    "encodePreviewGrant",
    "source_digest",
    "buildPublicationArtifact",
    "probePublicationCandidate",
    "await runRetentionSweep(",
    "tombstoneMedia",
  ]) need(files.cmsEndpoints ?? "", token, "Studio gateway", failures);
  for (const token of [
    "MAX_BYTES = 20 * 1024 * 1024",
    "MAX_PIXELS = 40_000_000",
    "const WIDTHS = [320, 640, 960, 1440, 1920]",
    "METADATA_RETAINED",
    "referencedByProtectedPublication",
    "newestRank > 50",
    "90 * 24 * 60 * 60_000",
  ]) need(files.cmsMedia ?? "", token, "media and retention", failures);
  need(files.cmsObjectStore ?? "", "if-none-match:*", "immutable media write", failures);
  for (const token of [
    "observedDraftDigest !== input.sourceDigest",
    "await sha256(readback)",
    "restaurant-website-v1",
  ]) need(files.cmsArtifact ?? "", token, "deterministic publication", failures);

  const publicCombined = [
    files.publicConfig,
    files.publicGateway,
    files.publicPublication,
    files.publicArtifact,
    files.publicConsent,
    files.publicEvents,
  ].join("\n");
  for (const token of [
    "MINGLA_RUNTIME_TO_CORE_CURRENT_KID",
    "MINGLA_RUNTIME_TO_CORE_CURRENT_KEY_B64",
    "await signedCorePost({",
    "gogi.sites.usemingla.com",
    "expectedKey",
    "await sha256(bytes)",
    "assertRestaurantArtifact",
    "mingla_site_analytics_consent_v1",
  ]) need(publicCombined, token, "public last-good runtime", failures);
  for (const forbidden of ["@payloadcms", "from \"payload\"", "postgresAdapter", "sharp(", "lexicalEditor"])
    forbid(publicCombined, forbidden, "public runtime isolation", failures);

  for (const token of [
    "issue_2830_sites_foundation_happy.test.ts",
    "final 88-name bundled-authority state",
  ]) need(files.secretWorkflow ?? "", token, "existing secret CI lane", failures);
  for (const token of [
    "mingla-site-cms-build:",
    "mingla-sites-build:",
    "node-version: \"22\"",
    "npm audit --audit-level=high",
    "Public runtime dependency isolation",
  ]) need(files.webWorkflow ?? "", token, "existing build CI lane", failures);
  for (const token of [
    "CMS application/database fault",
    "26 hours",
    "restore drill older than 100 days",
    "tenant escape",
    "last-good pointer recovery",
  ]) need(files.runbook ?? "", token, "Sites operations runbook", failures);
  need(files.invariant ?? "", "I-PROPOSED-2830-SITES-LAST-GOOD-TENANT-BOUNDARY (DRAFT)", "invariant registry", failures);
  need(files.denoHappy ?? "", "slot-88 import closure stays exact and value-blind", "implementor regression", failures);
  need(files.checkout ?? "", "site_attribution_token_digest", "checkout attribution handoff", failures);
  return failures;
}

function readFiles() {
  return Object.fromEntries(
    Object.entries(PATHS).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(ROOT, relative), "utf8"),
    ]),
  );
}

function selfTest() {
  const clean = readFiles();
  const cleanFailures = violations(clean);
  if (cleanFailures.length) throw new Error(`clean fixture failed:\n${cleanFailures.join("\n")}`);
  const reversions = [
    ["businessFlag", 'readEnvFlag("EXPO_PUBLIC_FF_SITES_ENABLED", false)', 'readEnvFlag("EXPO_PUBLIC_FF_SITES_ENABLED", true)', "Business feature flag"],
    ["businessRoute", "role.rank >= 20", "role.rank >= 10", "Business Website route"],
    ["migration", " FORCE ROW LEVEL SECURITY", "", "Core forced RLS"],
    ["security", "Deno.env.get(ENVELOPE_NAME)", "Deno.env.get(ENVELOPE_NAME); Deno.env.get(ENVELOPE_NAME)", "exactly one environment read"],
    ["ariTools", 'publicationTool("rollback_site")', 'publicationTool("rollback_site_removed")', "Ari closed tool registry"],
    ["cmsEndpoints", "await runRetentionSweep(", "await runRetentionSweepRemoved(", "Studio gateway"],
    ["cmsMedia", "newestRank > 50", "newestRank > 0", "media and retention"],
    ["publicPublication", "await signedCorePost({", "await unsignedCorePost({", "public last-good runtime"],
    ["publicPackage", '"next": "16.3.3"', '"@payloadcms/next": "3.88.0",\n    "next": "16.3.3"', "production dependency isolation"],
    ["businessView", "Managed by Mingla.", "Configure custom domain", "deferred domain UI"],
    ["secretWorkflow", "final 88-name bundled-authority state", "final state", "existing secret CI lane"],
    ["webWorkflow", "mingla-sites-build:", "mingla-sites-removed:", "existing build CI lane"],
    ["runbook", "restore drill older than 100 days", "restore drill older than one hundred days", "Sites operations runbook"],
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
