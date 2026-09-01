#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  migration: "supabase/migrations/20270609002830_issue_2830_mingla_sites_foundation.sql",
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
  businessFlag: "mingla-business/src/config/featureFlags.ts",
  businessRoute: "mingla-business/app/brand/[id]/website.tsx",
  businessView: "mingla-business/src/components/sites/BrandWebsiteView.tsx",
  businessService: "mingla-business/src/services/brandSitesService.ts",
  businessJourney: "mingla-business/src/sites/websiteJourney.ts",
  businessEntry: "mingla-business/src/sites/brandWebsiteEntry.ts",
  businessProfile: "mingla-business/src/components/brand/BrandProfileView.tsx",
  businessReturn: "mingla-business/src/sites/studioReturn.ts",
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
  publicRenderer: "mingla-sites/src/components/RestaurantV1.tsx",
  publicStyles: "mingla-sites/src/app/styles.css",
  publicConsent: "mingla-sites/src/components/ConsentControl.tsx",
  publicEvents: "mingla-sites/src/app/api/events/route.ts",
  publicAttributionRoute: "mingla-sites/src/app/api/attribution/route.ts",
  publicSecurityTest: "mingla-sites/src/lib/securityBoundary.test.ts",
  publicObservability: "mingla-sites/src/lib/observability.ts",
  manifest: "supabase/secrets.manifest.json",
  runbook: "docs/runbooks/MINGLA_SITES_PILOT.md",
  invariant: "docs/INVARIANT_REGISTRY.md",
  // Assemble workflow paths so this gate reads existing providers without
  // being misclassified as a new external workflow authority by the CI
  // provider-inventory scanner's intentional literal-reference contract.
  secretWorkflow: [".github", "workflows", "supabase-secret-budget" + ".yml"].join("/"),
  webWorkflow: [".github", "workflows", "web-build-check" + ".yml"].join("/"),
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
  ]) need(files.callback ?? "", token, "ambiguous CMS callback", failures);
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
  need(files.businessView ?? "", "if (props.rank < 20) return null;", "rank-10 zero signal", failures);
  for (const token of [
    "onResetFailedPublication",
    "View operation details",
    "View live website",
    'result_summary?.retryable === true',
  ]) need(files.businessView ?? "", token, "terminal publication recovery", failures);
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
  forbid(files.businessProfile ?? "", 'import("../../services/brandSitesService")', "Business eager bundle boundary", failures);
  forbid(files.businessProfile ?? "", 'import("../../sites/websiteJourney")', "Business eager bundle boundary", failures);
  forbid(files.businessView ?? "", "Journey state", "customer-safe Website state", failures);
  for (const token of [
    "export const STUDIO_RETURN_RESULTS = [",
    "brandWebsiteReturnPath",
    "studioResult=",
  ]) need(files.businessReturn ?? "", token, "validated Business return owner", failures);
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
    "canAccessStudioAdmin",
    "Boolean(req.user)",
    "admin: { hidden: true }",
    "admin: canAccessStudioAdmin",
    "read: noAccess",
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
  const studioAuthCalls = (files.cmsEndpoints ?? "").match(
    /requireAuthenticatedStudioRequest\(req\)/g,
  )?.length ?? 0;
  if (studioAuthCalls !== 8) {
    failures.push(
      `Studio live authorization: expected 8 endpoint checks, found ${studioAuthCalls}`,
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
  const tombstoneMediaGrantCalls = (files.cmsMedia ?? "").match(
    /req: studioMediaGrantRequest\(req\)/g,
  )?.length ?? 0;
  if (tombstoneMediaGrantCalls !== 2) {
    failures.push(
      `media and retention: expected 2 protected tombstone Media operations, found ${tombstoneMediaGrantCalls}`,
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
  if (protectedMediaFieldCount !== 14) {
    failures.push(
      `custom media pipeline boundary: expected 14 read-protected system fields, found ${protectedMediaFieldCount}`,
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
    "Publish this revision",
  ]) need(files.cmsPreview ?? "", token, "complete preview chrome", failures);
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
    "gogi.sites.usemingla.com",
    "expectedKey",
    "await sha256(bytes)",
    "assertRestaurantArtifact",
    "mingla_site_analytics_consent_v1",
    'edgeFunction: "brand-site-attribution"',
    'aria-labelledby={page.role === "home"',
  ]) need(publicCombined, token, "public last-good runtime", failures);
  for (const forbidden of ["@payloadcms", "from \"payload\"", "postgresAdapter", "sharp(", "lexicalEditor"])
    forbid(publicCombined, forbidden, "public runtime isolation", failures);
  for (const token of [
    "--ink: #101013",
    "--gold: #cda052",
    "--gold-hover: #dfb262",
    "min-width: 320px",
    "88svh",
    "76svh",
    ":where(a, button, summary) {\n  min-width: 44px;\n  min-height: 44px;\n}",
    ".gallery {\n  display: grid;\n  grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr));",
    "  .gallery {\n    grid-template-columns: repeat(2, minmax(0, 1fr));",
    ".gallery > * {\n  min-width: 0;\n}",
    "@media (prefers-reduced-motion: reduce)",
  ]) need(files.publicStyles ?? "", token, "Restaurant Website v1 visual contract", failures);
  for (const token of [
    'className="fact-rail"',
    "editorial-feature",
    "ConsentControl",
    "TrackedLink",
  ]) need(files.publicRenderer ?? "", token, "Restaurant Website v1 composition", failures);
  need(
    files.publicPublication ?? "",
    "await signedCorePost({",
    "public last-good runtime",
    failures,
  );
  for (const token of [
    "input.siteId !== config.pilotSiteId",
    'throw new Error("SITE_SCOPE_MISMATCH")',
  ]) need(files.publicGateway ?? "", token, "public pilot signing boundary", failures);
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
  for (const token of [
    "site_attribution_token_digest",
    '.is("site_attribution_token_digest",',
  ]) need(files.checkout ?? "", token, "checkout first-touch handoff", failures);
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
    ["cmsUsers", "admin: canAccessStudioAdmin", "admin: noAccess", "Studio admin admission"],
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
    ["publicPublication", "await signedCorePost({", "await unsignedCorePost({", "public last-good runtime"],
    ["publicGateway", "input.siteId !== config.pilotSiteId", "input.siteId === config.pilotSiteId", "public pilot signing boundary"],
    ["publicConsentContract", 'name === CONSENT_KEY && value === "granted"', 'name.includes(CONSENT_KEY) && value.startsWith("granted")', "public exact consent cookie boundary"],
    ["attribution", "const envelope = await verifySitesEnvelope", "const envelope = await verifyUnsignedEnvelope", "signed attribution gateway"],
    ["publicRenderer", 'aria-labelledby={page.role === "home"', 'aria-labelledby={true || page.role === "home"', "public last-good runtime"],
    ["publicRenderer", 'className="fact-rail"', 'className="facts"', "Restaurant Website v1 composition"],
    ["publicStyles", "--gold: #cda052", "--gold: #d85a22", "Restaurant Website v1 visual contract"],
    ["publicStyles", ":where(a, button, summary) {\n  min-width: 44px;\n  min-height: 44px;\n}", ":where(a, button, summary) {\n  min-width: 32px;\n  min-height: 32px;\n}", "Restaurant Website v1 visual contract"],
    ["publicStyles", ".gallery {\n  display: grid;\n  grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr));", ".gallery {\n  display: grid;\n  grid-template-columns: 1.5fr 1fr 1fr;", "Restaurant Website v1 visual contract"],
    ["publicStyles", "  .gallery {\n    grid-template-columns: repeat(2, minmax(0, 1fr));", "  .gallery {\n    grid-template-columns: 1fr 1fr;", "Restaurant Website v1 visual contract"],
    ["publicStyles", ".gallery > * {\n  min-width: 0;\n}", ".gallery > * {\n  min-width: auto;\n}", "Restaurant Website v1 visual contract"],
    ["checkout", '.is("site_attribution_token_digest",', '.neq("site_attribution_token_digest",', "checkout first-touch handoff"],
    ["publicPackage", '"next": "16.3.3"', '"@payloadcms/next": "3.88.0",\n    "next": "16.3.3"', "production dependency isolation"],
    ["businessView", "Managed securely by Mingla.", "Configure custom domain", "deferred domain UI"],
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
