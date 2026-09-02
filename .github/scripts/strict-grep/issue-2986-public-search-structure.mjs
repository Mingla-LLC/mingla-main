#!/usr/bin/env node

/**
 * #2986 / #3025 — public Host search structure and fail-closed lifecycle.
 *
 * This additive guard owns the structural contracts formerly pinned only by
 * the three quarantined Jest source files. It intentionally reads production
 * configuration and migration source; it does not execute or import either.
 * `--self-test` independently removes every token below and mutates every
 * collection/ordering rule so a green result cannot be explained by vacuity.
 *
 * [TEST-MOD-APPROVED #3025] The binding recovery spec explicitly authorizes
 * this test-only gate and its adversarial self-test corpus.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BIZ = path.join(REPO, "mingla-business");
const APP_ROOT = path.join(BIZ, "app");
const VERCEL_CONFIG = path.join(BIZ, "vercel.json");
const SOCIAL_PREVIEW = path.join(BIZ, "server", "socialPreview.js");
const PLATFORM_URL = path.join(BIZ, "src", "constants", "platformUrl.ts");
const MIGRATION = path.join(
  REPO,
  "supabase",
  "migrations",
  "20270614002986_issue_2986_public_search_documents.sql",
);

const SELF_TEST = process.argv.includes("--self-test");
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => arg !== "--self-test");

const PUBLIC_ROUTES = new Map([
  ["/e/:brandSlug/:eventSlug", "/api/public-event?brandSlug=:brandSlug&eventSlug=:eventSlug"],
  ["/t/:brandSlug/:tripSlug", "/api/public-trip?brandSlug=:brandSlug&tripSlug=:tripSlug"],
  ["/exp/:brandSlug/:experienceSlug", "/api/public-experience?brandSlug=:brandSlug&experienceSlug=:experienceSlug"],
  ["/b/:brandSlug/v/:venueSlug", "/api/public-venue?brandSlug=:brandSlug&venueSlug=:venueSlug"],
  ["/b/:brandSlug", "/api/public-brand?brandSlug=:brandSlug"],
]);

const PUBLIC_PATHS = [
  "/e/minglanigeria/new-forms-collector-s-preview",
  "/t/mingla/lagos-weekend",
  "/exp/mingla/gallery-tour",
  "/b/mingla",
  "/b/mingla/v/rooftop",
  "/robots.txt",
  "/sitemap.xml",
  "/_expo/static/js/web/app.js",
  "/assets/logo.png",
  "/.well-known/apple-app-site-association",
  "/.well-known/assetlinks.json",
];

const DIRECT_PRIVATE_DOCUMENTS = [
  "/auth/callback.html",
  "/stripe-onboarding-return.html",
  "/accept-brand-invitation-entry",
];

const LIFECYCLE_STATES = [
  "draft",
  "public_noindex",
  "search_ready",
  "stale",
  "expired_archived",
  "redirected",
  "gone",
];

const PATH_GRAMMAR = [
  ["path-null", "p_path IS NULL"],
  ["path-length", "octet_length(p_path) > 512"],
  ["path-case", "p_path <> lower(p_path)"],
  ["query-fragment-percent-backslash", "p_path ~ '[?#%\\\\]'"],
  ["double-slash", "p_path ~ '//'"],
  ["dot-segments", "p_path ~ '(^|/)\\.\\.?(/|$)'"],
  ["ascii-only", "p_path !~ '^[\\x00-\\x7F]+$'"],
  ["event-route", "WHEN p_path ~ '^/e/[a-z0-9][a-z0-9_-]{0,127}/[a-z0-9][a-z0-9_-]{0,127}$' THEN 'event'"],
  ["trip-route", "WHEN p_path ~ '^/t/[a-z0-9][a-z0-9_-]{0,127}/[a-z0-9][a-z0-9_-]{0,127}$' THEN 'trip'"],
  ["experience-route", "WHEN p_path ~ '^/exp/[a-z0-9][a-z0-9_-]{0,127}/[a-z0-9][a-z0-9_-]{0,127}$' THEN 'experience'"],
  ["venue-route", "WHEN p_path ~ '^/b/[a-z0-9][a-z0-9_-]{0,127}/v/[a-z0-9][a-z0-9_-]{0,127}$' THEN 'venue'"],
  ["brand-route", "WHEN p_path ~ '^/b/[a-z0-9][a-z0-9_-]{0,127}$' THEN 'brand'"],
];

// Each entry is both a live assertion and one independent self-test mutation.
// Keep clauses narrow enough that deleting one removes one load-bearing proof.
const SOURCE_CLAUSES = [
  // Retired-origin suppression.
  ["socialPreview", "host-origin-default", 'process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL ||\n  "https://host.usemingla.com"'],
  ["socialPreview", "retired-origin-comparison", 'CONFIGURED_PUBLIC_ORIGIN === "https://business.usemingla.com"'],
  ["socialPreview", "retired-origin-fallback", '? "https://host.usemingla.com"'],
  ["platformUrl", "fixed-host-origin", 'const HOST_PUBLIC_ORIGIN = "https://host.usemingla.com";'],
  ["platformUrl", "retired-origin-regex", "const RETIRED_BUSINESS_ORIGIN = /^https:\\/\\/business\\.usemingla\\.com\\/?$/i;"],
  ["platformUrl", "retired-origin-test", "RETIRED_BUSINESS_ORIGIN.test(CONFIGURED.trim())"],
  ["platformUrl", "retired-origin-resolution", "? HOST_PUBLIC_ORIGIN"],

  // RLS, grants, and public-reader posture.
  ["migration", "documents-enable-rls", "ALTER TABLE public.public_search_documents ENABLE ROW LEVEL SECURITY;"],
  ["migration", "documents-force-rls", "ALTER TABLE public.public_search_documents FORCE ROW LEVEL SECURITY;"],
  ["migration", "documents-revoke", "REVOKE ALL ON TABLE public.public_search_documents FROM PUBLIC, anon, authenticated;"],
  ["migration", "documents-service-grant", "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.public_search_documents TO service_role;"],
  ["migration", "audit-enable-rls", "ALTER TABLE public.public_search_document_audit ENABLE ROW LEVEL SECURITY;"],
  ["migration", "audit-force-rls", "ALTER TABLE public.public_search_document_audit FORCE ROW LEVEL SECURITY;"],
  ["migration", "audit-revoke", "REVOKE ALL ON TABLE public.public_search_document_audit FROM PUBLIC, anon, authenticated;"],
  ["migration", "audit-service-grant", "GRANT SELECT, INSERT ON TABLE public.public_search_document_audit TO service_role;"],
  ["migration", "resolver-definer", "CREATE FUNCTION public.resolve_public_search_document(p_path text)"],
  ["migration", "sitemap-definer", "CREATE FUNCTION public.list_public_search_sitemap()"],
  ["migration", "resolver-public-grant", "GRANT EXECUTE ON FUNCTION public.resolve_public_search_document(text) TO anon, authenticated, service_role;"],
  ["migration", "sitemap-public-grant", "GRANT EXECUTE ON FUNCTION public.list_public_search_sitemap() TO anon, authenticated, service_role;"],
  ["migration", "upsert-anon-revoke", "FROM PUBLIC, anon;"],

  // Validation and source-current promotion.
  ["migration", "validation-base", '{"facts_verified":true,"canonical_verified":true,"visible_html_verified":true,"metadata_verified":true,"schema_verified":true,"image_rights_verified":true,"action_verified":true}'],
  ["migration", "validation-event", '{"schedule_verified":true,"location_verified":true,"organizer_verified":true,"price_or_free_verified":true,"privacy_moderation_verified":true}'],
  ["migration", "validation-trip", '{"schedule_verified":true,"location_verified":true,"itinerary_verified":true,"destination_verified":true,"operator_verified":true,"fulfillment_verified":true,"price_or_inquiry_verified":true,"availability_verified":true}'],
  ["migration", "validation-experience", '{"schedule_verified":true,"location_verified":true,"operator_verified":true,"duration_verified":true,"inclusions_verified":true,"fulfillment_verified":true,"price_or_inquiry_verified":true,"availability_verified":true}'],
  ["migration", "validation-brand", '{"identity_verified":true,"inventory_verified":true,"ownership_source_verified":true,"action_or_inventory_verified":true}'],
  ["migration", "validation-venue", '{"identity_verified":true,"location_verified":true,"contact_hours_verified_when_shown":true,"offering_context_verified":true,"address_privacy_verified":true}'],
  ["migration", "trigger-no-test", "IF NEW.is_test_record"],
  ["migration", "trigger-verified", "OR NEW.verified_at IS NULL"],
  ["migration", "trigger-source-token", "OR NEW.source_updated_at IS NULL"],
  ["migration", "trigger-review-current", "OR NEW.review_due_at IS NULL OR NEW.review_due_at <= now()"],
  ["migration", "trigger-validation", "OR NOT public.public_search_validation_complete(NEW.entity_kind,NEW.validation_checks)"],
  ["migration", "trigger-readiness", "OR NOT public.public_search_source_is_search_ready(NEW.entity_kind,NEW.entity_id)"],
  ["migration", "trigger-visible", "OR v_source->>'sourceState' IS DISTINCT FROM 'visible'"],
  ["migration", "trigger-id-current", "OR v_source->'facts'->>'id' IS DISTINCT FROM NEW.entity_id::text"],
  ["migration", "trigger-derived-time", "OR v_source_updated_at IS NULL"],
  ["migration", "trigger-exact-time", "OR NEW.source_updated_at IS DISTINCT FROM v_source_updated_at"],
  ["migration", "upsert-token-present", "p_source_updated_at IS NULL"],
  ["migration", "upsert-derived-present", "v_derived_source_updated_at IS NULL"],
  ["migration", "upsert-no-future-token", "p_source_updated_at > clock_timestamp()"],
  ["migration", "upsert-exact-token", "p_source_updated_at IS DISTINCT FROM v_derived_source_updated_at"],
  ["migration", "upsert-persists-derived", "COALESCE(p_validation_checks,'{}'::jsonb),v_derived_source_updated_at,p_verified_at"],

  // Visibility delegation and privacy.
  ["migration", "listing-visibility-delegation", "public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')"],
  ["migration", "direct-visibility-delegation", "public.pg_offering_visibility_gate(e.visibility,e.deleted_at,'direct')"],
  ["migration", "address-withheld-location", "'location',CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_text END"],
  ["migration", "address-withheld-stop", "SELECT CASE WHEN public.issue_2489_address_withheld(e.theme) THEN s.place_name ELSE COALESCE(NULLIF(s.address,''),s.place_name) END"],
  ["migration", "privacy-draft-first", "IF v_source_state='draft' THEN"],
  ["migration", "source-not-visible-fail-closed", "ELSIF v_source_state IS DISTINCT FROM 'visible' THEN"],

  // Redirect, gone, archive, and stale truth.
  ["migration", "redirect-target-shape", "public.public_search_path_kind(NEW.redirect_target_path) IS NULL"],
  ["migration", "redirect-no-self", "OR NEW.redirect_target_path=NEW.canonical_path"],
  ["migration", "redirect-no-chain", "d.canonical_path=NEW.redirect_target_path AND d.lifecycle_state='redirected'"],
  ["migration", "redirect-no-cycle", "d.redirect_target_path=NEW.canonical_path"],
  ["migration", "redirect-target-visible", "public_search_redirect_target_not_visible"],
  ["migration", "resolver-redirect", "IF v_has_doc AND v_doc.lifecycle_state='redirected' THEN"],
  ["migration", "resolver-redirect-target", "'redirectTargetPath',v_doc.redirect_target_path"],
  ["migration", "resolver-gone", "IF v_has_doc AND v_doc.lifecycle_state='gone' THEN"],
  ["migration", "archive-kind-limit", "v_kind NOT IN ('event','trip','experience')"],
  ["migration", "archive-status-required", "v_facts->>'status' IS NULL"],
  ["migration", "archive-status-limit", "v_facts->>'status' NOT IN ('ended','cancelled')"],
  ["migration", "archive-effective", "v_effective := 'expired_archived';"],
  ["migration", "stale-review", "v_doc.review_due_at IS NULL OR v_doc.review_due_at <= now()"],
  ["migration", "stale-test", "OR v_doc.is_test_record"],
  ["migration", "stale-validation", "OR NOT public.public_search_validation_complete(v_doc.entity_kind,v_doc.validation_checks)"],
  ["migration", "stale-readiness", "OR NOT public.public_search_source_is_search_ready(v_doc.entity_kind,v_doc.entity_id)"],
  ["migration", "stale-source-time-present", "OR v_doc.source_updated_at IS NULL"],
  ["migration", "stale-source-time-exact", "OR v_doc.source_updated_at IS DISTINCT FROM (v_facts->>'sourceUpdatedAt')::timestamptz"],

  // Sitemap is the sole enumerable, current, verified search-ready reader.
  ["migration", "sitemap-search-ready", "WHERE d.lifecycle_state='search_ready'"],
  ["migration", "sitemap-no-test", "AND d.is_test_record=false"],
  ["migration", "sitemap-review-current", "AND d.review_due_at > now()"],
  ["migration", "sitemap-validation", "AND public.public_search_validation_complete(d.entity_kind,d.validation_checks)"],
  ["migration", "sitemap-source-readiness", "AND public.public_search_source_is_search_ready(d.entity_kind,d.entity_id)"],
  ["migration", "sitemap-id-current", "AND (public.public_search_source_facts(d.canonical_path,d.entity_kind)->'facts'->>'id')=d.entity_id::text"],
  ["migration", "sitemap-source-not-older", "AND d.source_updated_at >= (public.public_search_source_facts(d.canonical_path,d.entity_kind)->'facts'->>'sourceUpdatedAt')::timestamptz"],
  ["migration", "sitemap-source-not-newer", "AND d.source_updated_at <= (public.public_search_source_facts(d.canonical_path,d.entity_kind)->'facts'->>'sourceUpdatedAt')::timestamptz"],
  ["migration", "sitemap-deterministic-order", "ORDER BY d.canonical_path;"],

  // Migration-time zero-seed and privilege assertions.
  ["migration", "zero-seed-count", "SELECT count(*) INTO v_count FROM public.public_search_documents;"],
  ["migration", "zero-seed-enforcement", "IF v_count <> 0 THEN RAISE EXCEPTION '#2986 migration must seed zero search documents'; END IF;"],
  ["migration", "no-direct-anon-read", "IF has_table_privilege('anon','public.public_search_documents','SELECT')"],
  ["migration", "public-readers-required", "IF NOT has_function_privilege('anon','public.resolve_public_search_document(text)','EXECUTE')"],
  ["migration", "anon-upsert-forbidden", "IF has_function_privilege('anon','public.upsert_public_search_document(text,uuid,text,text,text,jsonb,timestamptz,timestamptz,timestamptz,text,text,boolean)','EXECUTE')"],
];

function routeName(fileName) {
  return fileName.replace(/\.web\.(?:tsx?|jsx?)$/, "").replace(/\.(?:tsx?|jsx?)$/, "");
}

function visibleChildren(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("_") && !entry.name.startsWith("+") && entry.name !== "__tests__")
    .map((entry) => (entry.isDirectory() ? entry.name : routeName(entry.name)));
}

function discoverPrivateRouteFamilies(appRoot = APP_ROOT) {
  const publicFamilies = new Set(["b", "e", "exp", "t"]);
  const privateFamilies = new Set();
  for (const entry of fs.readdirSync(appRoot, { withFileTypes: true })) {
    if (entry.name === "(tabs)") {
      for (const child of visibleChildren(path.join(appRoot, entry.name))) privateFamilies.add(child);
      continue;
    }
    if (entry.name.startsWith("+") || entry.name === "_layout.tsx" || entry.name === "__tests__") continue;
    const name = entry.isDirectory() ? entry.name : routeName(entry.name);
    if (name === "index" || publicFamilies.has(name)) continue;
    privateFamilies.add(name);
  }
  return [...privateFamilies].sort();
}

function matches(source, requestPath) {
  if (source === requestPath) return true;
  if (!source.endsWith("/:path*")) return false;
  const prefix = source.slice(0, -"/:path*".length);
  return requestPath === prefix || requestPath.startsWith(`${prefix}/`);
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function functionBody(source, functionName) {
  const startTokens = [
    `CREATE FUNCTION public.${functionName}(`,
    `CREATE OR REPLACE FUNCTION public.${functionName}(`,
  ];
  const start = startTokens.map((token) => source.indexOf(token)).find((index) => index >= 0) ?? -1;
  if (start < 0) return "";
  const bodyStart = source.indexOf("AS $function$", start);
  const end = source.indexOf("$function$;", bodyStart + 13);
  return bodyStart >= 0 && end > bodyStart ? source.slice(start, end + 11) : "";
}

function loadModel() {
  return {
    config: JSON.parse(fs.readFileSync(VERCEL_CONFIG, "utf8")),
    migration: fs.readFileSync(MIGRATION, "utf8"),
    socialPreview: fs.readFileSync(SOCIAL_PREVIEW, "utf8"),
    platformUrl: fs.readFileSync(PLATFORM_URL, "utf8"),
    privateFamilies: discoverPrivateRouteFamilies(),
  };
}

function cloneModel(model) {
  return {
    config: structuredClone(model.config),
    migration: model.migration,
    socialPreview: model.socialPreview,
    platformUrl: model.platformUrl,
    privateFamilies: [...model.privateFamilies],
  };
}

function audit(model) {
  const errors = [];
  const fail = (code, detail) => errors.push(`${code}: ${detail}`);
  const { config, migration, socialPreview, platformUrl, privateFamilies } = model;

  if (!config || !Array.isArray(config.headers) || !Array.isArray(config.rewrites) || !Array.isArray(config.redirects)) {
    fail("CONFIG_SHAPE", "headers, rewrites, and redirects must all be arrays");
    return errors;
  }

  const robotsRules = config.headers.filter((rule) =>
    Array.isArray(rule.headers) && rule.headers.some((header) => header?.key?.toLowerCase() === "x-robots-tag"));
  const sourceCounts = new Map();
  for (const rule of robotsRules) {
    sourceCounts.set(rule.source, (sourceCounts.get(rule.source) ?? 0) + 1);
    const exact = rule.headers.length === 1 &&
      rule.headers[0]?.key === "X-Robots-Tag" && rule.headers[0]?.value === "noindex, nofollow";
    if (!exact) fail("PRIVATE_ROBOTS_EXACT", `${rule.source} must carry only exact noindex, nofollow`);
    if (Object.hasOwn(rule, "has") || Object.hasOwn(rule, "missing")) {
      fail("PRIVATE_ROBOTS_UNCONDITIONAL", `${rule.source} may not be request-conditional`);
    }
  }
  for (const [source, occurrences] of sourceCounts) {
    if (occurrences !== 1) fail("PRIVATE_ROBOTS_DUPLICATE", `${source} occurs ${occurrences} times`);
  }

  const robotsFor = (requestPath) => robotsRules.filter((rule) => matches(rule.source, requestPath));
  if (privateFamilies.length < 30) fail("PRIVATE_DISCOVERY_VACUOUS", `found only ${privateFamilies.length} private route families`);
  for (const family of privateFamilies) {
    const source = `/${family}/:path*`;
    if (!robotsRules.some((rule) => rule.source === source)) fail("PRIVATE_ROUTE_MISSING", source);
  }
  if (!robotsRules.some((rule) => rule.source === "/")) fail("PRIVATE_ROOT_MISSING", "/");
  for (const requestPath of DIRECT_PRIVATE_DOCUMENTS) {
    if (robotsFor(requestPath).length !== 1) fail("PRIVATE_DOCUMENT_COVERAGE", requestPath);
  }
  for (const requestPath of PUBLIC_PATHS) {
    if (robotsFor(requestPath).length !== 0) fail("PUBLIC_PATH_SHADOWED", requestPath);
  }

  const selectedRewrites = config.rewrites.filter((rule) => PUBLIC_ROUTES.has(rule.source));
  if (selectedRewrites.length !== PUBLIC_ROUTES.size) {
    fail("PUBLIC_REWRITE_COUNT", `expected ${PUBLIC_ROUTES.size}; received ${selectedRewrites.length}`);
  }
  for (const [source, destination] of PUBLIC_ROUTES) {
    const matchesRoute = selectedRewrites.filter((rule) => rule.source === source);
    if (matchesRoute.length !== 1 || matchesRoute[0]?.destination !== destination) {
      fail("PUBLIC_REWRITE_EXACT", `${source} -> ${destination}`);
    }
  }

  if (config.redirects.length !== PUBLIC_ROUTES.size) {
    fail("BUSINESS_REDIRECT_COUNT", `expected exactly ${PUBLIC_ROUTES.size}; received ${config.redirects.length}`);
  }
  for (const source of PUBLIC_ROUTES.keys()) {
    const expectedDestination = `https://host.usemingla.com${source}`;
    const redirects = config.redirects.filter((rule) => rule.source === source);
    const redirect = redirects[0];
    const exactHost = Array.isArray(redirect?.has) && redirect.has.length === 1 &&
      redirect.has[0]?.type === "host" && redirect.has[0]?.value === "business\\.usemingla\\.com";
    if (redirects.length !== 1 || redirect?.destination !== expectedDestination || redirect?.permanent !== true || !exactHost) {
      fail("BUSINESS_REDIRECT_EXACT", `${source} must permanently redirect retired Business origin to Host`);
    }
  }

  const sources = { migration, socialPreview, platformUrl };
  for (const [scope, label, needle] of SOURCE_CLAUSES) {
    if (!sources[scope].includes(needle)) fail("CLAUSE_MISSING", `${label} (${scope})`);
  }
  const pathBody = functionBody(migration, "public_search_path_kind");
  for (const [label, needle] of PATH_GRAMMAR) {
    if (!pathBody.includes(needle)) fail("PATH_GRAMMAR", label);
  }
  if ((pathBody.match(/THEN '(?:event|trip|experience|venue|brand)'/g) ?? []).length !== 5) {
    fail("PATH_GRAMMAR_CARDINALITY", "closed path grammar must have exactly five accepted route kinds");
  }

  const lifecycleMatch = migration.match(/CHECK \(lifecycle_state IN \(([^)]+)\)\)/);
  const lifecycle = lifecycleMatch
    ? [...lifecycleMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
    : [];
  if (JSON.stringify(lifecycle) !== JSON.stringify(LIFECYCLE_STATES)) {
    fail("LIFECYCLE_EXACT", `expected exactly ${LIFECYCLE_STATES.join(",")}`);
  }

  const upsertBody = functionBody(migration, "upsert_public_search_document");
  if (count(migration, "INSERT INTO public.public_search_documents(") !== 1 ||
      !upsertBody.includes("INSERT INTO public.public_search_documents(")) {
    fail("ZERO_SEED_STRUCTURE", "the sole document insert must be inside the service upsert");
  }

  const factsBody = functionBody(migration, "public_search_source_facts");
  for (const forbidden of [
    "'contactEmail'", "'contactPhone'", "'latitude'", "'longitude'", "'buyerId'", "'authoringState'",
  ]) {
    if (factsBody.includes(forbidden)) fail("SAFE_FACTS_ONLY", `forbidden public fact ${forbidden}`);
  }

  const resolverBody = functionBody(migration, "resolve_public_search_document");
  const draftIndex = resolverBody.indexOf("IF v_source_state='draft' THEN");
  for (const [label, token] of [
    ["redirect", "IF v_has_doc AND v_doc.lifecycle_state='redirected' THEN"],
    ["gone", "IF v_has_doc AND v_doc.lifecycle_state='gone' THEN"],
    ["archive", "IF v_has_doc AND v_doc.lifecycle_state='expired_archived' AND ("],
  ]) {
    const index = resolverBody.indexOf(token);
    if (draftIndex < 0 || index < 0 || draftIndex >= index) fail("PRIVACY_PRECEDENCE", `draft must precede ${label}`);
  }
  const goneStart = resolverBody.indexOf("IF v_has_doc AND v_doc.lifecycle_state='gone' THEN");
  const goneEnd = resolverBody.indexOf("END IF;", goneStart);
  if (goneStart < 0 || /facts/i.test(resolverBody.slice(goneStart, goneEnd))) {
    fail("GONE_FACTLESS", "gone response must not return facts");
  }

  return errors;
}

function replaceOnce(model, scope, needle, replacement, label) {
  if (!model[scope].includes(needle)) throw new Error(`self-test fixture missing ${label}: ${needle}`);
  model[scope] = model[scope].replace(needle, replacement);
}

function replaceAll(model, scope, needle, replacement, label) {
  if (!model[scope].includes(needle)) throw new Error(`self-test fixture missing ${label}: ${needle}`);
  model[scope] = model[scope].split(needle).join(replacement);
}

function expectRed(clean, label, mutate) {
  const mutant = cloneModel(clean);
  mutate(mutant);
  const errors = audit(mutant);
  if (errors.length === 0) throw new Error(`SELF_TEST_FALSE_GREEN: ${label}`);
}

function runSelfTest(clean) {
  const cleanErrors = audit(clean);
  if (cleanErrors.length > 0) {
    throw new Error(`SELF_TEST_BASELINE_RED:\n${cleanErrors.join("\n")}`);
  }
  let mutations = 0;
  const red = (label, mutate) => {
    expectRed(clean, label, mutate);
    mutations += 1;
  };

  for (const family of clean.privateFamilies) {
    red(`private-family-${family}`, (model) => {
      model.config.headers = model.config.headers.filter((rule) => rule.source !== `/${family}/:path*`);
    });
  }
  red("private-root", (model) => {
    model.config.headers = model.config.headers.filter((rule) => rule.source !== "/");
  });
  for (const requestPath of DIRECT_PRIVATE_DOCUMENTS) {
    red(`private-document-${requestPath}`, (model) => {
      const index = model.config.headers.findIndex((rule) =>
        Array.isArray(rule.headers) && rule.headers.some((header) => header.key === "X-Robots-Tag") &&
        matches(rule.source, requestPath));
      model.config.headers.splice(index, 1);
    });
  }
  red("conditional-private-header", (model) => {
    model.config.headers.find((rule) => rule.source === "/event/:path*").has = [{ type: "host", value: "example.com" }];
  });
  red("incomplete-private-header", (model) => {
    model.config.headers.find((rule) => rule.source === "/event/:path*").headers[0].value = "noindex";
  });
  red("duplicate-private-header", (model) => {
    model.config.headers.push(structuredClone(model.config.headers.find((rule) => rule.source === "/event/:path*")));
  });
  for (const requestPath of PUBLIC_PATHS) {
    red(`public-exclusion-${requestPath}`, (model) => {
      model.config.headers.push({ source: requestPath, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
    });
  }
  for (const source of PUBLIC_ROUTES.keys()) {
    red(`rewrite-${source}`, (model) => {
      model.config.rewrites = model.config.rewrites.filter((rule) => rule.source !== source);
    });
    red(`redirect-${source}`, (model) => {
      model.config.redirects = model.config.redirects.filter((rule) => rule.source !== source);
    });
  }
  red("rewrite-destination", (model) => {
    model.config.rewrites.find((rule) => rule.source === "/e/:brandSlug/:eventSlug").destination = "/api/wrong";
  });
  red("redirect-destination", (model) => {
    model.config.redirects[0].destination = "https://business.usemingla.com/e/:brandSlug/:eventSlug";
  });
  red("redirect-host-condition", (model) => {
    model.config.redirects[0].has[0].value = "host\\.usemingla\\.com";
  });
  red("redirect-permanence", (model) => {
    model.config.redirects[0].permanent = false;
  });
  red("extra-public-rewrite", (model) => {
    model.config.rewrites.push(structuredClone(model.config.rewrites.find((rule) => rule.source === "/e/:brandSlug/:eventSlug")));
  });
  red("extra-business-redirect", (model) => {
    model.config.redirects.push({ source: "/retired", destination: "https://host.usemingla.com", permanent: true });
  });

  for (const [scope, label, needle] of SOURCE_CLAUSES) {
    red(`clause-${label}`, (model) => replaceAll(model, scope, needle, `__MUTATED_${label}__`, label));
  }
  for (const [label, needle] of PATH_GRAMMAR) {
    red(`path-${label}`, (model) => replaceOnce(model, "migration", needle, `__MUTATED_${label}__`, label));
  }
  red("lifecycle-extra-state", (model) => {
    replaceOnce(model, "migration", "'redirected','gone'", "'redirected','gone','published'", "lifecycle-extra-state");
  });
  red("second-document-insert", (model) => {
    model.migration += "\nINSERT INTO public.public_search_documents(entity_kind) VALUES ('event');\n";
  });
  red("unsafe-public-fact", (model) => {
    replaceOnce(model, "migration", "'kind',p_kind,'id',e.id", "'kind',p_kind,'contactEmail',e.contact_email,'id',e.id", "unsafe-public-fact");
  });
  red("privacy-order", (model) => {
    const resolver = functionBody(model.migration, "resolve_public_search_document");
    const draftStart = resolver.indexOf("  IF v_source_state='draft' THEN");
    const draftEnd = resolver.indexOf("  END IF;", draftStart) + "  END IF;".length;
    const draftBlock = resolver.slice(draftStart, draftEnd);
    const withoutDraft = resolver.slice(0, draftStart) + resolver.slice(draftEnd);
    const goneEnd = withoutDraft.indexOf("  END IF;", withoutDraft.indexOf("IF v_has_doc AND v_doc.lifecycle_state='gone' THEN")) + "  END IF;".length;
    const reordered = withoutDraft.slice(0, goneEnd) + "\n" + draftBlock + withoutDraft.slice(goneEnd);
    model.migration = model.migration.replace(resolver, reordered);
  });
  red("gone-facts", (model) => {
    replaceOnce(model, "migration", "'state','gone','canonicalPath',p_path,'integrityOk',true)", "'state','gone','canonicalPath',p_path,'integrityOk',true,'facts',v_facts)", "gone-facts");
  });

  process.stdout.write(`PASS issue-2986-public-search-structure self-test (${mutations} independent RED mutations)\n`);
}

if (UNKNOWN_ARGS.length > 0) {
  process.stderr.write(`FAIL issue-2986-public-search-structure unknown arguments: ${UNKNOWN_ARGS.join(" ")}\n`);
  process.exit(2);
}

let model;
try {
  model = loadModel();
  if (SELF_TEST) {
    runSelfTest(model);
  } else {
    const errors = audit(model);
    if (errors.length > 0) {
      process.stderr.write(`FAIL issue-2986-public-search-structure (${errors.length})\n${errors.join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write(
      `PASS issue-2986-public-search-structure (${model.privateFamilies.length} private families, ${SOURCE_CLAUSES.length + PATH_GRAMMAR.length} source clauses)\n`,
    );
  }
} catch (error) {
  process.stderr.write(`FAIL issue-2986-public-search-structure: ${error?.stack ?? error}\n`);
  process.exit(2);
}

export { audit, discoverPrivateRouteFamilies };
