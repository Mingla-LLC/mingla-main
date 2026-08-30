#!/usr/bin/env node
/**
 * ORCH-1167 [event-page-canonical] — I-PROPOSED-1167-ONE-READ-RPC.
 *
 * All surfaces read the canonical standard-event public page body fields via the
 * ONE RPC `pg_direct_event_checkout_bundle` (SC-7: a field added to the RPC surfaces on all
 * surfaces with one mapper edit). This gate asserts:
 *   • the buyer-web/business service (mingla-business/src/services/publicEventsService.ts)
 *     enters the exact slug/UUID pipeline through the direct bundle, with only
 *     the #1929 SQL-NULL/RSVP compatibility fallback, AND
 *   • the consumer hook (app-mobile/src/hooks/usePublicEventBySlug.ts) calls it too.
 *
 * Fails if either surface no longer reads the RPC (a divergent read was reintroduced
 * for the standard-event page body). Self-test proves a stripped reader trips it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SURFACES = [
  {
    label: "web/business service",
    file: "mingla-business/src/services/publicEventsService.ts",
  },
  {
    label: "consumer hook",
    file: "app-mobile/src/hooks/usePublicEventBySlug.ts",
  },
];

const RPC_RE = /\.rpc\(\s*["']pg_direct_event_checkout_bundle["']/;
const LEGACY_CONSUMER_READ_RE = /\.rpc\(\s*["'](?:pg_public_event_by_slug|pg_public_event_tier_allin|pg_public_ticket_types_remaining)["']|\.from\(\s*["'](?:business_public_events_view|ticket_types)["']/;

const ownedRegion = (src, startNeedle, endNeedle) => {
  const start = src.indexOf(startNeedle);
  const nextStart = src.indexOf(startNeedle, start + 1);
  const end = src.indexOf(endNeedle);
  const nextEnd = src.indexOf(endNeedle, end + 1);
  if (start < 0 || end <= start || nextStart >= 0 || nextEnd >= 0) return null;
  return src.slice(start, end);
};

const withoutComments = (src) => {
  let result = "";
  let state = "code";
  for (let index = 0; index < src.length; index += 1) {
    const char = src[index];
    const next = src[index + 1];
    if (state === "line-comment") {
      if (char === "\n") { state = "code"; result += char; } else result += " ";
    } else if (state === "block-comment") {
      if (char === "*" && next === "/") { result += "  "; index += 1; state = "code"; }
      else result += char === "\n" ? "\n" : " ";
    } else if (state === "template") {
      if (char === "\\") { result += "  "; index += 1; }
      else if (char === "`") { result += " "; state = "code"; }
      else result += char === "\n" ? "\n" : " ";
    } else if (state === "single" || state === "double") {
      result += char;
      if (char === "\\") { result += next ?? ""; index += 1; }
      else if ((state === "single" && char === "'") || (state === "double" && char === '"')) state = "code";
    } else if (char === "/" && next === "/") {
      result += "  "; index += 1; state = "line-comment";
    } else if (char === "/" && next === "*") {
      result += "  "; index += 1; state = "block-comment";
    } else if (char === "`") {
      result += " "; state = "template";
    } else {
      result += char;
      if (char === "'") state = "single";
      else if (char === '"') state = "double";
    }
  }
  return result;
};

const matchCount = (src, pattern) => [...src.matchAll(pattern)].length;

function checkFile(src, label) {
  const failures = [];
  if (!RPC_RE.test(src)) {
    failures.push(
      `${label}: does not call supabase.rpc("pg_direct_event_checkout_bundle", …). The ` +
        "standard-event page body MUST read the ONE canonical RPC (SC-7).",
    );
  }
  if (label === "consumer hook" && LEGACY_CONSUMER_READ_RE.test(src)) {
    failures.push(`${label}: parallel legacy standard-event read reintroduced.`);
  }
  if (label === "web/business service") {
    const payloadHelper = ownedRegion(
      src,
      "const fetchDirectEventBundlePayload = async",
      "const readDirectEventBundle = async",
    );
    const readerHelper = ownedRegion(
      src,
      "const readDirectEventBundle = async",
      "export const getPublicEventBySlug = async",
    );
    const slugOwner = ownedRegion(
      src,
      "export const getPublicEventBySlug = async",
      "export const getPublicEventById = async",
    );
    const idOwner = ownedRegion(
      src,
      "export const getPublicEventById = async",
      "export const fetchPublicBrandEvents = async",
    );
    if (payloadHelper === null || readerHelper === null || slugOwner === null || idOwner === null) {
      failures.push(
        `${label}: staged bundle helper boundaries missing, reordered, or ambiguous ` +
        `(payload=${payloadHelper !== null}, reader=${readerHelper !== null}, ` +
        `slug=${slugOwner !== null}, id=${idOwner !== null}).`,
      );
      return failures;
    }

    const rpc = payloadHelper.search(RPC_RE);
    const errorThrow = payloadHelper.search(/if\s*\(\s*error(?:\s*!==\s*null)?\s*\)\s*throw\s+error\s*;/);
    const dataNull = payloadHelper.search(/if\s*\(\s*data\s*===\s*null\s*\)\s*return\s+null\s*;/);
    const validation = payloadHelper.search(/if\s*\(\s*!isDirectEventBundle\(\s*data\s*\)\s*\)/);
    const invalid = payloadHelper.indexOf('"invalid_direct_event_checkout_bundle"');
    const validReturn = payloadHelper.search(/return\s+data\s*;/);
    if (!(rpc >= 0 && errorThrow > rpc && dataNull > errorThrow && validation > dataNull && invalid > validation && validReturn > invalid)) {
      failures.push(`${label}: payload helper RPC/error/null/validation ordering changed.`);
    }
    if (/data\s*===\s*null[^;{}]*["']fallback["']/.test(payloadHelper)) {
      failures.push(`${label}: payload helper must return null, never fallback, for SQL NULL.`);
    }

    const payloadCall = readerHelper.search(/fetchDirectEventBundlePayload\(\s*args\s*\)/);
    const stagedReader = /return\s+payload\s*===\s*null\s*\?\s*["']fallback["']\s*:\s*detailFromDirectBundle\(\s*payload\s*\)\s*;/.test(readerHelper) ||
      /if\s*\(\s*payload\s*===\s*null\s*\)\s*return\s+["']fallback["']\s*;\s*return\s+detailFromDirectBundle\(\s*payload\s*\)\s*;/.test(readerHelper);
    if (payloadCall < 0 || !stagedReader) {
      failures.push(`${label}: reader helper must map only literal payload null to fallback.`);
    }

    const slugCode = withoutComments(slugOwner);
    const slugDirectRead = slugCode.search(/readDirectEventBundle\s*\(/);
    const slugFallbackDecision = slugCode.search(/^\s*if\s*\(\s*direct\s*!==\s*["']fallback["']\s*\)\s*return\s+direct\s*;/m);
    const slugView = slugCode.search(/\.from\(\s*["']business_public_events_view["']\s*\)/);
    const slugError = slugCode.search(/^\s*if\s*\(\s*error\s*!==\s*null\s*\)\s*throw\s+error\s*;/m);
    const slugDataNull = slugCode.search(/^\s*if\s*\(\s*data\s*===\s*null\s*\)\s*return\s+null\s*;/m);
    const slugRow = slugCode.search(/^\s*const\s+row\s*=\s*data\s+as\s+BusinessPublicEventViewRow\s*;/m);
    const slugGuard = slugCode.search(/^\s*if\s*\(\s*row\.event_type\s*!==\s*["']rsvp["']\s*\)\s*\{\s*return\s+null\s*;\s*\}/m);
    const slugDetail = slugCode.search(/^\s*return\s+detailFromRow\(\s*row\s*\)\s*;/m);
    const slugDetailCount = matchCount(slugCode, /detailFromRow\(\s*row\s*\)/g);
    const slugUnconditionalCount = matchCount(slugCode, /^\s*return\s+detailFromRow\(\s*row\s*\)\s*;/gm);
    if (!(slugDirectRead >= 0 && slugFallbackDecision > slugDirectRead && slugView > slugFallbackDecision &&
        slugError > slugView && slugDataNull > slugError && slugRow > slugDataNull &&
        slugGuard > slugRow && slugDetail > slugGuard && slugDetailCount === 1 && slugUnconditionalCount === 1)) {
      failures.push(`${label}: slug owner bundle/view/RSVP guard or single detail admission changed.`);
    }

    const idCode = withoutComments(idOwner);
    const idDirectRead = idCode.search(/readDirectEventBundle\s*\(/);
    const idFallbackDecision = idCode.search(/^\s*if\s*\(\s*direct\s*!==\s*["']fallback["']\s*\)\s*return\s+direct\s*;/m);
    const idView = idCode.search(/\.from\(\s*["']business_public_events_view["']\s*\)/);
    const idError = idCode.search(/^\s*if\s*\(\s*error\s*!==\s*null\s*\)\s*throw\s+error\s*;/m);
    const idDataNull = idCode.search(/^\s*if\s*\(\s*data\s*===\s*null\s*\)\s*return\s+null\s*;/m);
    const idRow = idCode.search(/^\s*const\s+row\s*=\s*data\s+as\s+BusinessPublicEventViewRow\s*;/m);
    const idAdmission = idCode.search(/^\s*return\s+row\.event_type\s*===\s*["']rsvp["']\s*\?\s*detailFromRow\(\s*row\s*\)\s*:\s*null\s*;/m);
    const idDetailCount = matchCount(idCode, /detailFromRow\(\s*row\s*\)/g);
    const idAdmissionCount = matchCount(idCode, /^\s*return\s+row\.event_type\s*===\s*["']rsvp["']\s*\?\s*detailFromRow\(\s*row\s*\)\s*:\s*null\s*;/gm);
    if (!(idDirectRead >= 0 && idFallbackDecision > idDirectRead && idView > idFallbackDecision &&
        idError > idView && idDataNull > idError && idRow > idDataNull &&
        idAdmission > idRow && idDetailCount === 1 && idAdmissionCount === 1)) {
      failures.push(`${label}: ID owner bundle/view or single RSVP detail admission changed.`);
    }
  }
  return failures;
}

function runSelfTest() {
  const goodConsumer = `const { data } = await supabase.rpc("pg_direct_event_checkout_bundle", { p_brand_slug });`;
  const goodBusiness = `
    const fetchDirectEventBundlePayload = async (args) => {
      const { data, error } = await supabase.rpc("pg_direct_event_checkout_bundle", args);
      if (error !== null) throw error;
      if (data === null) return null;
      if (!isDirectEventBundle(data)) {
        throw new Error("invalid_direct_event_checkout_bundle");
      }
      return data;
    };
    const readDirectEventBundle = async (args) => {
      const payload = await fetchDirectEventBundlePayload(args);
      return payload === null ? "fallback" : detailFromDirectBundle(payload);
    };
    export const getPublicEventBySlug = async () => {
      const direct = await readDirectEventBundle({});
      if (direct !== "fallback") return direct;
      const { data, error } = await supabase.from("business_public_events_view");
      if (error !== null) throw error;
      if (data === null) return null;
      const row = data as BusinessPublicEventViewRow;
      if (row.event_type !== "rsvp") {
        return null;
      }
      return detailFromRow(row);
    };
    export const getPublicEventById = async () => {
      const direct = await readDirectEventBundle({});
      if (direct !== "fallback") return direct;
      const { data, error } = await supabase.from("business_public_events_view");
      if (error !== null) throw error;
      if (data === null) return null;
      const row = data as BusinessPublicEventViewRow;
      return row.event_type === "rsvp" ? detailFromRow(row) : null;
    };
    export const fetchPublicBrandEvents = async () => null;
  `;
  const goodFailures = [
    ...checkFile(goodConsumer, "consumer hook"),
    ...checkFile(goodBusiness, "web/business service"),
  ];
  const goodPasses = goodFailures.length === 0;
  const slugGuard = `if (row.event_type !== "rsvp") {
        return null;
      }`;
  const slugDetail = "return detailFromRow(row);";
  const idDetail = 'return row.event_type === "rsvp" ? detailFromRow(row) : null;';
  const donateIdAdmissionToSlug = (source) => source
    .replace(slugDetail, "__SLUG_ID_ADMISSION__")
    .replace(idDetail, slugDetail)
    .replace("__SLUG_ID_ADMISSION__", idDetail);
  const businessMutation = (name, source) => ({ name, source, label: "web/business service", original: goodBusiness });
  const consumerMutation = (name, source) => ({ name, source, label: "consumer hook", original: goodConsumer });
  const badMutations = [
    consumerMutation("consumer canonical RPC renamed", goodConsumer.replace("pg_direct_event_checkout_bundle", "pg_public_event_by_slug")),
    consumerMutation("consumer legacy view added", `${goodConsumer}\nsupabase.from("business_public_events_view")`),
    consumerMutation("consumer ticket table added", `${goodConsumer}\nsupabase.from("ticket_types")`),
    businessMutation("payload canonical RPC renamed", goodBusiness.replace("pg_direct_event_checkout_bundle", "pg_public_event_by_slug")),
    businessMutation("payload error moved after null", goodBusiness.replace(
      "if (error !== null) throw error;\n      if (data === null) return null;",
      "if (data === null) return null;\n      if (error !== null) throw error;",
    )),
    businessMutation("payload maps null directly to fallback", goodBusiness.replace("if (data === null) return null;", 'if (data === null) return "fallback";')),
    businessMutation("payload validation removed", goodBusiness.replace("if (!isDirectEventBundle(data)) {", "if (data) {")),
    businessMutation("payload invalid rejection removed", goodBusiness.replace('throw new Error("invalid_direct_event_checkout_bundle");', "return null;")),
    businessMutation("reader literal null broadened", goodBusiness.replace('return payload === null ? "fallback" : detailFromDirectBundle(payload);', 'return payload ? detailFromDirectBundle(payload) : "fallback";')),
    businessMutation("payload null decoy moved outside helper", goodBusiness.replace(
      "if (data === null) return null;",
      "if (false) return null;",
    ).replace(
      "const readDirectEventBundle = async (args) => {",
      "if (data === null) return null;\n    const readDirectEventBundle = async (args) => {",
    )),
    businessMutation("reader null decoy moved outside helper", goodBusiness.replace(
      'return payload === null ? "fallback" : detailFromDirectBundle(payload);',
      'return payload ? detailFromDirectBundle(payload) : "fallback";',
    ).replace(
      "export const getPublicEventBySlug = async () => {",
      'if (payload === null) return "fallback";\n    export const getPublicEventBySlug = async () => {',
    )),
    businessMutation("original cross-owner donation attack", donateIdAdmissionToSlug(goodBusiness)),
    businessMutation("ID broadened while slug remains canonical", goodBusiness.replace(idDetail, slugDetail)),
    businessMutation("slug guard deleted while ID remains canonical", goodBusiness.replace(slugGuard, "if (false) return null;")),
    businessMutation("slug guard inverted while ID remains canonical", goodBusiness.replace('row.event_type !== "rsvp"', 'row.event_type === "rsvp"')),
    businessMutation("slug guard broadened while ID remains canonical", goodBusiness.replace('row.event_type !== "rsvp"', 'row.event_type !== "trip"')),
    businessMutation("slug takes ID ternary while ID broadens", donateIdAdmissionToSlug(goodBusiness).replace(slugGuard, "if (false) return null;")),
    businessMutation("ID ternary decoy outside owner", goodBusiness.replace(idDetail, slugDetail) + `\n${idDetail}`),
    businessMutation("slug guard decoy outside owner", goodBusiness.replace(slugGuard, "if (false) return null;") + `\n${slugGuard}`),
    businessMutation("ID ternary comment decoy", goodBusiness.replace(idDetail, `// ${idDetail}\n      ${slugDetail}`)),
    businessMutation("ID ternary string decoy", goodBusiness.replace(idDetail, `const decoy = '${idDetail}'\n      ${slugDetail}`)),
    businessMutation("slug duplicate detail admission", goodBusiness.replace(slugDetail, `if (row) ${slugDetail}\n      ${slugDetail}`)),
    businessMutation("ID duplicate detail admission", goodBusiness.replace(idDetail, `if (row.event_type === "rsvp") ${slugDetail}\n      ${idDetail}`)),
    businessMutation("slug view moved before fallback decision", goodBusiness.replace(
      'const direct = await readDirectEventBundle({});\n      if (direct !== "fallback") return direct;\n      const { data, error } = await supabase.from("business_public_events_view");',
      'const { data, error } = await supabase.from("business_public_events_view");\n      const direct = await readDirectEventBundle({});\n      if (direct !== "fallback") return direct;',
    )),
    businessMutation("ID view moved before fallback decision", goodBusiness.replace(
      'export const getPublicEventById = async () => {\n      const direct = await readDirectEventBundle({});\n      if (direct !== "fallback") return direct;\n      const { data, error } = await supabase.from("business_public_events_view");',
      'export const getPublicEventById = async () => {\n      const { data, error } = await supabase.from("business_public_events_view");\n      const direct = await readDirectEventBundle({});\n      if (direct !== "fallback") return direct;',
    )),
    businessMutation("slug helper boundary duplicated", goodBusiness.replace(
      "export const getPublicEventById = async () => {",
      "export const getPublicEventBySlug = async () => null;\n    export const getPublicEventById = async () => {",
    )),
    businessMutation("ID helper boundary missing", goodBusiness.replace("export const getPublicEventById = async", "export const readPublicEventById = async")),
  ];
  const vacuousMutations = badMutations.filter(({ source, original }) => source === original).map(({ name }) => name);
  const acceptedMutations = badMutations
    .filter(({ source, label }) => checkFile(source, label).length === 0)
    .map(({ name }) => name);
  if (!goodPasses) {
    console.error("SELF-TEST FAIL: RPC reader wrongly tripped the gate.");
    for (const failure of goodFailures) console.error(`  ${failure}`);
    process.exit(1);
  }
  if (vacuousMutations.length > 0 || acceptedMutations.length > 0) {
    if (vacuousMutations.length > 0) console.error(`SELF-TEST FAIL: vacuous mutations: ${vacuousMutations.join(", ")}`);
    if (acceptedMutations.length > 0) console.error(`SELF-TEST FAIL: accepted mutations: ${acceptedMutations.join(", ")}`);
    process.exit(1);
  }
  console.log("ORCH-1167 one-read-rpc gate SELF-TEST PASS.");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const failures = [];
  for (const { label, file } of SURFACES) {
    const path = join(root, file);
    if (!existsSync(path)) {
      failures.push(`${label}: ${file} missing.`);
      continue;
    }
    failures.push(...checkFile(readFileSync(path, "utf8"), label));
  }
  if (failures.length > 0) {
    console.error("\nORCH-1167 one-read-rpc gate FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("ORCH-1167 one-read-rpc gate PASS.");
}
